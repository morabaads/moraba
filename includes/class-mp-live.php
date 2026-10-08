<?php
defined( 'ABSPATH' ) || exit;

/**
 * Live chat state for the open panel: one connection per tab that tells the browser at once when anything in
 * its chats changes (new message, edit, reaction, read/delivered ticks, typing, someone coming online).
 *
 * - GET live (EventSource): Server-Sent Events for up to ~25 seconds; the browser reconnects by itself.
 * - GET live?mode=poll&v=…: the same answer as one held request, for hosts that buffer streamed output.
 *
 * A tiny «version» (a file's content plus the newest message id) changes with every chat change, so the
 * waiting loop is one file read and one indexed query; the user's full state is computed only after a change.
 */
class MP_Live {

	const ACT  = 'mp_chat_act';
	const LIFE = 25;

	public static function register() {
		register_rest_route(
			'moraba-panel/v1',
			'/live',
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'live' ), 'permission_callback' => array( 'MP_Rest', 'can_access' ) )
		);
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	private static function file() {
		return MP_Files::dir() . '/live.ver';
	}

	/** Something in the chats changed: every open panel hears about it within a moment. */
	public static function bump() {
		@file_put_contents( self::file(), uniqid( '', true ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
	}

	public static function ver() {
		global $wpdb;
		clearstatcache( true, self::file() );
		$f   = @file_get_contents( self::file() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
		$max = (int) $wpdb->get_var( 'SELECT MAX(id) FROM ' . self::t( 'messages' ) ); // phpcs:ignore
		return substr( md5( (string) $f . '|' . $max ), 0, 12 );
	}

	/* ------------------------------------------------------------------ Typing / recording (one map for all chats) */

	private static function act_map() {
		global $wpdb;
		$raw = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::ACT ) );
		$map = $raw ? maybe_unserialize( $raw ) : array();
		return is_array( $map ) ? $map : array();
	}

	public static function set_activity( $channel_id, $uid, $state ) {
		$map  = self::act_map();
		$now  = time();
		$was  = isset( $map[ $channel_id ][ $uid ] ) ? $map[ $channel_id ][ $uid ][0] : '';
		foreach ( $map as $c => $people ) {
			foreach ( $people as $u => $a ) {
				if ( $now - $a[1] > 8 ) {
					unset( $map[ $c ][ $u ] );
				}
			}
			if ( empty( $map[ $c ] ) ) {
				unset( $map[ $c ] );
			}
		}
		if ( 'idle' === $state ) {
			unset( $map[ $channel_id ][ $uid ] );
		} else {
			$map[ $channel_id ][ $uid ] = array( $state, $now );
		}
		update_option( self::ACT, $map, false );
		if ( $was !== ( 'idle' === $state ? '' : $state ) ) {
			self::bump();
		}
	}

	/** channel id => [{user_id, name, state}] of others typing or recording in the last 6 seconds. */
	public static function activity( $uid, $only = 0 ) {
		$out = array();
		foreach ( self::act_map() as $c => $people ) {
			if ( $only && (int) $c !== (int) $only ) {
				continue;
			}
			foreach ( $people as $u => $a ) {
				if ( (int) $u !== (int) $uid && time() - $a[1] <= 6 ) {
					$usr               = MP_Client_Chat::is_pseudo( $u ) ? null : get_userdata( $u );
					$out[ (int) $c ][] = array( 'user_id' => (int) $u, 'name' => $usr ? $usr->display_name : ( MP_Client_Chat::is_pseudo( $u ) ? MP_Client_Chat::pseudo_name( $u ) : '' ), 'state' => $a[0] );
				}
			}
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Presence */

	/** Heartbeat: a person coming back online is news for everyone who has a chat with them open. */
	public static function seen( $uid ) {
		$was = (int) get_user_meta( $uid, 'mp_last_seen', true );
		update_user_meta( $uid, 'mp_last_seen', time() );
		if ( time() - $was > 90 ) {
			self::bump();
		}
	}

	/* ------------------------------------------------------------------ The user's state */

	/**
	 * Per chat: [newest message id, unread, unread mentions/replies to me, first such message],
	 * typing in each chat, and everyone's «last seen». Also marks new messages as delivered to this person.
	 */
	public static function state( $uid, $open = 0 ) {
		global $wpdb;
		MP_Chat::flush_scheduled();
		$ids  = array();
		$gids = array();
		foreach ( MP_Rest::channels_for( $uid ) as $ch ) {
			if ( empty( $ch->archived_at ) ) {
				$ids[] = (int) $ch->id;
				if ( ! in_array( $ch->type, array( 'direct', 'saved' ), true ) ) {
					$gids[] = (int) $ch->id;
				}
			}
		}
		$chs = array();
		if ( $ids ) {
			$in    = implode( ',', $ids );
			$m     = self::t( 'messages' );
			$reads = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT channel_id, last_id, got_id FROM ' . self::t( 'reads' ) . " WHERE user_id = %d AND channel_id IN ($in)", $uid ) ) as $r ) { // phpcs:ignore
				$reads[ (int) $r->channel_id ] = $r;
			}
			$last = array();
			foreach ( $wpdb->get_results( "SELECT channel_id, MAX(id) mx FROM $m WHERE channel_id IN ($in) GROUP BY channel_id" ) as $r ) { // phpcs:ignore
				$last[ (int) $r->channel_id ] = (int) $r->mx;
			}
			$unread = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( "SELECT m.channel_id, COUNT(*) n FROM $m m LEFT JOIN " . self::t( 'reads' ) . " r ON r.channel_id = m.channel_id AND r.user_id = %d WHERE m.channel_id IN ($in) AND m.id > COALESCE(r.last_id, 0) AND m.user_id <> %d AND m.deleted_at IS NULL GROUP BY m.channel_id", $uid, $uid ) ) as $r ) { // phpcs:ignore
				$unread[ (int) $r->channel_id ] = (int) $r->n;
			}
			$ment = MP_Chat::mention_counts( $uid, $gids );
			// How far the others have read / received (the ticks on my last message in the list).
			$peer = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT channel_id, MAX(last_id) r, MAX(got_id) g FROM ' . self::t( 'reads' ) . " WHERE user_id <> %d AND channel_id IN ($in) GROUP BY channel_id", $uid ) ) as $r ) { // phpcs:ignore
				$peer[ (int) $r->channel_id ] = array( (int) $r->r, (int) $r->g );
			}
			$got  = false;
			foreach ( $ids as $c ) {
				$mx = isset( $last[ $c ] ) ? $last[ $c ] : 0;
				$mn = isset( $ment[ $c ] ) ? $ment[ $c ] : array( 0, 0 );
				$pr        = isset( $peer[ $c ] ) ? $peer[ $c ] : array( 0, 0 );
				$chs[ $c ] = array( $mx, isset( $unread[ $c ] ) ? $unread[ $c ] : 0, $mn[0], $mn[1], $pr[0], max( $pr[0], $pr[1] ) );
				// Delivered: this person's device now knows about every message up to $mx.
				if ( $mx ) {
					if ( ! isset( $reads[ $c ] ) ) {
						$wpdb->insert( self::t( 'reads' ), array( 'channel_id' => $c, 'user_id' => $uid, 'last_id' => 0, 'got_id' => $mx ) );
						$got = true;
					} elseif ( (int) $reads[ $c ]->got_id < $mx ) {
						$wpdb->update( self::t( 'reads' ), array( 'got_id' => $mx ), array( 'channel_id' => $c, 'user_id' => $uid ) );
						$got = true;
					}
				}
			}
			if ( $got ) {
				self::bump();
			}
		}
		$seen = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$seen[ (int) $id ] = (int) get_user_meta( $id, 'mp_last_seen', true );
		}
		$out = array(
			'ch'   => (object) $chs,
			'act'  => (object) self::activity( $uid ),
			'seen' => (object) $seen,
		);
		if ( $open ) {
			$ch = MP_Rest::channel_for( $open, $uid );
			if ( $ch ) {
				$out['sig'] = MP_Chat::sig( $ch );
			}
		}
		return $out;
	}

	private static function refresh_caches() {
		global $wpdb;
		$wpdb->flush();
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( self::ACT, 'options' );
		if ( function_exists( 'wp_cache_flush_runtime' ) ) {
			wp_cache_flush_runtime();
		}
	}

	/** GET live — SSE stream (default) or one held request (?mode=poll&v=). */
	public static function live( WP_REST_Request $r ) {
		$uid  = get_current_user_id();
		$open = (int) $r['open'];
		if ( function_exists( 'session_write_close' ) ) {
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		@set_time_limit( self::LIFE + 20 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		self::seen( $uid );
		if ( 'poll' === $r['mode'] ) {
			$known = (string) $r['v'];
			$until = microtime( true ) + 20;
			$v     = self::ver();
			while ( $v === $known && microtime( true ) < $until && ! connection_aborted() ) {
				usleep( 400000 );
				self::refresh_caches();
				$v = self::ver();
			}
			return array( 'v' => $v ) + self::state( $uid, $open );
		}
		ignore_user_abort( false );
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		header( 'Content-Type: text/event-stream; charset=utf-8' );
		header( 'Cache-Control: no-cache, no-store' );
		header( 'X-Accel-Buffering: no' );
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		// A comment big enough to push through proxies that hold back the first bytes.
		echo ':' . str_repeat( ' ', 2048 ) . "\nretry: 1500\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput
		$send = function ( $event, $data ) {
			echo 'event: ' . $event . "\ndata: " . wp_json_encode( $data, JSON_UNESCAPED_UNICODE ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput
			@ob_flush(); // phpcs:ignore WordPress.PHP.NoSilencedErrors
			flush();
		};
		$v     = self::ver();
		$state = array( 'v' => $v ) + self::state( $uid, $open );
		$send( 'hello', $state );
		$hash  = md5( wp_json_encode( $state ) );
		$start = microtime( true );
		$ping  = $start;
		$beat  = $start;
		while ( microtime( true ) - $start < self::LIFE ) {
			usleep( 300000 );
			if ( connection_aborted() ) {
				break;
			}
			self::refresh_caches();
			$nv = self::ver();
			if ( $nv !== $v || microtime( true ) - $beat > 20 ) {
				$v     = $nv;
				$beat  = microtime( true );
				$state = array( 'v' => $v ) + self::state( $uid, $open );
				$h     = md5( wp_json_encode( $state ) );
				if ( $h !== $hash ) {
					$hash = $h;
					$send( 'state', $state );
					$ping = microtime( true );
				}
			}
			if ( microtime( true ) - $ping > 10 ) {
				echo ": ping\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput
				@ob_flush(); // phpcs:ignore WordPress.PHP.NoSilencedErrors
				flush();
				$ping = microtime( true );
				update_user_meta( $uid, 'mp_last_seen', time() );
			}
		}
		exit;
	}
}

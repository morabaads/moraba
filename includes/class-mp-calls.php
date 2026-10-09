<?php
defined( 'ABSPATH' ) || exit;

/**
 * One-to-one calls with ringing, like Telegram: «تماس» in a private chat makes an instant meeting room for the two
 * people (MP_Meet), the other person's chat apps ring through the live connection (MP_Live::state → ring) for
 * 45 seconds, and the chat gets a line saying how it went (answered, declined, missed).
 *
 * user meta mp_ring       — on the person being called: {id, from, name, video, url, at, channel}
 * user meta mp_call_state — on the caller: {id, state: accepted|declined|missed, at}
 * transient mp_call_{id}  — {video, caller, callee, at, answered}
 *
 * Voice calls (video = 0) stay inside the chat app (assets/js/call-voice.js): the two phones/computers try a
 * direct WebRTC connection (signals carried by the media relay) and otherwise send Opus sound through
 * MP_Relay with held requests (wait=…), so a plain Iranian shared host is enough. «پایان» writes how long it
 * lasted into the private chat and removes the relay's files.
 */
class MP_Calls {

	const RING = 45;

	public static function register() {
		register_rest_route(
			MP_Rest::NS,
			'/calls',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'start' ),
				'permission_callback' => array( 'MP_Rest', 'can_access' ),
			)
		);
		register_rest_route(
			MP_Rest::NS,
			'/calls/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'answer' ),
				'permission_callback' => array( 'MP_Rest', 'can_access' ),
			)
		);
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_call', $m, array( 'status' => $s ) );
	}

	/** The private chat of two people (made when missing). */
	private static function direct( $a, $b ) {
		global $wpdb;
		$t  = MP_Install::table( 'channels' );
		$lo = min( $a, $b );
		$hi = max( $a, $b );
		$id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE type = 'direct' AND user_a = %d AND user_b = %d", $lo, $hi ) ); // phpcs:ignore
		if ( ! $id ) {
			$wpdb->insert( $t, array( 'type' => 'direct', 'user_a' => $lo, 'user_b' => $hi, 'created_by' => $a, 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
		}
		return $id;
	}

	/** POST calls {user_id, video} → {id, url, channel}: the room opens for the caller, the other one rings. */
	public static function start( WP_REST_Request $r ) {
		global $wpdb;
		$uid   = get_current_user_id();
		$other = (int) $r['user_id'];
		if ( $other === $uid || ! MP_Util::is_panel_user( $other ) ) {
			return self::err( 'همکار پیدا نشد.', 404 );
		}
		$ring = get_user_meta( $other, 'mp_ring', true );
		if ( is_array( $ring ) && time() - (int) $ring['at'] < self::RING && (int) $ring['from'] !== $uid ) {
			return self::err( 'این همکار الان تماس دیگری دارد.', 409 );
		}
		$me    = wp_get_current_user();
		$you   = get_userdata( $other );
		$video = ! empty( $r['video'] ) && 'false' !== $r['video'];
		$wpdb->insert(
			MP_Install::table( 'meetings' ),
			array(
				'title'        => 'تماس ' . $me->display_name . ' و ' . $you->display_name,
				'meeting_date' => MP_Util::today(),
				'meeting_time' => current_time( 'H:i' ),
				'token'        => wp_generate_password( 32, false, false ),
				'status'       => 'scheduled',
				'waiting'      => 'off',
				'duration'     => 0,
				'created_by'   => $uid,
				'created_at'   => MP_Util::now(),
			)
		);
		$id = (int) $wpdb->insert_id;
		foreach ( array( $uid, $other ) as $p ) {
			$wpdb->insert( MP_Install::table( 'meeting_people' ), array( 'meeting_id' => $id, 'user_id' => $p ) );
		}
		$m       = MP_Meet::get( $id );
		$url     = MP_Meet::link( $m->token );
		$channel = self::direct( $uid, $other );
		set_transient( 'mp_call_' . $id, array( 'video' => $video ? 1 : 0, 'caller' => $uid, 'callee' => $other, 'at' => time(), 'answered' => 0 ), DAY_IN_SECONDS );
		update_user_meta( $other, 'mp_ring', array( 'id' => $id, 'from' => $uid, 'name' => $me->display_name, 'video' => $video ? 1 : 0, 'url' => $url, 'at' => time(), 'channel' => $channel ) );
		delete_user_meta( $uid, 'mp_call_state' );
		MP_Client::system( $channel, 0, ( $video ? '📹 تماس تصویری' : '📞 تماس صوتی' ) . ' از ' . $me->display_name, array( 't' => 'call', 'id' => $id ) );
		// Phones whose chat app is closed hear about it by push (the page rings when it opens within 45 s).
		MP_Notify::send( $other, 'call', ( $video ? '📹 تماس تصویری از ' : '📞 تماس از ' ) . $me->display_name, 'برای پاسخ دادن بزنید', 'messages', $channel );
		MP_Live::bump();
		$out = array( 'id' => $id, 'url' => $url, 'channel' => $channel, 'ring' => self::RING );
		if ( ! $video ) {
			$out['voice'] = self::voice( $m, $uid, $other );
		}
		return $out;
	}

	/** What the page needs to carry the sound: its signed relay address, the other side, ICE servers. */
	private static function voice( $m, $me, $other ) {
		return array(
			'relay' => MP_URL . 'relay.php',
			'rest'  => rest_url( MP_Rest::NS . '/room/' . $m->token . '/relay' ),
			'q'     => MP_Relay::issue( $m->token, $me ),
			'me'    => (int) $me,
			'other' => (int) $other,
			'ice'   => MP_Meet::ice(),
		);
	}

	/** POST calls/{id} {action: accept | decline | cancel | missed} */
	public static function answer( WP_REST_Request $r ) {
		$uid    = get_current_user_id();
		$id     = (int) $r['id'];
		$action = MP_Util::pick( (string) $r['action'], array( 'accept', 'decline', 'cancel', 'missed', 'end' ), 'decline' );
		$m      = MP_Meet::get( $id );
		if ( ! $m ) {
			return self::err( 'تماس پیدا نشد.', 404 );
		}
		$caller = (int) $m->created_by;
		$people = MP_Meet::people( $id );
		if ( ! in_array( $uid, $people, true ) ) {
			return self::err( 'این تماس مال شما نیست.', 403 );
		}
		$callee = 0;
		foreach ( $people as $p ) {
			if ( $p !== $caller ) {
				$callee = $p;
			}
		}
		$ring = get_user_meta( $callee, 'mp_ring', true );
		if ( is_array( $ring ) && (int) $ring['id'] === $id ) {
			delete_user_meta( $callee, 'mp_ring' );
		}
		$channel = self::direct( $caller, $callee );
		$name    = get_userdata( $callee ) ? get_userdata( $callee )->display_name : '';
		$info    = get_transient( 'mp_call_' . $id );
		$info    = is_array( $info ) ? $info : array( 'video' => 1, 'answered' => 0 );
		if ( 'end' === $action ) {
			// a voice call that was answered: how long it lasted, in the chat; the relay's files go
			if ( ! empty( $info['answered'] ) && empty( $info['ended'] ) ) {
				$secs = max( 0, time() - (int) $info['answered'] );
				$info['ended'] = time();
				set_transient( 'mp_call_' . $id, $info, DAY_IN_SECONDS );
				MP_Client::system( $channel, 0, '📞 تماس صوتی · ' . MP_Jalali::digits( sprintf( '%02d:%02d', floor( $secs / 60 ), $secs % 60 ) ), array( 't' => 'call', 'id' => $id, 'secs' => $secs ) );
				MP_Relay::purge( $m->token );
				MP_Live::bump();
				return array( 'ok' => true, 'secs' => $secs );
			}
			if ( empty( $info['answered'] ) ) {
				$action = 'cancel'; // hung up while it was still ringing
			} else {
				return array( 'ok' => true );
			}
		}
		if ( 'accept' === $action ) {
			update_user_meta( $caller, 'mp_call_state', array( 'id' => $id, 'state' => 'accepted', 'at' => time() ) );
			$info['answered'] = time();
			set_transient( 'mp_call_' . $id, $info, DAY_IN_SECONDS );
			MP_Live::bump();
			$out = array( 'ok' => true, 'url' => MP_Meet::link( $m->token ) );
			if ( empty( $info['video'] ) ) {
				$out['voice'] = self::voice( $m, $uid, $uid === $caller ? $callee : $caller );
			}
			return $out;
		} elseif ( 'decline' === $action && $uid === $callee ) {
			update_user_meta( $caller, 'mp_call_state', array( 'id' => $id, 'state' => 'declined', 'at' => time() ) );
			MP_Client::system( $channel, 0, $name . ' تماس را رد کرد', array( 't' => 'call', 'id' => $id ) );
		} else {
			update_user_meta( $caller, 'mp_call_state', array( 'id' => $id, 'state' => 'missed', 'at' => time() ) );
			MP_Client::system( $channel, 0, 'تماس بی‌پاسخ ماند', array( 't' => 'call', 'id' => $id ) );
		}
		if ( empty( $info['video'] ) ) {
			MP_Relay::purge( $m->token ); // the caller's waiting screen hears it ended
		}
		MP_Live::bump();
		return array( 'ok' => true, 'url' => MP_Meet::link( $m->token ) );
	}

	/** For the live state of $uid: a call ringing for them, and how their own last call went. */
	public static function live( $uid ) {
		$out  = array();
		$ring = get_user_meta( $uid, 'mp_ring', true );
		if ( is_array( $ring ) ) {
			if ( time() - (int) $ring['at'] < self::RING ) {
				$out['ring'] = $ring;
			} else {
				// nobody answered: the caller hears so, the chat keeps a line
				delete_user_meta( $uid, 'mp_ring' );
				update_user_meta( (int) $ring['from'], 'mp_call_state', array( 'id' => (int) $ring['id'], 'state' => 'missed', 'at' => time() ) );
				MP_Client::system( (int) $ring['channel'], 0, 'تماس بی‌پاسخ ماند', array( 't' => 'call', 'id' => (int) $ring['id'] ) );
				$m = empty( $ring['video'] ) ? MP_Meet::get( (int) $ring['id'] ) : null;
				if ( $m ) {
					MP_Relay::purge( $m->token ); // the caller's call screen stops ringing
				}
				MP_Live::bump();
			}
		}
		$st = get_user_meta( $uid, 'mp_call_state', true );
		if ( is_array( $st ) && time() - (int) $st['at'] < 60 ) {
			$out['call'] = $st;
		}
		return $out;
	}
}

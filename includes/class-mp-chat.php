<?php
defined( 'ABSPATH' ) || exit;

/**
 * Telegram-style chat on top of MP_Rest's channels and messages: replies, edits, reactions, a pinned
 * message per chat, forwarding, «saved messages», mute, @mentions, search, the chat's media/files/links,
 * link previews, «seen by», and a held request that answers as soon as something in the chat changes.
 */
class MP_Chat {

	const REACTIONS = array( '👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '✅' );

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$id   = '(?P<id>\d+)';
		$r    = array(
			array( "messages/$id/edit", 'POST', 'edit' ),
			array( "messages/$id/react", 'POST', 'react' ),
			array( "messages/$id/pin", 'POST', 'pin' ),
			array( "messages/$id/forward", 'POST', 'forward' ),
			array( "messages/$id/seen", 'GET', 'seen_by' ),
			array( 'messages/search', 'GET', 'search_all' ),
			array( "channels/$id/search", 'GET', 'search' ),
			array( "channels/$id/media", 'GET', 'media' ),
			array( "channels/$id/mute", 'POST', 'mute' ),
			array( "channels/$id/read", 'POST', 'read' ),
			array( 'channels/saved', 'POST', 'saved' ),
			array( 'link-preview', 'GET', 'link_preview' ),
			array( 'chat-upload', 'POST', 'chunk' ),
		);
		foreach ( $r as $x ) {
			register_rest_route( 'moraba-panel/v1', '/' . $x[0], array( 'methods' => $x[1], 'callback' => array( __CLASS__, $x[2] ), 'permission_callback' => $auth ) );
		}
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_error', $msg, array( 'status' => $status ) );
	}

	private static function uid() {
		return get_current_user_id();
	}

	/** A message the current user can see, with its channel. */
	private static function message( $id ) {
		global $wpdb;
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', (int) $id ) );
		if ( ! $m ) {
			return array( null, null );
		}
		$ch = MP_Rest::channel_for( (int) $m->channel_id, self::uid() );
		return $ch ? array( $m, $ch ) : array( null, null );
	}

	private static function touch( $id ) {
		global $wpdb;
		$wpdb->update( self::t( 'messages' ), array( 'updated_at' => MP_Util::now() ), array( 'id' => (int) $id ) );
	}

	/* ------------------------------------------------------------------ Payload extras */

	private static $reactions = array();
	private static $replies   = array();

	/** Reactions and quoted messages for many messages in two queries. */
	public static function preload( array $rows ) {
		global $wpdb;
		$ids = array_map( 'intval', wp_list_pluck( $rows, 'id' ) );
		if ( $ids ) {
			foreach ( $ids as $i ) {
				self::$reactions[ $i ] = array();
			}
			foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'reactions' ) . ' WHERE message_id IN (' . implode( ',', $ids ) . ') ORDER BY created_at' ) as $x ) { // phpcs:ignore
				self::$reactions[ (int) $x->message_id ][] = $x;
			}
		}
		$rids = array_values( array_filter( array_map( 'intval', wp_list_pluck( $rows, 'reply_to' ) ) ) );
		if ( $rids ) {
			foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id IN (' . implode( ',', $rids ) . ')' ) as $x ) { // phpcs:ignore
				self::$replies[ (int) $x->id ] = $x;
			}
		}
	}

	private static function author( $m ) {
		$u = $m->user_id ? get_userdata( $m->user_id ) : null;
		return $u ? $u->display_name : ( ! empty( $m->kind ) ? 'مربع استودیو' : ( $m->guest_name ? $m->guest_name : 'مشتری' ) );
	}

	/** One line describing a message: its text, or «عکس» / «ویس» / the file name. */
	public static function snippet( $m ) {
		if ( ! empty( $m->deleted_at ) ) {
			return 'پیام آرشیو شد';
		}
		$body = trim( preg_replace( '/\s+/u', ' ', (string) $m->body ) );
		if ( '' !== $body ) {
			return mb_substr( $body, 0, 120 );
		}
		if ( $m->file_id ) {
			$f = MP_Files::get( $m->file_id );
			if ( $f && 0 === strpos( $f->mime, 'audio/' ) ) {
				return 'پیام صوتی';
			}
			if ( $f && 0 === strpos( $f->mime, 'image/' ) && empty( $m->as_file ) ) {
				return 'عکس';
			}
			return $f ? $f->name : 'فایل';
		}
		return '';
	}

	private static function kind_of( $m ) {
		if ( ! $m->file_id || ! empty( $m->deleted_at ) ) {
			return '';
		}
		$f = MP_Files::get( $m->file_id );
		if ( ! $f ) {
			return '';
		}
		return 0 === strpos( $f->mime, 'audio/' ) ? 'voice' : ( 0 === strpos( $f->mime, 'image/' ) && empty( $m->as_file ) ? 'photo' : 'file' );
	}

	/** Fields every chat message carries besides MP_Rest's own. */
	public static function extra( $m, $uid ) {
		global $wpdb;
		$id = (int) $m->id;
		if ( ! array_key_exists( $id, self::$reactions ) ) {
			self::$reactions[ $id ] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'reactions' ) . ' WHERE message_id = %d ORDER BY created_at', $id ) );
		}
		$groups = array();
		foreach ( self::$reactions[ $id ] as $x ) {
			if ( ! isset( $groups[ $x->emoji ] ) ) {
				$groups[ $x->emoji ] = array( 'emoji' => $x->emoji, 'count' => 0, 'mine' => false, 'names' => array() );
			}
			++$groups[ $x->emoji ]['count'];
			$groups[ $x->emoji ]['mine'] = $groups[ $x->emoji ]['mine'] || (int) $x->user_id === (int) $uid;
			if ( count( $groups[ $x->emoji ]['names'] ) < 5 ) {
				$u                              = get_userdata( $x->user_id );
				$groups[ $x->emoji ]['names'][] = $u ? $u->display_name : '';
			}
		}
		$reply = null;
		$rid   = isset( $m->reply_to ) ? (int) $m->reply_to : 0;
		if ( $rid ) {
			if ( ! isset( self::$replies[ $rid ] ) ) {
				self::$replies[ $rid ] = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $rid ) );
			}
			$q = self::$replies[ $rid ];
			if ( $q ) {
				$reply = array( 'id' => (int) $q->id, 'author' => self::author( $q ), 'text' => self::snippet( $q ), 'kind' => self::kind_of( $q ), 'mine' => (int) $q->user_id === (int) $uid );
			}
		}
		return array(
			'reply'     => $reply,
			'reactions' => array_values( $groups ),
			'fwd_from'  => isset( $m->fwd_from ) ? (string) $m->fwd_from : '',
			'album'     => isset( $m->album ) ? (string) $m->album : '',
			'as_file'   => ! empty( $m->as_file ),
			'edited'    => ! empty( $m->edited_at ),
		);
	}

	/** Reply / album / «as file» on a new message. */
	public static function send_fields( WP_REST_Request $r, $ch, array $row ) {
		global $wpdb;
		$reply = (int) $r['reply_to'];
		if ( $reply && (int) $wpdb->get_var( $wpdb->prepare( 'SELECT channel_id FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $reply ) ) === (int) $ch->id ) {
			$row['reply_to'] = $reply;
		}
		$album = preg_replace( '/[^a-z0-9]/i', '', (string) $r['album'] );
		if ( '' !== $album ) {
			$row['album'] = substr( $album, 0, 24 );
		}
		if ( $r['as_file'] && 'false' !== $r['as_file'] ) {
			$row['as_file'] = 1;
		}
		return $row;
	}

	/** «@Name» in a message: the named members get a notification (even in a muted chat, like Telegram). */
	public static function mentions( $ch, $uid, $body, $preview ) {
		if ( false === mb_strpos( (string) $body, '@' ) ) {
			return;
		}
		$title = 'direct' === $ch->type ? 'گفت‌وگوی خصوصی' : $ch->title;
		foreach ( MP_Rest::channel_members( $ch ) as $member ) {
			$u = get_userdata( $member );
			if ( ! $u || (int) $member === (int) $uid || 'direct' === $ch->type ) {
				continue;
			}
			$names = array_filter( array( $u->display_name, strtok( $u->display_name, ' ' ) ) );
			foreach ( $names as $n ) {
				if ( preg_match( '/(^|\s)@' . preg_quote( $n, '/' ) . '(?=$|[\s،,.!؟?:])/u', $body ) ) {
					MP_Notify::event( 'message_mention', $member, array( 'ACTOR' => wp_get_current_user()->display_name, 'GROUP' => $title, 'PREVIEW' => $preview ), 'messages', $ch->id, true );
					break;
				}
			}
		}
	}

	/* ------------------------------------------------------------------ Held request */

	/** Everything that changes what an open chat shows, in one short string. */
	public static function sig( $ch ) {
		global $wpdb;
		$row  = $wpdb->get_row( $wpdb->prepare( 'SELECT MAX(id) a, MAX(updated_at) b, MAX(deleted_at) c FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d', $ch->id ), ARRAY_N );
		$read = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(last_id) FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d', $ch->id ) );
		$pin  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT pinned_msg FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $ch->id ) );
		$act  = MP_Rest::activity_of( $ch->id, self::uid() );
		$gone = get_transient( 'mp_purged_' . $ch->id );
		return md5( implode( '|', (array) $row ) . '|' . $read . '|' . $pin . '|' . wp_json_encode( $act ) . '|' . ( is_array( $gone ) ? count( $gone ) : 0 ) );
	}

	/** Waits (at most ~6 s) while the chat's signature still equals what the browser already has. */
	public static function wait( $ch, $known ) {
		global $wpdb;
		if ( function_exists( 'session_write_close' ) ) {
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		$until = microtime( true ) + 6;
		while ( microtime( true ) < $until ) {
			if ( self::sig( $ch ) !== $known || connection_aborted() ) {
				return;
			}
			usleep( 700000 );
			$wpdb->flush();
			wp_cache_delete( 'mp_act_' . $ch->id, 'transient' );
			wp_cache_delete( '_transient_mp_act_' . $ch->id, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
		}
	}

	/* ------------------------------------------------------------------ Pinned message */

	public static function pinned( $ch, $uid ) {
		global $wpdb;
		$pid = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT pinned_msg FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $ch->id ) );
		if ( ! $pid ) {
			return null;
		}
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d AND channel_id = %d', $pid, $ch->id ) );
		if ( ! $m || ! empty( $m->deleted_at ) ) {
			return null;
		}
		return array( 'id' => (int) $m->id, 'author' => self::author( $m ), 'text' => self::snippet( $m ), 'kind' => self::kind_of( $m ) );
	}

	/** POST messages/{id}/pin {on} — one pinned message per chat, for every member. */
	public static function pin( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$on = $r['on'] && 'false' !== $r['on'];
		$wpdb->update( self::t( 'channels' ), array( 'pinned_msg' => $on ? (int) $m->id : 0 ), array( 'id' => $ch->id ) );
		self::touch( $m->id );
		return array( 'pinned' => self::pinned( $ch, self::uid() ) );
	}

	/* ------------------------------------------------------------------ Edit, react, forward */

	/** POST messages/{id}/edit {body} — your own text messages (and captions). */
	public static function edit( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) || ! empty( $m->kind ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		if ( (int) $m->user_id !== self::uid() ) {
			return self::err( 'فقط پیام‌های خودتان را می‌توانید ویرایش کنید.', 403 );
		}
		$body = MP_Util::long_text( $r['body'], 4000 );
		if ( '' === trim( $body ) && ! $m->file_id ) {
			return self::err( 'متن پیام خالی است.' );
		}
		$wpdb->update( self::t( 'messages' ), array( 'body' => $body, 'edited_at' => MP_Util::now(), 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $m->id ) );
		return MP_Rest::message_payload( $m, self::uid(), MP_Rest::channel_reads( $ch->id ) );
	}

	/** POST messages/{id}/react {emoji} — one reaction per person; the same emoji again takes it back. */
	public static function react( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$emoji = (string) $r['emoji'];
		if ( ! in_array( $emoji, self::REACTIONS, true ) ) {
			return self::err( 'این واکنش پشتیبانی نمی‌شود.' );
		}
		$uid = self::uid();
		$was = $wpdb->get_var( $wpdb->prepare( 'SELECT emoji FROM ' . self::t( 'reactions' ) . ' WHERE message_id = %d AND user_id = %d', $m->id, $uid ) );
		if ( $was === $emoji ) {
			$wpdb->delete( self::t( 'reactions' ), array( 'message_id' => $m->id, 'user_id' => $uid ) );
		} else {
			$wpdb->replace( self::t( 'reactions' ), array( 'message_id' => $m->id, 'user_id' => $uid, 'emoji' => $emoji, 'created_at' => MP_Util::now() ) );
		}
		self::touch( $m->id );
		unset( self::$reactions[ (int) $m->id ] );
		return MP_Rest::message_payload( $m, $uid, MP_Rest::channel_reads( $ch->id ) );
	}

	/** POST messages/{id}/forward {channel_ids: []} — a copy in each chosen chat, «forwarded from» its author. */
	public static function forward( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) || ( '' === trim( $m->body ) && ! $m->file_id ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$uid  = self::uid();
		$from = ! empty( $m->fwd_from ) ? $m->fwd_from : self::author( $m );
		if ( $r['resend'] && 'false' !== $r['resend'] ) {
			$from = ''; // «recent files» in the attach sheet: the same file again, as a new message
		}
		$done = array();
		foreach ( array_unique( array_map( 'intval', (array) $r['channel_ids'] ) ) as $cid ) {
			$to = MP_Rest::channel_for( $cid, $uid );
			if ( ! $to || ! empty( $to->archived_at ) ) {
				continue;
			}
			$wpdb->insert(
				self::t( 'messages' ),
				array(
					'channel_id' => $to->id,
					'user_id'    => $uid,
					'body'       => $m->body,
					'file_id'    => (int) $m->file_id,
					'transcript' => $m->transcript,
					'fwd_from'   => mb_substr( (string) $from, 0, 120 ),
					'as_file'    => (int) $m->as_file,
					'created_at' => MP_Util::now(),
				)
			);
			$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $to->id, 'user_id' => $uid, 'last_id' => (int) $wpdb->insert_id ) );
			$done[] = (int) $to->id;
		}
		if ( ! $done ) {
			return self::err( 'گفت‌وگویی انتخاب نشد.' );
		}
		return array( 'channels' => $done );
	}

	/** GET messages/{id}/seen — who has read it (groups). */
	public static function seen_by( WP_REST_Request $r ) {
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$out = array();
		foreach ( MP_Rest::channel_reads( $ch->id ) as $who => $last ) {
			if ( $last >= (int) $m->id && (int) $who !== (int) $m->user_id ) {
				$u = get_userdata( $who );
				if ( $u ) {
					$out[] = array( 'id' => (int) $who, 'name' => $u->display_name, 'avatar' => MP_Util::avatar_url( $who ) );
				}
			}
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Search and media */

	private static function hit( $m, $ch_title ) {
		return array( 'id' => (int) $m->id, 'channel_id' => (int) $m->channel_id, 'channel' => $ch_title, 'author' => self::author( $m ), 'text' => self::snippet( $m ), 'created_at' => $m->created_at );
	}

	/** GET channels/{id}/search?q= */
	public static function search( WP_REST_Request $r ) {
		global $wpdb;
		$ch = MP_Rest::channel_for( (int) $r['id'], self::uid() );
		$q  = trim( MP_Util::text( $r['q'], 80 ) );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		if ( mb_strlen( $q ) < 2 ) {
			return array();
		}
		$like = '%' . $wpdb->esc_like( $q ) . '%';
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT m.* FROM ' . self::t( 'messages' ) . ' m LEFT JOIN ' . self::t( 'files' ) . ' f ON f.id = m.file_id WHERE m.channel_id = %d AND m.deleted_at IS NULL AND (m.body LIKE %s OR m.transcript LIKE %s OR f.name LIKE %s) ORDER BY m.id DESC LIMIT 60', $ch->id, $like, $like, $like ) );
		return array_map( function ( $m ) {
			return self::hit( $m, '' );
		}, $rows );
	}

	/** GET messages/search?q= — every chat I am in. */
	public static function search_all( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$q   = trim( MP_Util::text( $r['q'], 80 ) );
		if ( mb_strlen( $q ) < 2 ) {
			return array();
		}
		$titles = array();
		foreach ( MP_Rest::channels_for( $uid ) as $ch ) {
			if ( empty( $ch->archived_at ) ) {
				$p                          = MP_Rest::channel_payload( $ch, $uid );
				$titles[ (int) $ch->id ] = $p['title'];
			}
		}
		if ( ! $titles ) {
			return array();
		}
		$like = '%' . $wpdb->esc_like( $q ) . '%';
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id IN (' . implode( ',', array_keys( $titles ) ) . ') AND deleted_at IS NULL AND (body LIKE %s OR transcript LIKE %s) ORDER BY id DESC LIMIT 40', $like, $like ) ); // phpcs:ignore
		return array_map( function ( $m ) use ( $titles ) {
			return self::hit( $m, $titles[ (int) $m->channel_id ] );
		}, $rows );
	}

	/** GET channels/{id}/media?kind=media|files|links|voice — the chat's info page tabs. */
	public static function media( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$kind = MP_Util::pick( $r['kind'], array( 'media', 'files', 'links', 'voice' ), 'media' );
		$m    = self::t( 'messages' );
		$f    = self::t( 'files' );
		$base = "SELECT m.*, f.mime fmime FROM $m m JOIN $f f ON f.id = m.file_id WHERE m.channel_id = %d AND m.deleted_at IS NULL AND m.file_id > 0";
		if ( 'links' === $kind ) {
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $m WHERE channel_id = %d AND deleted_at IS NULL AND body LIKE %s ORDER BY id DESC LIMIT 200", $ch->id, '%http%' ) ); // phpcs:ignore
			$out  = array();
			foreach ( $rows as $x ) {
				if ( preg_match_all( '#https?://[^\s<>"\']+#u', $x->body, $mm ) ) {
					foreach ( $mm[0] as $url ) {
						$out[] = array( 'id' => (int) $x->id, 'url' => rtrim( $url, '.,،)!؟?' ), 'author' => self::author( $x ), 'created_at' => $x->created_at );
					}
				}
			}
			return $out;
		}
		$where = 'media' === $kind ? " AND f.mime LIKE 'image/%' AND m.as_file = 0" : ( 'voice' === $kind ? " AND f.mime LIKE 'audio/%'" : " AND f.mime NOT LIKE 'audio/%' AND (f.mime NOT LIKE 'image/%' OR m.as_file = 1)" );
		$rows  = $wpdb->get_results( $wpdb->prepare( $base . $where . ' ORDER BY m.id DESC LIMIT 300', $ch->id ) ); // phpcs:ignore
		return array_map( function ( $x ) {
			return array( 'id' => (int) $x->id, 'file' => MP_Files::payload( MP_Files::get( $x->file_id ) ), 'author' => self::author( $x ), 'created_at' => $x->created_at, 'transcript' => (string) $x->transcript );
		}, $rows );
	}

	/* ------------------------------------------------------------------ Mute, read, saved */

	public static function muted( $channel_id, $uid ) {
		$l = get_user_meta( $uid, 'mp_mutes', true );
		return is_array( $l ) && in_array( (int) $channel_id, array_map( 'intval', $l ), true );
	}

	/** POST channels/{id}/mute {on} — no notification for this chat (mentions still arrive). */
	public static function mute( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$l = get_user_meta( $uid, 'mp_mutes', true );
		$l = array_values( array_diff( array_map( 'intval', is_array( $l ) ? $l : array() ), array( (int) $ch->id ) ) );
		if ( $r['on'] && 'false' !== $r['on'] ) {
			$l[] = (int) $ch->id;
		}
		update_user_meta( $uid, 'mp_mutes', $l );
		return MP_Rest::channel_payload( $ch, $uid );
	}

	/** POST channels/{id}/read — mark everything read (from the chat list). */
	public static function read( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$last = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d', $ch->id ) );
		if ( $last ) {
			$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $ch->id, 'user_id' => $uid, 'last_id' => $last ) );
		}
		return MP_Rest::channel_payload( $ch, $uid );
	}

	/** POST channels/saved — the person's own «saved messages», made on first use. */
	public static function saved() {
		global $wpdb;
		$uid = self::uid();
		$id  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'channels' ) . " WHERE type = 'saved' AND user_a = %d", $uid ) );
		if ( ! $id ) {
			$wpdb->insert( self::t( 'channels' ), array( 'type' => 'saved', 'user_a' => $uid, 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
		}
		return MP_Rest::channel_payload( MP_Rest::channel_for( $id, $uid ), $uid );
	}

	/* ------------------------------------------------------------------ Chunked upload (no size limit) */

	/** Chat files beyond the panel's usual list: video, design and archive files. */
	const MORE_TYPES = array(
		'mp4|m4v'  => 'video/mp4',
		'mov|qt'   => 'video/quicktime',
		'webm'     => 'video/webm',
		'3gp'      => 'video/3gpp',
		'mkv'      => 'video/x-matroska',
		'avi'      => 'video/x-msvideo',
		'heic'     => 'image/heic',
		'heif'     => 'image/heif',
		'bmp'      => 'image/bmp',
		'tif|tiff' => 'image/tiff',
		'psd'      => 'image/vnd.adobe.photoshop',
		'ai|eps'   => 'application/postscript',
		'indd'     => 'application/x-indesign',
		'cdr'      => 'application/cdr',
		'fig'      => 'application/octet-stream',
		'sketch'   => 'application/octet-stream',
		'xd'       => 'application/octet-stream',
		'rar'      => 'application/x-rar-compressed',
		'7z'       => 'application/x-7z-compressed',
		'csv'      => 'text/csv',
		'ppt'      => 'application/vnd.ms-powerpoint',
		'pptx'     => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'mp3'      => 'audio/mpeg',
		'wav'      => 'audio/wav',
		'm4a'      => 'audio/mp4',
		'ttf'      => 'font/ttf',
		'otf'      => 'font/otf',
		'woff|woff2' => 'font/woff2',
	);

	/**
	 * POST chat-upload {upload, index, total, name, context_id} + file (one piece).
	 * The browser sends a file in small pieces, so the host's upload limit does not apply; the last piece
	 * checks the whole file's type and stores it like any other message file.
	 */
	public static function chunk( WP_REST_Request $r ) {
		global $wpdb;
		$cid = (int) $r['context_id'];
		if ( ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$up    = preg_replace( '/[^a-z0-9]/i', '', (string) $r['upload'] );
		$i     = (int) $r['index'];
		$total = (int) $r['total'];
		if ( strlen( $up ) < 12 || $total < 1 || $total > 200000 || $i < 0 || $i >= $total ) {
			return self::err( 'بارگذاری معتبر نیست.' );
		}
		if ( empty( $_FILES['file']['tmp_name'] ) || ! empty( $_FILES['file']['error'] ) || ! is_uploaded_file( $_FILES['file']['tmp_name'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
			return self::err( 'این بخش از فایل نرسید؛ دوباره تلاش می‌شود.' );
		}
		$dir = MP_Files::dir() . '/chunks';
		wp_mkdir_p( $dir );
		$part = $dir . '/' . self::uid() . '-' . substr( $up, 0, 40 ) . '.part';
		$next = $part . '.next';
		if ( 0 === $i ) {
			// Old unfinished uploads (a day) are cleared now and then.
			foreach ( (array) glob( $dir . '/*.part' ) as $old ) {
				if ( filemtime( $old ) < time() - DAY_IN_SECONDS ) {
					@unlink( $old ); // phpcs:ignore
					@unlink( $old . '.next' ); // phpcs:ignore
				}
			}
			@unlink( $part ); // phpcs:ignore
		} else {
			$want = is_file( $next ) ? (int) file_get_contents( $next ) : -1; // phpcs:ignore WordPress.WP.AlternativeFunctions
			if ( $i < $want ) {
				return array( 'next' => $want ); // a repeated piece (retry after a timeout)
			}
			if ( $i !== $want ) {
				return self::err( 'ترتیب بخش‌های فایل به هم خورد؛ دوباره بفرستید.' );
			}
		}
		$bytes = file_get_contents( $_FILES['file']['tmp_name'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions, WordPress.Security.ValidatedSanitizedInput
		if ( false === $bytes || false === file_put_contents( $part, $bytes, FILE_APPEND ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			return self::err( 'فضای ذخیره روی هاست کافی نیست.', 500 );
		}
		file_put_contents( $next, (string) ( $i + 1 ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( $i < $total - 1 ) {
			return array( 'next' => $i + 1 );
		}
		// Last piece: check the whole file, then store it.
		@unlink( $next ); // phpcs:ignore
		$name  = sanitize_file_name( wp_basename( (string) $r['name'] ) );
		$name  = '' !== $name ? $name : 'file';
		$check = preg_match( '/^voice-/', $name ) ? MP_Files::audio_check( $part, $name ) : null;
		if ( ! $check ) {
			$check = wp_check_filetype_and_ext( $part, $name, MP_Files::TYPES + self::MORE_TYPES );
		}
		if ( empty( $check['ext'] ) || empty( $check['type'] ) ) {
			@unlink( $part ); // phpcs:ignore
			return self::err( 'این نوع فایل مجاز نیست. عکس، ویدیو، PDF، ورد، اکسل، پاورپوینت، فایل طراحی (PSD/AI) یا فایل فشرده بفرستید.' );
		}
		$sub = gmdate( 'Y/m' );
		wp_mkdir_p( MP_Files::dir() . '/' . $sub );
		$rel  = $sub . '/' . wp_generate_password( 32, false, false ) . '.' . $check['ext'];
		$size = filesize( $part );
		if ( ! rename( $part, MP_Files::dir() . '/' . $rel ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			@unlink( $part ); // phpcs:ignore
			return self::err( 'ذخیره فایل انجام نشد.', 500 );
		}
		$wpdb->insert(
			MP_Install::table( 'files' ),
			array(
				'user_id'    => self::uid(),
				'context'    => 'message',
				'context_id' => $cid,
				'name'       => $name,
				'mime'       => $check['type'],
				'size'       => (int) $size,
				'path'       => $rel,
				'created_at' => MP_Util::now(),
			)
		);
		return MP_Files::payload( MP_Files::get( $wpdb->insert_id ) );
	}

	/* ------------------------------------------------------------------ Apple emoji images */

	const EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';

	/** Public folder: once an emoji is saved, the web server serves it directly (no WordPress). */
	public static function emoji_dir() {
		$u = wp_upload_dir( null, false );
		return $u['basedir'] . '/moraba-emoji';
	}

	public static function emoji_url() {
		$u = wp_upload_dir( null, false );
		return set_url_scheme( $u['baseurl'] . '/moraba-emoji/' );
	}

	/**
	 * ?mp_emoji=1f44d — the Apple image of one emoji, fetched once from the emoji-datasource package and then
	 * served from this site (cached a year in the browser), so Android and Windows show the same emoji as iPhone.
	 */
	public static function emoji_image() {
		if ( ! isset( $_GET['mp_emoji'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		$code = strtolower( (string) wp_unslash( $_GET['mp_emoji'] ) ); // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
		if ( ! preg_match( '/^[0-9a-f]{2,6}(-[0-9a-f]{2,6}){0,9}$/', $code ) ) {
			status_header( 404 );
			exit;
		}
		$dir  = self::emoji_dir();
		$file = $dir . '/' . $code . '.png';
		if ( ! is_file( $file ) ) {
			$miss = $dir . '/' . $code . '.miss';
			if ( is_file( $miss ) && time() - filemtime( $miss ) < DAY_IN_SECONDS ) {
				status_header( 404 );
				exit;
			}
			wp_mkdir_p( $dir );
			// The package names some emoji with the FE0F selector and some without.
			$tries = array( $code );
			if ( false !== strpos( $code, '-fe0f' ) ) {
				$tries[] = str_replace( '-fe0f', '', $code );
			} else {
				$parts   = explode( '-', $code );
				$tries[] = $parts[0] . '-fe0f' . ( count( $parts ) > 1 ? '-' . implode( '-', array_slice( $parts, 1 ) ) : '' );
			}
			$png = '';
			foreach ( $tries as $t ) {
				$res = wp_remote_get( self::EMOJI_CDN . $t . '.png', array( 'timeout' => 8 ) );
				if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) && 0 === strpos( wp_remote_retrieve_body( $res ), "\x89PNG" ) ) {
					$png = wp_remote_retrieve_body( $res );
					break;
				}
			}
			if ( '' === $png ) {
				file_put_contents( $miss, '' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
				status_header( 404 );
				exit;
			}
			file_put_contents( $file, $png ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
		header( 'Content-Type: image/png' );
		header( 'Cache-Control: public, max-age=31536000, immutable' );
		header( 'Content-Length: ' . filesize( $file ) );
		readfile( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}

	/* ------------------------------------------------------------------ Link preview */

	/** GET link-preview?url= — title, description and image of a public page (cached a day). */
	public static function link_preview( WP_REST_Request $r ) {
		$url = esc_url_raw( (string) $r['url'], array( 'http', 'https' ) );
		if ( ! $url ) {
			return self::err( 'آدرس معتبر نیست.' );
		}
		$key  = 'mp_lp_' . md5( $url );
		$hit  = get_transient( $key );
		if ( is_array( $hit ) ) {
			return $hit;
		}
		// wp_safe_remote_get refuses local and private addresses.
		$res  = wp_safe_remote_get( $url, array( 'timeout' => 5, 'redirection' => 3, 'limit_response_size' => 400000, 'user-agent' => 'Mozilla/5.0 (compatible; MorabaPanel link preview)' ) );
		$out  = array( 'url' => $url, 'site' => (string) wp_parse_url( $url, PHP_URL_HOST ), 'title' => '', 'description' => '', 'image' => '' );
		if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) && false !== stripos( (string) wp_remote_retrieve_header( $res, 'content-type' ), 'html' ) ) {
			$html = (string) wp_remote_retrieve_body( $res );
			$meta = function ( $names ) use ( $html ) {
				foreach ( $names as $n ) {
					if ( preg_match( '/<meta[^>]+(?:property|name)=["\']' . preg_quote( $n, '/' ) . '["\'][^>]*content=["\']([^"\']*)["\']/i', $html, $mm ) || preg_match( '/<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' . preg_quote( $n, '/' ) . '["\']/i', $html, $mm ) ) {
						return html_entity_decode( trim( $mm[1] ), ENT_QUOTES, 'UTF-8' );
					}
				}
				return '';
			};
			$out['title'] = $meta( array( 'og:title', 'twitter:title' ) );
			if ( '' === $out['title'] && preg_match( '#<title[^>]*>(.*?)</title>#is', $html, $mm ) ) {
				$out['title'] = html_entity_decode( trim( $mm[1] ), ENT_QUOTES, 'UTF-8' );
			}
			$out['description'] = mb_substr( $meta( array( 'og:description', 'description', 'twitter:description' ) ), 0, 200 );
			$img                = $meta( array( 'og:image', 'twitter:image' ) );
			$out['image']       = $img && preg_match( '#^https://#i', $img ) ? esc_url_raw( $img ) : '';
			$site               = $meta( array( 'og:site_name' ) );
			if ( $site ) {
				$out['site'] = $site;
			}
			$out['title'] = mb_substr( wp_strip_all_tags( $out['title'] ), 0, 140 );
		}
		set_transient( $key, $out, DAY_IN_SECONDS );
		return $out;
	}
}

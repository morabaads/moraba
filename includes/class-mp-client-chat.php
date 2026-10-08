<?php
defined( 'ABSPATH' ) || exit;

/**
 * The client portal's chat, with the staff chat's features: files of any format (sent in pieces, like
 * the panel), photos and albums, voice messages, replies, editing and deleting one's own messages,
 * reactions, read ticks both ways and «در حال نوشتن…».
 *
 * A client person has no WordPress user, so where a user id is needed (reactions, reads, typing) they
 * get a stand-in id: PSEUDO + their contact id when logged in, or one made from a random key their
 * browser keeps (GUEST range) when the group needs no login. Their own messages carry the same marks
 * in `extra` (cc: contact id, ck: hashed browser key), so only they can edit or delete them.
 */
class MP_Client_Chat {

	const PSEUDO = 3000000000;
	const GUEST  = 4000000000;
	/** A client may edit or delete their message for this long. */
	const EDIT_WINDOW = 2 * DAY_IN_SECONDS;

	public static function register() {
		$tok = 'client/(?P<token>[A-Za-z0-9]{32})';
		$id  = '(?P<id>\d+)';
		$routes = array(
			array( "$tok/upload", 'POST', 'upload' ),
			array( "$tok/messages/$id", 'POST', 'edit' ),
			array( "$tok/messages/$id", 'DELETE', 'remove' ),
			array( "$tok/messages/$id/react", 'POST', 'react' ),
			array( "$tok/typing", 'POST', 'typing' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => '__return_true' ) );
		}
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_error', $m, array( 'status' => $s ) );
	}

	/* ------------------------------------------------------------------ Who is writing */

	/** The browser's own random key (header X-MP-Client-Key), hashed; '' when there is none. */
	private static function guest_key() {
		$k = isset( $_SERVER['HTTP_X_MP_CLIENT_KEY'] ) ? preg_replace( '/[^A-Za-z0-9]/', '', (string) wp_unslash( $_SERVER['HTTP_X_MP_CLIENT_KEY'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		return strlen( $k ) >= 16 ? substr( hash_hmac( 'sha256', $k, wp_salt( 'auth' ) ), 0, 20 ) : '';
	}

	/** @return array{uid:int,cc:int,ck:string} The stand-in id and the marks of this client person. */
	public static function who( $ch ) {
		$s = MP_Client::session( $ch );
		if ( $s && (int) $s->id ) {
			return array( 'uid' => self::PSEUDO + (int) $s->id, 'cc' => (int) $s->id, 'ck' => '' );
		}
		$ck = self::guest_key();
		return array( 'uid' => '' !== $ck ? self::GUEST + ( hexdec( substr( $ck, 0, 7 ) ) % 1000000000 ) : 0, 'cc' => 0, 'ck' => $ck );
	}

	public static function is_pseudo( $uid ) {
		return (int) $uid >= self::PSEUDO;
	}

	/** Name of a stand-in id (for reactions, «seen by», typing in the panel). */
	public static function pseudo_name( $uid ) {
		global $wpdb;
		$uid = (int) $uid;
		if ( $uid >= self::PSEUDO && $uid < self::GUEST ) {
			$n = $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d', $uid - self::PSEUDO ) );
			return $n ? $n . ' (مشتری)' : 'مشتری';
		}
		return 'مشتری';
	}

	/** Is this message the current client person's own? */
	private static function owns( $m, $who ) {
		if ( (int) $m->user_id || ! empty( $m->kind ) ) {
			return false;
		}
		$x = ! empty( $m->extra ) ? json_decode( $m->extra, true ) : array();
		$x = is_array( $x ) ? $x : array();
		if ( $who['cc'] ) {
			return isset( $x['cc'] ) && (int) $x['cc'] === $who['cc'];
		}
		return '' !== $who['ck'] && isset( $x['ck'] ) && hash_equals( (string) $x['ck'], $who['ck'] );
	}

	/** The group of the link, once the visitor may use it (a supervisor acting as the client may too); WP_Error otherwise. */
	private static function group( WP_REST_Request $r ) {
		$ch = MP_Client::channel( (string) $r['token'] );
		$g  = MP_Client::gate( $ch );
		return $g ? $g : $ch;
	}

	private static function own_message( WP_REST_Request $r, $ch ) {
		global $wpdb;
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d AND channel_id = %d', (int) $r['id'], $ch->id ) );
		return $m && empty( $m->deleted_at ) ? $m : null;
	}

	/* ------------------------------------------------------------------ Payloads */

	/** The staff's furthest read message (the client's second tick). */
	public static function team_read( $channel_id ) {
		$max = 0;
		foreach ( MP_Rest::channel_reads( $channel_id ) as $u => $last ) {
			if ( ! self::is_pseudo( $u ) ) {
				$max = max( $max, $last );
			}
		}
		return $max;
	}

	public static function file_out( $id, $token ) {
		$p = MP_Files::payload( MP_Files::get( $id ) );
		if ( $p ) {
			foreach ( array( 'url', 'mid' ) as $k ) { // thumb is a data: URI
				if ( ! empty( $p[ $k ] ) ) {
					$p[ $k ] = add_query_arg( 't', $token, $p[ $k ] );
				}
			}
		}
		return $p;
	}

	/** One message as the portal shows it. */
	public static function payload( $m, $ch, $who ) {
		if ( ! empty( $m->deleted_at ) ) {
			return array( 'id' => (int) $m->id, 'deleted' => true );
		}
		$u = $m->user_id ? get_userdata( $m->user_id ) : null;
		$e = MP_Chat::extra( $m, $who['uid'] );
		$x = MP_Chat::x_client( $m );
		if ( $x && isset( $x['quote'] ) && $e['reply'] ) {
			unset( $x['quote'] );
		}
		$reply = null;
		if ( $e['reply'] ) {
			$q     = $e['reply'];
			$reply = array( 'id' => $q['id'], 'author' => $q['author'], 'text' => $q['text'], 'kind' => $q['kind'] );
		}
		return array(
			'id'         => (int) $m->id,
			'author'     => $u ? $u->display_name : ( ! empty( $m->kind ) ? 'مربع استودیو' : ( $m->guest_name ? $m->guest_name : $ch->client_name ) ),
			'avatar'     => $u ? MP_Util::avatar_url( $u->ID ) : '',
			'team'       => (bool) $m->user_id,
			'mine'       => self::owns( $m, $who ),
			'body'       => $m->body,
			'file'       => $m->file_id ? self::file_out( $m->file_id, $ch->token ) : null,
			'created_at' => $m->created_at,
			'edited'     => $e['edited'],
			'album'      => $e['album'],
			'as_file'    => $e['as_file'],
			'reply'      => $reply,
			'reactions'  => array_map(
				function ( $g ) {
					return array( 'emoji' => $g['emoji'], 'count' => $g['count'], 'mine' => $g['mine'], 'names' => $g['names'] );
				},
				$e['reactions']
			),
			'x'          => $x,
		) + MP_Client::msg_extra( $m );
	}

	/**
	 * GET client/{token}?after=&since= — new messages, the ones edited / deleted / reacted to since the last
	 * call, how far the team has read, and who of the team is typing. Marks the chat read for the client.
	 */
	public static function messages( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$who   = self::who( $ch );
		$after = (int) $r['after'];
		$rows  = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM (SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND deleted_at IS NULL ORDER BY id DESC LIMIT 200) x ORDER BY id', $ch->id, $after ) );
		$since = preg_match( '/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', (string) $r['since'] ) ? (string) $r['since'] : '';
		$chg   = array();
		if ( $after && '' !== $since ) {
			$chg = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id <= %d AND (updated_at >= %s OR deleted_at >= %s OR edited_at >= %s) ORDER BY id LIMIT 300', $ch->id, $after, $since, $since, $since ) );
		}
		MP_Chat::preload( array_merge( $rows, $chg ) );
		$out = array();
		foreach ( $rows as $m ) {
			$out[] = self::payload( $m, $ch, $who );
		}
		$changed = array();
		foreach ( $chg as $m ) {
			$changed[] = self::payload( $m, $ch, $who );
		}
		$gone = get_transient( 'mp_purged_' . $ch->id );
		$max  = $rows ? (int) end( $rows )->id : $after;
		// The client has now seen everything up to here: the team's ticks turn blue.
		if ( $who['uid'] && $max && ! MP_Client::is_preview( $ch ) ) {
			$was = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $who['uid'] ) );
			if ( $max > $was ) {
				$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $ch->id, 'user_id' => $who['uid'], 'last_id' => $max, 'got_id' => $max ) );
				MP_Live::bump();
			}
		}
		$typing = array();
		foreach ( MP_Rest::activity_of( $ch->id, $who['uid'] ) as $a ) {
			if ( ! self::is_pseudo( $a['user_id'] ) ) {
				$typing[] = array( 'name' => $a['name'], 'state' => $a['state'] );
			}
		}
		return array(
			'title'    => $ch->title,
			'client'   => $ch->client_name,
			'messages' => $out,
			'changed'  => $changed,
			'removed'  => is_array( $gone ) ? array_map( 'intval', array_keys( $gone ) ) : array(),
			'read'     => self::team_read( $ch->id ),
			'typing'   => $typing,
			'now'      => MP_Util::now(),
			'can_edit' => (bool) $who['uid'],
		);
	}

	/**
	 * POST client/{token} {body, name, file_id?, reply_to?, album?, as_file?, dur?, round?} — a message from
	 * the client: text, a file uploaded through client/{token}/upload, or both.
	 */
	public static function send( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$file = (int) $r['file_id'];
		if ( ! MP_Rest::client_rate_ok( $ch->id, $file ? 120 : 60 ) ) {
			return self::err( 'تعداد پیام‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.', 429 );
		}
		$body = MP_Util::long_text( $r['body'], 4000 );
		if ( $file ) {
			$f = MP_Files::get( $file );
			// Only a file this group's client just uploaded, not yet in a message.
			if ( ! $f || 'message' !== $f->context || (int) $f->context_id !== (int) $ch->id || (int) $f->user_id || $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'messages' ) . ' WHERE file_id = %d LIMIT 1', $file ) ) ) {
				return self::err( 'فایل پیدا نشد؛ دوباره بفرستید.', 404 );
			}
		}
		if ( '' === trim( $body ) && ! $file ) {
			return self::err( 'متن پیام را بنویسید.' );
		}
		$who = self::who( $ch );
		$x   = array();
		if ( $who['cc'] ) {
			$x['cc'] = $who['cc'];
		} elseif ( '' !== $who['ck'] ) {
			$x['ck'] = $who['ck'];
		}
		if ( $file && (int) $r['dur'] ) {
			$x['dur'] = min( 36000, (int) $r['dur'] );
		}
		if ( $file && $r['round'] && 'false' !== $r['round'] ) {
			$x['round'] = 1;
		}
		$row = array(
			'channel_id' => $ch->id,
			'user_id'    => 0,
			'guest_name' => MP_Client::author( $ch, $r['name'] ),
			'body'       => $body,
			'file_id'    => $file,
			'created_at' => MP_Util::now(),
			'updated_at' => MP_Util::now(),
		);
		$reply = (int) $r['reply_to'];
		if ( $reply && (int) $wpdb->get_var( $wpdb->prepare( 'SELECT channel_id FROM ' . self::t( 'messages' ) . ' WHERE id = %d AND deleted_at IS NULL', $reply ) ) === (int) $ch->id ) {
			$row['reply_to'] = $reply;
		}
		$album = preg_replace( '/[^a-z0-9]/i', '', (string) $r['album'] );
		if ( '' !== $album && $file ) {
			$row['album'] = substr( $album, 0, 24 );
		}
		if ( $file && $r['as_file'] && 'false' !== $r['as_file'] ) {
			$row['as_file'] = 1;
		}
		if ( $x ) {
			$row['extra'] = wp_json_encode( $x, JSON_UNESCAPED_UNICODE );
		}
		$wpdb->insert( self::t( 'messages' ), $row );
		$id = (int) $wpdb->insert_id;
		if ( $who['uid'] ) {
			$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $ch->id, 'user_id' => $who['uid'], 'last_id' => $id, 'got_id' => $id ) );
			MP_Live::set_activity( (int) $ch->id, $who['uid'], 'idle' );
		}
		MP_Live::bump();
		MP_Client::log_acting( $ch, $file ? 'فرستادن فایل' : 'پیام: ' . wp_trim_words( $body, 10 ) );
		$m       = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $id ) );
		$preview = '' !== trim( $body ) ? wp_trim_words( MP_Chat::plain( $body ), 12 ) : MP_Chat::snippet( $m );
		foreach ( MP_Rest::channel_members( $ch ) as $member ) {
			if ( ! MP_Chat::muted( $ch->id, $member ) ) {
				MP_Notify::event( 'message_client', $member, array( 'GROUP' => $ch->title, 'PREVIEW' => $preview ), 'messages', $ch->id );
			}
		}
		return array( 'sent' => true, 'message' => self::payload( $m, $ch, $who ) );
	}

	/** POST client/{token}/upload — one piece of a file (see MP_Chat::chunk_into); the last returns the file. */
	public static function upload( WP_REST_Request $r ) {
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$who = self::who( $ch );
		$key = $who['uid'] ? 'c' . $who['uid'] : 'c' . substr( md5( isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '' ), 0, 12 ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( 0 === (int) $r['index'] && ! MP_Rest::client_rate_ok( $ch->id . 'u', 120 ) ) {
			return self::err( 'تعداد فایل‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.', 429 );
		}
		return MP_Chat::chunk_into( $r, (int) $ch->id, $key, 0 );
	}

	/** POST client/{token}/messages/{id} {body} — the client edits their own message. */
	public static function edit( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$who = self::who( $ch );
		$m   = self::own_message( $r, $ch );
		if ( ! $m || ! self::owns( $m, $who ) ) {
			return self::err( 'فقط پیام‌های خودتان را می‌توانید ویرایش کنید.', 403 );
		}
		if ( strtotime( $m->created_at ) < strtotime( MP_Util::now() ) - self::EDIT_WINDOW ) {
			return self::err( 'پیام‌های قدیمی‌تر از دو روز ویرایش نمی‌شوند.', 403 );
		}
		$body = MP_Util::long_text( $r['body'], 4000 );
		if ( '' === trim( $body ) && ! $m->file_id ) {
			return self::err( 'متن پیام خالی است.' );
		}
		if ( $body !== $m->body ) {
			$wpdb->insert( self::t( 'msg_edits' ), array( 'message_id' => $m->id, 'body' => (string) $m->body, 'edited_at' => ! empty( $m->edited_at ) ? $m->edited_at : $m->created_at ) );
			$wpdb->update( self::t( 'messages' ), array( 'body' => $body, 'edited_at' => MP_Util::now(), 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
			MP_Live::bump();
		}
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $m->id ) );
		return self::payload( $m, $ch, $who );
	}

	/** DELETE client/{token}/messages/{id} — the client removes their own message (kept for the site admin). */
	public static function remove( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$m = self::own_message( $r, $ch );
		if ( ! $m || ! self::owns( $m, self::who( $ch ) ) ) {
			return self::err( 'فقط پیام‌های خودتان را می‌توانید حذف کنید.', 403 );
		}
		$wpdb->update( self::t( 'messages' ), array( 'deleted_at' => MP_Util::now(), 'deleted_by' => 0, 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		MP_Live::bump();
		return array( 'id' => (int) $m->id, 'deleted' => true );
	}

	/** POST client/{token}/messages/{id}/react {emoji} — one reaction per person; the same again takes it back. */
	public static function react( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$who = self::who( $ch );
		$m   = self::own_message( $r, $ch );
		if ( ! $m || ! $who['uid'] ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$emoji = (string) $r['emoji'];
		if ( ! in_array( $emoji, MP_Chat::REACTIONS, true ) ) {
			return self::err( 'این واکنش پشتیبانی نمی‌شود.' );
		}
		$was = $wpdb->get_var( $wpdb->prepare( 'SELECT emoji FROM ' . self::t( 'reactions' ) . ' WHERE message_id = %d AND user_id = %d', $m->id, $who['uid'] ) );
		if ( $was === $emoji ) {
			$wpdb->delete( self::t( 'reactions' ), array( 'message_id' => $m->id, 'user_id' => $who['uid'] ) );
		} else {
			$wpdb->replace( self::t( 'reactions' ), array( 'message_id' => $m->id, 'user_id' => $who['uid'], 'emoji' => $emoji, 'created_at' => MP_Util::now() ) );
		}
		$wpdb->update( self::t( 'messages' ), array( 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		MP_Live::bump();
		return self::payload( $m, $ch, $who );
	}

	/** POST client/{token}/typing {state: typing|recording|idle} — shown in the panel's chat header. */
	public static function typing( WP_REST_Request $r ) {
		$ch = self::group( $r );
		if ( is_wp_error( $ch ) ) {
			return $ch;
		}
		$who = self::who( $ch );
		if ( $who['uid'] ) {
			MP_Live::set_activity( (int) $ch->id, $who['uid'], MP_Util::pick( $r['state'], array( 'typing', 'recording', 'uploading', 'idle' ), 'idle' ) );
		}
		return array( 'ok' => true );
	}
}

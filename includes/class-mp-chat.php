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
			array( "messages/$id/vote", 'POST', 'vote' ),
			array( "messages/$id/poll-close", 'POST', 'poll_close' ),
			array( "messages/$id/edits", 'GET', 'edits' ),
			array( "messages/$id/hide", 'POST', 'hide' ),
			array( "messages/$id/remind", 'POST', 'remind' ),
			array( "messages/$id/translate", 'POST', 'translate' ),
			array( "messages/$id/locate", 'GET', 'locate' ),
			array( "messages/$id/review", 'POST', 'review' ),
			array( "channels/$id/settings", 'POST', 'save_settings' ),
			array( "channels/$id/roles", 'GET', 'roles' ),
			array( "channels/$id/roles", 'POST', 'set_role' ),
			array( "channels/$id/invite", 'POST', 'invite' ),
			array( 'chat-join', 'POST', 'join' ),
			array( "channels/$id/topics", 'GET', 'topics' ),
			array( "channels/$id/topics", 'POST', 'save_topic' ),
			array( "topics/$id", 'DELETE', 'delete_topic' ),
			array( "channels/$id/scheduled", 'GET', 'scheduled' ),
			array( "scheduled/$id", 'DELETE', 'unschedule' ),
			array( "scheduled/$id/now", 'POST', 'send_scheduled_now' ),
			array( "channels/$id/archive", 'POST', 'archive_me' ),
			array( "channels/$id/mark", 'POST', 'mark_unread' ),
			array( "channels/$id/look", 'POST', 'look' ),
			array( "channels/$id/date", 'GET', 'at_date' ),
			array( "channels/$id/summary", 'POST', 'summary' ),
			array( 'channels/pins-order', 'POST', 'pins_order' ),
			array( 'chat-cards', 'GET', 'cards' ),
			array( 'stickers', 'GET', 'stickers' ),
			array( 'stickers', 'POST', 'add_sticker' ),
			array( "stickers/$id", 'DELETE', 'delete_sticker' ),
			array( 'chat-upload/status', 'GET', 'chunk_status' ),
			array( "messages/$id/edit", 'POST', 'edit' ),
			array( "messages/$id/react", 'POST', 'react' ),
			array( "messages/$id/pin", 'POST', 'pin' ),
			array( "messages/$id/forward", 'POST', 'forward' ),
			array( "messages/$id/seen", 'GET', 'seen_by' ),
			array( 'messages/search', 'GET', 'search_all' ),
			array( "channels/$id/search", 'GET', 'search' ),
			array( "channels/$id/media", 'GET', 'media' ),
			array( "channels/$id/media-counts", 'GET', 'media_counts' ),
			array( 'chat-folders', 'GET', 'folders' ),
			array( 'drafts', 'GET', 'drafts' ),
			array( 'drafts', 'POST', 'save_draft' ),
			array( 'chat-folders', 'POST', 'save_folders' ),
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
	private static $votes     = array();
	private static $gots      = array();

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
		if ( $ids ) {
			foreach ( $ids as $i ) {
				self::$votes[ $i ] = array();
			}
			foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'poll_votes' ) . ' WHERE message_id IN (' . implode( ',', $ids ) . ')' ) as $x ) { // phpcs:ignore
				self::$votes[ (int) $x->message_id ][] = $x;
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
		$x    = self::x( $m );
		if ( ! empty( $x['poll'] ) ) {
			return '📊 ' . $x['poll']['q'];
		}
		if ( ! empty( $x['loc'] ) ) {
			return '📍 موقعیت مکانی' . ( ! empty( $x['loc']['label'] ) ? ': ' . $x['loc']['label'] : '' );
		}
		if ( ! empty( $x['contact'] ) ) {
			return '👤 مخاطب: ' . $x['contact']['name'];
		}
		if ( ! empty( $x['card'] ) ) {
			return ( 'task' === $x['card']['t'] ? '✅ تسک' : '📁 پروژه' ) . ( ! empty( $x['card']['title'] ) ? ': ' . $x['card']['title'] : '' );
		}
		$body = trim( preg_replace( '/\s+/u', ' ', self::plain( (string) $m->body ) ) );
		if ( '' !== $body ) {
			return mb_substr( $body, 0, 120 );
		}
		if ( ! empty( $x['sticker'] ) ) {
			return 'استیکر';
		}
		if ( ! empty( $x['gif'] ) ) {
			return 'GIF';
		}
		if ( ! empty( $x['round'] ) ) {
			return 'پیام ویدیویی';
		}
		if ( $m->file_id ) {
			$f = MP_Files::get( $m->file_id );
			if ( $f && 0 === strpos( $f->mime, 'audio/' ) ) {
				return 'پیام صوتی';
			}
			if ( $f && 0 === strpos( $f->mime, 'image/' ) && empty( $m->as_file ) ) {
				return 'عکس';
			}
			if ( $f && 0 === strpos( $f->mime, 'video/' ) && empty( $m->as_file ) ) {
				return 'ویدیو';
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
				$u                              = MP_Client_Chat::is_pseudo( $x->user_id ) ? null : get_userdata( $x->user_id );
				$groups[ $x->emoji ]['names'][] = $u ? $u->display_name : ( MP_Client_Chat::is_pseudo( $x->user_id ) ? MP_Client_Chat::pseudo_name( $x->user_id ) : '' );
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
			'x'         => self::x_out( $m, $uid ),
			'topic_id'  => isset( $m->topic_id ) ? (int) $m->topic_id : 0,
			'silent'    => ! empty( $m->silent ),
			'got'       => (int) $m->user_id === (int) $uid && self::got( $m ),
		);
	}

	/** Reply / album / «as file» / extras (poll, place, contact, sticker…) / topic / silent on a new message. */
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
		if ( $r['silent'] && 'false' !== $r['silent'] ) {
			$row['silent'] = 1;
		}
		$x = self::x_in( is_array( $r['x'] ) ? $r['x'] : array(), $ch, isset( $row['reply_to'] ) ? $row['reply_to'] : 0, ! empty( $row['file_id'] ) );
		if ( is_wp_error( $x ) ) {
			return $x;
		}
		if ( $x ) {
			$row['extra'] = wp_json_encode( $x, JSON_UNESCAPED_UNICODE );
		}
		$topic = self::topic_for( $ch, (int) $r['topic_id'] );
		if ( is_wp_error( $topic ) ) {
			return $topic;
		}
		if ( $topic ) {
			$row['topic_id'] = $topic;
		}
		return $row;
	}

	/** The extras a message may carry, cleaned. Unknown keys are dropped. */
	public static function x_in( array $in, $ch, $reply_to, $has_file ) {
		$x = array();
		if ( ! empty( $in['poll'] ) && is_array( $in['poll'] ) ) {
			$q    = MP_Util::text( isset( $in['poll']['q'] ) ? $in['poll']['q'] : '', 255 );
			$opts = array();
			foreach ( (array) ( isset( $in['poll']['o'] ) ? $in['poll']['o'] : array() ) as $o ) {
				$o = MP_Util::text( $o, 100 );
				if ( '' !== $o ) {
					$opts[] = $o;
				}
			}
			if ( '' === $q || count( $opts ) < 2 ) {
				return new WP_Error( 'mp_error', 'سؤال نظرسنجی و دست‌کم دو گزینه را بنویسید.', array( 'status' => 400 ) );
			}
			$x['poll'] = array( 'q' => $q, 'o' => array_slice( $opts, 0, 10 ), 'multi' => ! empty( $in['poll']['multi'] ), 'anon' => ! empty( $in['poll']['anon'] ) );
		}
		if ( ! empty( $in['loc'] ) && is_array( $in['loc'] ) ) {
			$lat = (float) $in['loc']['lat'];
			$lng = (float) $in['loc']['lng'];
			if ( abs( $lat ) > 90 || abs( $lng ) > 180 || ( ! $lat && ! $lng ) ) {
				return new WP_Error( 'mp_error', 'موقعیت مکانی معتبر نیست.', array( 'status' => 400 ) );
			}
			$x['loc'] = array( 'lat' => round( $lat, 6 ), 'lng' => round( $lng, 6 ), 'label' => MP_Util::text( isset( $in['loc']['label'] ) ? $in['loc']['label'] : '', 120 ) );
		}
		if ( ! empty( $in['contact'] ) && is_array( $in['contact'] ) ) {
			$name  = MP_Util::text( isset( $in['contact']['name'] ) ? $in['contact']['name'] : '', 80 );
			$phone = preg_replace( '/[^0-9+]/', '', J_latin( isset( $in['contact']['phone'] ) ? (string) $in['contact']['phone'] : '' ) );
			$uid   = (int) ( isset( $in['contact']['uid'] ) ? $in['contact']['uid'] : 0 );
			if ( $uid && ! MP_Util::is_panel_user( $uid ) ) {
				$uid = 0;
			}
			if ( '' === $name || ( '' === $phone && ! $uid ) ) {
				return new WP_Error( 'mp_error', 'نام و شماره مخاطب را وارد کنید.', array( 'status' => 400 ) );
			}
			$x['contact'] = array( 'name' => $name, 'phone' => substr( $phone, 0, 20 ), 'uid' => $uid );
		}
		if ( ! empty( $in['card'] ) && is_array( $in['card'] ) ) {
			$t  = 'project' === ( isset( $in['card']['t'] ) ? $in['card']['t'] : '' ) ? 'project' : 'task';
			$id = (int) ( isset( $in['card']['id'] ) ? $in['card']['id'] : 0 );
			$c  = self::card( $t, $id );
			if ( $c ) {
				$x['card'] = array( 't' => $t, 'id' => $id, 'title' => $c['title'] );
			}
		}
		foreach ( array( 'sticker', 'gif', 'round' ) as $k ) {
			if ( ! empty( $in[ $k ] ) && $has_file ) {
				$x[ $k ] = 1;
			}
		}
		if ( ! empty( $in['quote'] ) && $reply_to ) {
			$x['quote'] = mb_substr( MP_Util::long_text( $in['quote'], 600 ), 0, 600 );
		}
		if ( ! empty( $in['pt'] ) && is_array( $in['pt'] ) && $reply_to ) {
			$x['pt'] = array( 'x' => max( 0, min( 1, round( (float) $in['pt']['x'], 4 ) ) ), 'y' => max( 0, min( 1, round( (float) $in['pt']['y'], 4 ) ) ) );
		}
		if ( ! empty( $in['wave'] ) && is_array( $in['wave'] ) ) {
			$x['wave'] = array_slice( array_map( function ( $v ) { return max( 0, min( 31, (int) $v ) ); }, $in['wave'] ), 0, 64 );
		}
		foreach ( array( 'dur', 'w', 'h' ) as $k ) {
			if ( isset( $in[ $k ] ) && (float) $in[ $k ] > 0 ) {
				$x[ $k ] = round( min( 100000, (float) $in[ $k ] ), 1 );
			}
		}
		if ( ! empty( $in['thumb'] ) ) {
			$f = MP_Files::get( (int) $in['thumb'] );
			if ( $f && (int) $f->user_id === get_current_user_id() && 0 === strpos( $f->mime, 'image/' ) ) {
				MP_Files::claim( (int) $f->id, 'message', $ch->id );
				$x['thumb'] = (int) $f->id;
			}
		}
		return $x;
	}

	/** A message's extras as stored. */
	public static function x( $m ) {
		if ( empty( $m->extra ) ) {
			return array();
		}
		$x = json_decode( $m->extra, true );
		return is_array( $x ) ? $x : array();
	}

	/** Extras for the browser: poll results, the poster's URL, a task/project card's live state. */
	public static function x_out( $m, $uid ) {
		global $wpdb;
		$x = self::x( $m );
		if ( ! $x ) {
			return null;
		}
		if ( ! empty( $x['poll'] ) ) {
			$id = (int) $m->id;
			if ( ! array_key_exists( $id, self::$votes ) ) {
				self::$votes[ $id ] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'poll_votes' ) . ' WHERE message_id = %d', $id ) );
			}
			$counts = array_fill( 0, count( $x['poll']['o'] ), 0 );
			$mine   = array();
			$people = array();
			$who    = array_fill( 0, count( $x['poll']['o'] ), array() );
			foreach ( self::$votes[ $id ] as $v ) {
				$o = (int) $v->opt;
				if ( ! isset( $counts[ $o ] ) ) {
					continue;
				}
				++$counts[ $o ];
				$people[ (int) $v->user_id ] = 1;
				if ( (int) $v->user_id === (int) $uid ) {
					$mine[] = $o;
				}
				if ( empty( $x['poll']['anon'] ) && count( $who[ $o ] ) < 12 ) {
					$u           = get_userdata( $v->user_id );
					$who[ $o ][] = $u ? $u->display_name : '';
				}
			}
			$x['poll']['counts'] = $counts;
			$x['poll']['mine']   = $mine;
			$x['poll']['voters'] = count( $people );
			$x['poll']['who']    = empty( $x['poll']['anon'] ) ? $who : array();
			$x['poll']['closed'] = ! empty( $x['poll']['closed'] );
			$x['poll']['can_close'] = (int) $m->user_id === (int) $uid || MP_Util::is_manager( $uid );
		}
		if ( ! empty( $x['thumb'] ) ) {
			$x['thumb_url'] = MP_Files::url( (int) $x['thumb'] );
		}
		if ( ! empty( $x['card'] ) ) {
			$c = self::card( $x['card']['t'], (int) $x['card']['id'] );
			$x['card'] = $c ? $c + array( 't' => $x['card']['t'], 'id' => (int) $x['card']['id'] ) : array( 't' => $x['card']['t'], 'id' => (int) $x['card']['id'], 'gone' => true, 'title' => isset( $x['card']['title'] ) ? $x['card']['title'] : '' );
		}
		if ( ! empty( $x['review'] ) ) {
			$u                   = get_userdata( (int) $x['review']['by'] );
			$x['review']['name'] = $u ? $u->display_name : '';
		}
		return $x;
	}

	/** What the client portal shows of a message's extras (no names of voters, no internal task details). */
	public static function x_client( $m ) {
		$x = self::x( $m );
		if ( ! $x ) {
			return null;
		}
		$out = array();
		if ( ! empty( $x['poll'] ) ) {
			$full        = self::x_out( $m, 0 );
			$out['poll'] = array( 'q' => $x['poll']['q'], 'o' => $x['poll']['o'], 'counts' => $full['poll']['counts'], 'closed' => ! empty( $x['poll']['closed'] ) );
		}
		foreach ( array( 'loc', 'sticker', 'gif', 'round', 'dur', 'quote' ) as $k ) {
			if ( isset( $x[ $k ] ) ) {
				$out[ $k ] = $x[ $k ];
			}
		}
		if ( ! empty( $x['contact'] ) ) {
			$out['contact'] = array( 'name' => $x['contact']['name'], 'phone' => $x['contact']['phone'] );
		}
		if ( ! empty( $x['card'] ) ) {
			$out['card'] = array( 't' => $x['card']['t'], 'title' => isset( $x['card']['title'] ) ? $x['card']['title'] : '' );
		}
		return $out ? $out : null;
	}

	/** Formatting marks (**bold**, __italic__, ~~strike~~, `code`, ||spoiler||, [text](link)) taken out. */
	public static function plain( $s ) {
		$s = preg_replace( '/\[([^\]\n]+)\]\((?:https?:\/\/|task:|project:)[^)\s]+\)/u', '$1', $s );
		return str_replace( array( '**', '__', '~~', '||', '```', '`' ), '', $s );
	}

	/** «@Name» in a message: the named members get a notification (even in a muted chat, like Telegram). */
	public static function mentions( $ch, $uid, $body, $preview, $actor = null ) {
		if ( false === mb_strpos( (string) $body, '@' ) ) {
			return;
		}
		$actor = null === $actor ? wp_get_current_user()->display_name : $actor;
		$title = 'direct' === $ch->type ? 'گفت‌وگوی خصوصی' : $ch->title;
		foreach ( MP_Rest::channel_members( $ch ) as $member ) {
			$u = get_userdata( $member );
			if ( ! $u || (int) $member === (int) $uid || 'direct' === $ch->type ) {
				continue;
			}
			$names = array_filter( array( $u->display_name, strtok( $u->display_name, ' ' ) ) );
			foreach ( $names as $n ) {
				if ( preg_match( '/(^|\s)@' . preg_quote( $n, '/' ) . '(?=$|[\s،,.!؟?:])/u', $body ) ) {
					MP_Notify::event( 'message_mention', $member, array( 'ACTOR' => $actor, 'GROUP' => $title, 'PREVIEW' => $preview ), 'messages', $ch->id, true );
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
		$read = $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(last_id) FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d', $ch->id ) ) . '-' . $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(got_id) FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d', $ch->id ) );
		$pin  = (string) $wpdb->get_var( $wpdb->prepare( "SELECT CONCAT(pinned_msg, ':', pins) FROM " . self::t( 'channels' ) . ' WHERE id = %d', $ch->id ) );
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
			usleep( 400000 );
			$wpdb->flush();
			wp_cache_delete( 'alloptions', 'options' );
			wp_cache_delete( MP_Live::ACT, 'options' );
		}
	}

	/* ------------------------------------------------------------------ Pinned message */

	/** The pinned messages of a chat, newest pin first: the newest with its fields, and «all» of them (Telegram). */
	public static function pinned( $ch, $uid ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT pinned_msg, pins FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $ch->id ) );
		if ( ! $row ) {
			return null;
		}
		$ids = self::pin_ids( $row );
		$all = array();
		foreach ( $ids as $pid ) {
			$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d AND channel_id = %d', $pid, $ch->id ) );
			if ( $m && empty( $m->deleted_at ) ) {
				$all[] = array( 'id' => (int) $m->id, 'author' => self::author( $m ), 'text' => self::snippet( $m ), 'kind' => self::kind_of( $m ) );
			}
		}
		if ( ! $all ) {
			return null;
		}
		return $all[0] + array( 'all' => $all );
	}
	private static function pin_ids( $row ) {
		$ids = array_filter( array_map( 'intval', explode( ',', (string) $row->pins ) ) );
		if ( (int) $row->pinned_msg && ! in_array( (int) $row->pinned_msg, $ids, true ) ) {
			array_unshift( $ids, (int) $row->pinned_msg ); // pinned before several pins existed
		}
		return array_values( $ids );
	}

	/** POST messages/{id}/pin {on} — one pinned message per chat, for every member. */
	public static function pin( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$on = $r['on'] && 'false' !== $r['on'];
		if ( 'admin' !== self::role_of( $ch, self::uid() ) && 'channel' === self::settings( $ch )['mode'] ) {
			return self::err( 'فقط مدیران کانال می‌توانند پیام سنجاق کنند.', 403 );
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT pinned_msg, pins FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $ch->id ) );
		$ids = array_values( array_diff( self::pin_ids( $row ), array( (int) $m->id ) ) );
		if ( $on ) {
			array_unshift( $ids, (int) $m->id ); // several pins, newest first (at most 20)
		}
		$ids = array_slice( $ids, 0, 20 );
		$wpdb->update( self::t( 'channels' ), array( 'pinned_msg' => $ids ? $ids[0] : 0, 'pins' => implode( ',', $ids ) ), array( 'id' => $ch->id ) );
		self::touch( $m->id );
		MP_Live::bump();
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
		if ( $body === $m->body ) {
			return MP_Rest::message_payload( $m, self::uid(), MP_Rest::channel_reads( $ch->id ) );
		}
		// The earlier text is kept: «ویرایش‌شده» opens the history.
		$wpdb->insert( self::t( 'msg_edits' ), array( 'message_id' => $m->id, 'body' => (string) $m->body, 'edited_at' => ! empty( $m->edited_at ) ? $m->edited_at : $m->created_at ) );
		$wpdb->update( self::t( 'messages' ), array( 'body' => $body, 'edited_at' => MP_Util::now(), 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		MP_Live::bump();
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
		MP_Live::bump();
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
			if ( is_wp_error( self::can_post( $to, $uid ) ) ) {
				continue;
			}
			$x = self::x( $m );
			unset( $x['quote'], $x['pt'], $x['review'] );
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
					'extra'      => $x ? wp_json_encode( $x, JSON_UNESCAPED_UNICODE ) : null,
					'created_at' => MP_Util::now(),
				)
			);
			$wpdb->replace( self::t( 'reads' ), array( 'channel_id' => $to->id, 'user_id' => $uid, 'last_id' => (int) $wpdb->insert_id, 'got_id' => (int) $wpdb->insert_id ) );
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
				if ( MP_Client_Chat::is_pseudo( $who ) ) {
					$out[] = array( 'id' => 0, 'name' => MP_Client_Chat::pseudo_name( $who ), 'avatar' => '' );
					continue;
				}
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

	/** Search filters: ?from=user, ?kind=photo|video|file|link|voice, ?d1=, ?d2= (dates). */
	private static function filters( WP_REST_Request $r, &$args ) {
		$f   = self::t( 'files' );
		$sql = '';
		if ( (int) $r['from'] ) {
			$sql   .= ' AND m.user_id = %d';
			$args[] = (int) $r['from'];
		}
		$kind = MP_Util::pick( (string) $r['kind'], array( 'photo', 'video', 'file', 'link', 'voice', '' ), '' );
		if ( 'photo' === $kind ) {
			$sql .= " AND m.as_file = 0 AND m.file_id IN (SELECT id FROM $f WHERE mime LIKE 'image/%%')";
		} elseif ( 'video' === $kind ) {
			$sql .= " AND m.file_id IN (SELECT id FROM $f WHERE mime LIKE 'video/%%')";
		} elseif ( 'voice' === $kind ) {
			$sql .= " AND m.file_id IN (SELECT id FROM $f WHERE mime LIKE 'audio/%%')";
		} elseif ( 'file' === $kind ) {
			$sql .= " AND m.file_id > 0 AND (m.as_file = 1 OR m.file_id IN (SELECT id FROM $f WHERE mime NOT LIKE 'image/%%' AND mime NOT LIKE 'audio/%%' AND mime NOT LIKE 'video/%%'))";
		} elseif ( 'link' === $kind ) {
			$sql .= " AND m.body LIKE '%%http%%'";
		}
		foreach ( array( 'd1' => '>=', 'd2' => '<=' ) as $k => $op ) {
			if ( MP_Util::valid_date( (string) $r[ $k ] ) ) {
				$sql   .= ' AND m.created_at ' . $op . ' %s';
				$args[] = $r[ $k ] . ( 'd1' === $k ? ' 00:00:00' : ' 23:59:59' );
			}
		}
		return $sql;
	}

	/** GET channels/{id}/search?q=&from=&kind=&d1=&d2= — the text is optional when a filter is set. */
	public static function search( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		$q   = trim( MP_Util::text( $r['q'], 80 ) );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$args = array( $ch->id );
		$more = self::filters( $r, $args );
		if ( mb_strlen( $q ) < 2 && '' === $more ) {
			return array();
		}
		$sql = 'SELECT m.* FROM ' . self::t( 'messages' ) . ' m LEFT JOIN ' . self::t( 'files' ) . ' f ON f.id = m.file_id WHERE m.channel_id = %d AND m.deleted_at IS NULL' . $more . self::not_hidden( $uid, 'm' );
		if ( mb_strlen( $q ) >= 2 ) {
			$like = '%' . $wpdb->esc_like( $q ) . '%';
			$sql .= ' AND (m.body LIKE %s OR m.transcript LIKE %s OR f.name LIKE %s OR m.extra LIKE %s)';
			$args = array_merge( $args, array( $like, $like, $like, '%' . $wpdb->esc_like( trim( wp_json_encode( $q ), '"' ) ) . '%' ) );
		}
		$rows = $wpdb->get_results( $wpdb->prepare( $sql . ' ORDER BY m.id DESC LIMIT 100', $args ) ); // phpcs:ignore
		return array_map( function ( $m ) {
			return self::hit( $m, '' );
		}, $rows );
	}

	/** GET messages/search?q=&from=&kind=&d1=&d2= — every chat I am in. */
	public static function search_all( WP_REST_Request $r ) {
		global $wpdb;
		$uid    = self::uid();
		$q      = trim( MP_Util::text( $r['q'], 80 ) );
		$titles = array();
		foreach ( MP_Rest::channels_for( $uid ) as $ch ) {
			if ( empty( $ch->archived_at ) ) {
				$p                       = MP_Rest::channel_payload( $ch, $uid );
				$titles[ (int) $ch->id ] = $p['title'];
			}
		}
		$args = array();
		$more = self::filters( $r, $args );
		if ( ! $titles || ( mb_strlen( $q ) < 2 && '' === $more ) ) {
			return array();
		}
		$sql = 'SELECT m.* FROM ' . self::t( 'messages' ) . ' m WHERE m.channel_id IN (' . implode( ',', array_keys( $titles ) ) . ') AND m.deleted_at IS NULL' . $more . self::not_hidden( $uid, 'm' );
		if ( mb_strlen( $q ) >= 2 ) {
			$like = '%' . $wpdb->esc_like( $q ) . '%';
			$sql .= ' AND (m.body LIKE %s OR m.transcript LIKE %s)';
			$args = array_merge( $args, array( $like, $like ) );
		}
		$sql .= ' ORDER BY m.id DESC LIMIT 60';
		$rows = $wpdb->get_results( $args ? $wpdb->prepare( $sql, $args ) : str_replace( '%%', '%', $sql ) ); // phpcs:ignore
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
		$hide = self::not_hidden( $uid, 'm' );
		$m    = self::t( 'messages' );
		$f    = self::t( 'files' );
		$base = "SELECT m.*, f.mime fmime FROM $m m JOIN $f f ON f.id = m.file_id WHERE m.channel_id = %d AND m.deleted_at IS NULL AND m.file_id > 0" . $hide;
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
		$where = 'media' === $kind ? " AND (f.mime LIKE 'image/%%' OR f.mime LIKE 'video/%%') AND m.as_file = 0 AND (m.extra IS NULL OR (m.extra NOT LIKE '%%sticker%%' AND m.extra NOT LIKE '%%\"gif\"%%'))" : ( 'voice' === $kind ? " AND f.mime LIKE 'audio/%%'" : " AND f.mime NOT LIKE 'audio/%%' AND ((f.mime NOT LIKE 'image/%%' AND f.mime NOT LIKE 'video/%%') OR m.as_file = 1)" );
		$rows  = $wpdb->get_results( $wpdb->prepare( $base . $where . ' ORDER BY m.id DESC LIMIT 300', $ch->id ) ); // phpcs:ignore
		return array_map( function ( $x ) {
			return array( 'id' => (int) $x->id, 'file' => MP_Files::payload( MP_Files::get( $x->file_id ) ), 'author' => self::author( $x ), 'created_at' => $x->created_at, 'transcript' => (string) $x->transcript, 'x' => self::x( $x ) ? self::x( $x ) : null );
		}, $rows );
	}

	/** GET channels/{id}/media-counts — how many photos, videos, files, voice messages and links (the info column). */
	public static function media_counts( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$m    = self::t( 'messages' );
		$f    = self::t( 'files' );
		// kept until the chat changes (newest message, last edit/deletion), so opening the info column stays cheap
		$ver  = $wpdb->get_row( $wpdb->prepare( "SELECT MAX(id) a, MAX(updated_at) b, MAX(deleted_at) c FROM $m WHERE channel_id = %d", $ch->id ), ARRAY_N ); // phpcs:ignore
		$key  = 'mp_mc_' . $ch->id . '_' . $uid . '_' . md5( implode( '|', (array) $ver ) );
		$hit  = get_transient( $key );
		if ( is_array( $hit ) ) {
			return $hit;
		}
		$base = "FROM $m m JOIN $f f ON f.id = m.file_id WHERE m.channel_id = %d AND m.deleted_at IS NULL AND m.file_id > 0" . self::not_hidden( $uid, 'm' );
		$pic  = " AND m.as_file = 0 AND (m.extra IS NULL OR (m.extra NOT LIKE '%%sticker%%' AND m.extra NOT LIKE '%%\"gif\"%%'))";
		$n    = function ( $where ) use ( $wpdb, $base, $ch ) {
			return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) ' . $base . $where, $ch->id ) ); // phpcs:ignore
		};
		$links = 0;
		foreach ( $wpdb->get_col( $wpdb->prepare( "SELECT body FROM $m WHERE channel_id = %d AND deleted_at IS NULL AND body LIKE %s ORDER BY id DESC LIMIT 1000", $ch->id, '%http%' ) ) as $b ) { // phpcs:ignore
			$links += preg_match_all( '#https?://[^\s<>"\']+#u', $b );
		}
		$out = array(
			'photos' => $n( " AND f.mime LIKE 'image/%%'" . $pic ),
			'videos' => $n( " AND f.mime LIKE 'video/%%'" . $pic ),
			'files'  => $n( " AND f.mime NOT LIKE 'audio/%%' AND ((f.mime NOT LIKE 'image/%%' AND f.mime NOT LIKE 'video/%%') OR m.as_file = 1)" ),
			'voice'  => $n( " AND f.mime LIKE 'audio/%%'" ),
			'links'  => $links,
		);
		set_transient( $key, $out, 10 * MINUTE_IN_SECONDS );
		return $out;
	}

	/** GET drafts — unsent text per chat, so a draft started on one device is there on the others: {id: [text, time]} */
	public static function drafts() {
		$d = get_user_meta( self::uid(), 'mp_drafts', true );
		return (object) ( is_array( $d ) ? $d : array() );
	}

	/** POST drafts {channel, text, at} — empty text removes it; the newest 100 are kept. */
	public static function save_draft( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['channel'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$d = get_user_meta( $uid, 'mp_drafts', true );
		$d = is_array( $d ) ? $d : array();
		$t = MP_Util::long_text( (string) $r['text'], 4000 );
		if ( '' === trim( $t ) ) {
			unset( $d[ (int) $ch->id ] );
		} else {
			$d[ (int) $ch->id ] = array( $t, (int) $r['at'] ? (int) $r['at'] : time() * 1000 );
		}
		uasort( $d, function ( $a, $b ) { return $b[1] - $a[1]; } );
		update_user_meta( $uid, 'mp_drafts', array_slice( $d, 0, 100, true ) );
		return array( 'ok' => true );
	}

	/** GET chat-folders — my own chat folders (Telegram's «پوشه‌ها»): [{id, name, chats: [channel ids]}] */
	public static function folders() {
		$f = get_user_meta( self::uid(), 'mp_chat_folders', true );
		return is_array( $f ) ? array_values( $f ) : array();
	}

	/** POST chat-folders {folders: [{id?, name, chats}]} — the whole list, at most 10, each up to 200 chats. */
	public static function save_folders( WP_REST_Request $r ) {
		$uid = self::uid();
		$out = array();
		$max = 0;
		foreach ( is_array( $r['folders'] ) ? $r['folders'] : array() as $f ) {
			$max = max( $max, isset( $f['id'] ) ? (int) $f['id'] : 0 );
		}
		foreach ( array_slice( is_array( $r['folders'] ) ? $r['folders'] : array(), 0, 10 ) as $f ) {
			$name = MP_Util::text( isset( $f['name'] ) ? $f['name'] : '', 30 );
			if ( '' === $name ) {
				continue;
			}
			$chats = array();
			foreach ( array_slice( isset( $f['chats'] ) && is_array( $f['chats'] ) ? $f['chats'] : array(), 0, 200 ) as $c ) {
				if ( MP_Rest::channel_for( (int) $c, $uid ) ) {
					$chats[] = (int) $c;
				}
			}
			$out[] = array( 'id' => ! empty( $f['id'] ) ? (int) $f['id'] : ++$max, 'name' => $name, 'chats' => array_values( array_unique( $chats ) ) );
		}
		update_user_meta( $uid, 'mp_chat_folders', $out );
		return $out;
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
			self::mark_read( $ch, $uid, $last, $r );
		}
		self::unmark( $ch->id, $uid );
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
		$cid = (int) $r['context_id'];
		if ( ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		return self::chunk_into( $r, $cid, (string) self::uid(), self::uid() );
	}

	/**
	 * One piece of a chat file for channel $cid; $who keeps one sender's pieces apart from another's,
	 * $owner is the file's user_id (0 for a client in the portal).
	 */
	public static function chunk_into( WP_REST_Request $r, $cid, $who, $owner ) {
		global $wpdb;
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
		$part = $dir . '/' . preg_replace( '/[^a-z0-9]/i', '', $who ) . '-' . substr( $up, 0, 40 ) . '.part';
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
			// Any other format is welcome too; it is kept on disk as .bin (never runnable on the host) and
			// always downloads under its own name.
			$check = array( 'ext' => 'bin', 'type' => 'application/octet-stream' );
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
				'user_id'    => (int) $owner,
				'context'    => 'message',
				'context_id' => $cid,
				'name'       => $name,
				'mime'       => $check['type'],
				'size'       => (int) $size,
				'path'       => $rel,
				'created_at' => MP_Util::now(),
			)
		);
		return MP_Files::payload( MP_Files::make_variants( MP_Files::get( $wpdb->insert_id ) ) );
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

	/* ------------------------------------------------------------------ Per-person lists (archive, «unread» mark, look) */

	private static function meta_ids( $uid, $key ) {
		$l = get_user_meta( $uid, $key, true );
		return is_array( $l ) ? array_values( array_map( 'intval', $l ) ) : array();
	}

	private static function meta_toggle( $uid, $key, $id, $on ) {
		$l = array_values( array_diff( self::meta_ids( $uid, $key ), array( (int) $id ) ) );
		if ( $on ) {
			$l[] = (int) $id;
		}
		update_user_meta( $uid, $key, $l );
	}

	public static function unmark( $channel_id, $uid ) {
		if ( in_array( (int) $channel_id, self::meta_ids( $uid, 'mp_unread_mark' ), true ) ) {
			self::meta_toggle( $uid, 'mp_unread_mark', $channel_id, false );
		}
	}

	/** POST channels/{id}/archive {on} — out of my list (back by itself when a message arrives, unless muted). */
	public static function archive_me( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$on = $r['on'] && 'false' !== $r['on'];
		self::meta_toggle( $uid, 'mp_chat_arch', $ch->id, $on );
		if ( $on ) {
			update_user_meta( $uid, 'mp_chat_arch_at_' . $ch->id, (int) self::last_id( $ch->id ) );
		} else {
			delete_user_meta( $uid, 'mp_chat_arch_at_' . $ch->id );
		}
		return MP_Rest::channel_payload( $ch, $uid );
	}

	/** POST channels/{id}/mark {on} — «mark as unread», like Telegram (cleared when the chat is opened). */
	public static function mark_unread( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		self::meta_toggle( $uid, 'mp_unread_mark', $ch->id, $r['on'] && 'false' !== $r['on'] );
		return MP_Rest::channel_payload( $ch, $uid );
	}

	/** POST channels/{id}/look {bg, accent, font} — my wallpaper and colour for one chat (id 0: every chat). */
	public static function look( WP_REST_Request $r ) {
		$uid = self::uid();
		$id  = (int) $r['id'];
		if ( $id && ! MP_Rest::channel_for( $id, $uid ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$all = get_user_meta( $uid, 'mp_chat_look', true );
		$all = is_array( $all ) ? $all : array();
		$one = array(
			'bg'     => preg_replace( '/[^a-z0-9-]/', '', (string) $r['bg'] ),
			'accent' => preg_match( '/^#[0-9a-f]{6}$/i', (string) $r['accent'] ) ? strtolower( $r['accent'] ) : '',
			'font'   => max( 0, min( 4, (int) $r['font'] ) ),
		);
		if ( '' === $one['bg'] && '' === $one['accent'] && ! $one['font'] ) {
			unset( $all[ $id ] );
		} else {
			$all[ $id ] = $one;
		}
		update_user_meta( $uid, 'mp_chat_look', $all );
		return array( 'look' => (object) $all );
	}

	public static function looks( $uid ) {
		$all = get_user_meta( $uid, 'mp_chat_look', true );
		return is_array( $all ) ? $all : array();
	}

	/** POST channels/pins-order {ids: []} — the order of my pinned chats (dragged in the list). */
	public static function pins_order( WP_REST_Request $r ) {
		$uid  = self::uid();
		$have = self::meta_ids( $uid, 'mp_pins' );
		$want = array_values( array_intersect( array_map( 'intval', (array) $r['ids'] ), $have ) );
		$rest = array_values( array_diff( $have, $want ) );
		// Stored oldest-first: the first one shown is the last one stored.
		update_user_meta( $uid, 'mp_pins', array_merge( $rest, array_reverse( $want ) ) );
		return MP_Rest::list_channels();
	}

	/* ------------------------------------------------------------------ Settings, roles, invite link */

	/** mode: chat | channel (only admins post), slow: seconds between a member's messages, topics: on/off. */
	public static function settings( $ch ) {
		$s = ! empty( $ch->settings ) ? json_decode( $ch->settings, true ) : array();
		$s = is_array( $s ) ? $s : array();
		return array(
			'mode'   => isset( $s['mode'] ) && 'channel' === $s['mode'] && 'group' === $ch->type ? 'channel' : 'chat',
			'slow'   => isset( $s['slow'] ) ? (int) $s['slow'] : 0,
			'topics' => ! empty( $s['topics'] ) && in_array( $ch->type, array( 'group', 'project', 'client' ), true ),
			'invite' => isset( $s['invite'] ) ? (string) $s['invite'] : '',
			'desc'   => isset( $s['desc'] ) ? (string) $s['desc'] : '',
			// Client groups: may the client add tasks to the project from the portal?
			'client_tasks' => ! empty( $s['client_tasks'] ) && 'client' === $ch->type,
			// The customer's private chat with the studio (MP_Client::pv_for); kept as 1 so SQL can find it.
			'pv'           => ! empty( $s['pv'] ) && 'client' === $ch->type ? 1 : 0,
		);
	}

	private static function save_settings_raw( $ch, array $s ) {
		global $wpdb;
		$wpdb->update( self::t( 'channels' ), array( 'settings' => wp_json_encode( $s, JSON_UNESCAPED_UNICODE ) ), array( 'id' => $ch->id ) );
		MP_Live::bump();
	}

	/** admin | member | readonly. Supervisors and a group's maker are always admins; private chats have none. */
	public static function role_of( $ch, $uid ) {
		global $wpdb;
		if ( in_array( $ch->type, array( 'direct', 'saved' ), true ) || MP_Util::is_manager( $uid ) || (int) $ch->created_by === (int) $uid && 'project' !== $ch->type ) {
			return 'admin';
		}
		$role = $wpdb->get_var( $wpdb->prepare( 'SELECT role FROM ' . self::t( 'chat_roles' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
		return in_array( $role, array( 'admin', 'readonly' ), true ) ? $role : 'member';
	}

	/** May this person write here at all (role and channel mode)? Slow mode is checked when sending. */
	public static function post_allowed( $ch, $uid ) {
		$role = self::role_of( $ch, $uid );
		if ( 'readonly' === $role ) {
			return 'در این گفت‌وگو فقط می‌توانید پیام‌ها را بخوانید.';
		}
		if ( 'admin' !== $role && 'channel' === self::settings( $ch )['mode'] ) {
			return 'این یک کانال اطلاع‌رسانی است؛ فقط مدیران پیام می‌فرستند.';
		}
		return '';
	}

	public static function can_post( $ch, $uid ) {
		global $wpdb;
		$why = self::post_allowed( $ch, $uid );
		if ( '' !== $why ) {
			return self::err( $why, 403 );
		}
		$slow = self::settings( $ch )['slow'];
		if ( $slow > 0 && 'admin' !== self::role_of( $ch, $uid ) ) {
			$last = $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(created_at) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
			$wait = $last ? $slow - ( current_time( 'timestamp' ) - strtotime( $last ) ) : 0; // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
			if ( $wait > 0 ) {
				return new WP_Error( 'mp_slow', 'حالت آهسته روشن است؛ ' . MP_Jalali::digits( (string) $wait ) . ' ثانیه دیگر می‌توانید پیام بفرستید.', array( 'status' => 429, 'wait' => $wait ) );
			}
		}
		return true;
	}

	/** POST channels/{id}/settings {mode, slow, topics, desc} — admins only. */
	public static function save_settings( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch || in_array( $ch->type, array( 'direct', 'saved' ), true ) ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		if ( 'admin' !== self::role_of( $ch, $uid ) ) {
			return self::err( 'فقط مدیران گروه می‌توانند تنظیمات را عوض کنند.', 403 );
		}
		$s = self::settings( $ch );
		if ( null !== $r['mode'] && 'group' === $ch->type ) {
			$s['mode'] = 'channel' === $r['mode'] ? 'channel' : 'chat';
		}
		if ( null !== $r['slow'] ) {
			$s['slow'] = max( 0, min( 3600, (int) $r['slow'] ) );
		}
		if ( null !== $r['desc'] ) {
			$s['desc'] = MP_Util::long_text( $r['desc'], 500 );
		}
		if ( null !== $r['topics'] ) {
			$s['topics'] = $r['topics'] && 'false' !== $r['topics'];
			if ( $s['topics'] ) {
				// Messages so far go to «عمومی», the topic every group with topics starts with.
				$general = self::general_topic( $ch, true );
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'messages' ) . ' SET topic_id = %d WHERE channel_id = %d AND topic_id = 0', $general, $ch->id ) );
			}
		}
		self::save_settings_raw( $ch, $s );
		return MP_Rest::channel_payload( MP_Rest::channel_for( $ch->id, $uid ), $uid );
	}

	/** GET channels/{id}/roles — members with their role. */
	public static function roles( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$out = array();
		foreach ( MP_Rest::channel_members( $ch ) as $m ) {
			$u = get_userdata( $m );
			if ( $u ) {
				$fixed = MP_Util::is_manager( $m ) || ( (int) $ch->created_by === (int) $m && 'project' !== $ch->type );
				$out[] = array( 'id' => (int) $m, 'name' => $u->display_name, 'role' => self::role_of( $ch, $m ), 'fixed' => $fixed );
			}
		}
		return array( 'members' => $out, 'can_edit' => 'admin' === self::role_of( $ch, $uid ) );
	}

	/** POST channels/{id}/roles {user_id, role} */
	public static function set_role( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch || 'admin' !== self::role_of( $ch, $uid ) || in_array( $ch->type, array( 'direct', 'saved' ), true ) ) {
			return self::err( 'اجازه تغییر نقش‌ها را ندارید.', 403 );
		}
		$who  = (int) $r['user_id'];
		$role = MP_Util::pick( (string) $r['role'], array( 'admin', 'member', 'readonly' ), 'member' );
		if ( ! in_array( $who, MP_Rest::channel_members( $ch ), true ) ) {
			return self::err( 'این فرد عضو گفت‌وگو نیست.' );
		}
		if ( MP_Util::is_manager( $who ) || ( (int) $ch->created_by === $who && 'project' !== $ch->type ) ) {
			return self::err( 'نقش ناظرها و سازنده گروه همیشه «مدیر» است.' );
		}
		if ( 'member' === $role ) {
			$wpdb->delete( self::t( 'chat_roles' ), array( 'channel_id' => $ch->id, 'user_id' => $who ) );
		} else {
			$wpdb->replace( self::t( 'chat_roles' ), array( 'channel_id' => $ch->id, 'user_id' => $who, 'role' => $role ) );
		}
		MP_Live::bump();
		return self::roles( $r );
	}

	public static function invite_url( $token ) {
		return MP_Frontend::panel_url() . '#join-' . $token;
	}

	/** POST channels/{id}/invite {reset} — the team group's invite link for colleagues (made on first use). */
	public static function invite( WP_REST_Request $r ) {
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch || 'group' !== $ch->type || 'admin' !== self::role_of( $ch, $uid ) ) {
			return self::err( 'لینک دعوت فقط برای گروه‌های تیم و توسط مدیر گروه ساخته می‌شود.', 403 );
		}
		$s = self::settings( $ch );
		if ( '' === $s['invite'] || $r['reset'] ) {
			$s['invite'] = wp_generate_password( 16, false, false );
			self::save_settings_raw( $ch, $s );
		}
		return array( 'url' => self::invite_url( $s['invite'] ) );
	}

	/** POST chat-join {token} — a colleague opens a group's invite link. */
	public static function join( WP_REST_Request $r ) {
		global $wpdb;
		$uid   = self::uid();
		$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) $r['token'] );
		if ( strlen( $token ) < 10 ) {
			return self::err( 'لینک دعوت معتبر نیست.' );
		}
		$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'group' AND archived_at IS NULL AND settings LIKE %s", '%' . $wpdb->esc_like( '"invite":"' . $token . '"' ) . '%' ) );
		if ( ! $ch ) {
			return self::err( 'این لینک دعوت دیگر کار نمی‌کند.', 404 );
		}
		if ( ! MP_Rest::channel_for( $ch->id, $uid ) ) {
			$wpdb->insert( self::t( 'channel_members' ), array( 'channel_id' => $ch->id, 'user_id' => $uid ) );
			MP_Live::bump();
		}
		return MP_Rest::channel_payload( MP_Rest::channel_for( $ch->id, $uid ), $uid );
	}

	/* ------------------------------------------------------------------ Topics */

	private static function general_topic( $ch, $create = false ) {
		global $wpdb;
		$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'chat_topics' ) . ' WHERE channel_id = %d ORDER BY sort, id LIMIT 1', $ch->id ) );
		if ( ! $id && $create ) {
			$wpdb->insert( self::t( 'chat_topics' ), array( 'channel_id' => $ch->id, 'title' => 'عمومی', 'color' => '#8e8e93', 'sort' => -1, 'created_by' => self::uid(), 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
		}
		return $id;
	}

	/** The topic a new message goes to: the chosen one, else «عمومی»; 0 when the chat has no topics. */
	public static function topic_for( $ch, $tid ) {
		global $wpdb;
		if ( ! self::settings( $ch )['topics'] ) {
			return 0;
		}
		if ( $tid ) {
			$t = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_topics' ) . ' WHERE id = %d AND channel_id = %d', $tid, $ch->id ) );
			if ( $t ) {
				if ( $t->closed && 'admin' !== self::role_of( $ch, self::uid() ) ) {
					return self::err( 'این تاپیک بسته شده است.', 403 );
				}
				return (int) $t->id;
			}
		}
		return self::general_topic( $ch, true );
	}

	/** GET channels/{id}/topics — with each topic's newest message and my unread count. */
	public static function topics( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$base = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
		$out  = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_topics' ) . ' WHERE channel_id = %d ORDER BY sort, id', $ch->id ) ) as $t ) {
			$tr   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'topic_reads' ) . ' WHERE topic_id = %d AND user_id = %d', $t->id, $uid ) );
			$from = max( $base, $tr );
			$last = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND topic_id = %d AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', $ch->id, $t->id ) );
			$out[] = array(
				'id'     => (int) $t->id,
				'title'  => $t->title,
				'color'  => $t->color,
				'closed' => (bool) $t->closed,
				'unread' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND topic_id = %d AND id > %d AND user_id <> %d AND deleted_at IS NULL', $ch->id, $t->id, $from, $uid ) ),
				'last'   => $last ? array( 'id' => (int) $last->id, 'author' => self::author( $last ), 'text' => self::snippet( $last ), 'created_at' => $last->created_at, 'mine' => (int) $last->user_id === $uid ) : null,
			);
		}
		return array( 'topics' => $out, 'can_manage' => 'admin' === self::role_of( $ch, $uid ) );
	}

	/** POST channels/{id}/topics {topic_id?, title, color, closed} — admins add, rename, close topics. */
	public static function save_topic( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch || 'admin' !== self::role_of( $ch, $uid ) ) {
			return self::err( 'فقط مدیران گروه تاپیک می‌سازند.', 403 );
		}
		$title = MP_Util::text( $r['title'], 80 );
		$color = preg_match( '/^#[0-9a-f]{6}$/i', (string) $r['color'] ) ? $r['color'] : '#ff8a00';
		$tid   = (int) $r['topic_id'];
		if ( $tid ) {
			$row = array( 'color' => $color, 'closed' => $r['closed'] && 'false' !== $r['closed'] ? 1 : 0 );
			if ( '' !== $title ) {
				$row['title'] = $title;
			}
			$wpdb->update( self::t( 'chat_topics' ), $row, array( 'id' => $tid, 'channel_id' => $ch->id ) );
		} else {
			if ( '' === $title ) {
				return self::err( 'نام تاپیک را بنویسید.' );
			}
			self::general_topic( $ch, true );
			$wpdb->insert( self::t( 'chat_topics' ), array( 'channel_id' => $ch->id, 'title' => $title, 'color' => $color, 'sort' => 0, 'created_by' => $uid, 'created_at' => MP_Util::now() ) );
		}
		MP_Live::bump();
		return self::topics( $r );
	}

	/** DELETE topics/{id} — its messages move to «عمومی». */
	public static function delete_topic( WP_REST_Request $r ) {
		global $wpdb;
		$t = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_topics' ) . ' WHERE id = %d', (int) $r['id'] ) );
		$ch = $t ? MP_Rest::channel_for( (int) $t->channel_id, self::uid() ) : null;
		if ( ! $ch || 'admin' !== self::role_of( $ch, self::uid() ) ) {
			return self::err( 'اجازه حذف این تاپیک را ندارید.', 403 );
		}
		$general = self::general_topic( $ch );
		if ( (int) $t->id === $general ) {
			return self::err( 'تاپیک «عمومی» حذف نمی‌شود.' );
		}
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'messages' ) . ' SET topic_id = %d WHERE topic_id = %d', $general, $t->id ) );
		$wpdb->delete( self::t( 'chat_topics' ), array( 'id' => $t->id ) );
		$wpdb->delete( self::t( 'topic_reads' ), array( 'topic_id' => $t->id ) );
		MP_Live::bump();
		$r->set_param( 'id', $ch->id );
		return self::topics( $r );
	}

	/* ------------------------------------------------------------------ Reading, delivery, «delete for me» */

	public static function not_hidden( $uid, $alias = '' ) {
		$a = $alias ? $alias . '.' : '';
		return ' AND ' . $a . 'id NOT IN (SELECT message_id FROM ' . self::t( 'msg_hidden' ) . ' WHERE user_id = ' . (int) $uid . ')';
	}

	/** Extra WHERE for a chat's message list: not deleted-for-me, and ?topic= when the chat has topics. */
	public static function list_where( $ch, $uid, WP_REST_Request $r ) {
		$w = self::not_hidden( $uid );
		if ( (int) $r['topic'] && self::settings( $ch )['topics'] ) {
			$w .= ' AND topic_id = ' . (int) $r['topic'];
		}
		return $w;
	}

	/** Who has read how far — inside a topic, each person's topic position counts too. */
	public static function reads_for( $ch, WP_REST_Request $r ) {
		global $wpdb;
		$reads = MP_Rest::channel_reads( $ch->id );
		$topic = (int) $r['topic'];
		if ( $topic ) {
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, last_id FROM ' . self::t( 'topic_reads' ) . ' WHERE topic_id = %d', $topic ) ) as $x ) {
				$reads[ (int) $x->user_id ] = max( isset( $reads[ (int) $x->user_id ] ) ? $reads[ (int) $x->user_id ] : 0, (int) $x->last_id );
			}
		}
		return $reads;
	}

	/**
	 * I have seen everything up to $last. Inside one topic, the chat-wide position moves only up to the first
	 * message I have not seen in another topic.
	 */
	public static function mark_read( $ch, $uid, $last, WP_REST_Request $r = null ) {
		global $wpdb;
		$row  = $wpdb->get_row( $wpdb->prepare( 'SELECT last_id, got_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
		$prev = $row ? (int) $row->last_id : 0;
		$topic = $r ? (int) $r['topic'] : 0;
		if ( $topic && self::settings( $ch )['topics'] ) {
			$tr = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'topic_reads' ) . ' WHERE topic_id = %d AND user_id = %d', $topic, $uid ) );
			if ( $last > $tr ) {
				$wpdb->replace( self::t( 'topic_reads' ), array( 'topic_id' => $topic, 'user_id' => $uid, 'last_id' => $last ) );
			}
			$pos = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT t.id, COALESCE(r.last_id, 0) l FROM ' . self::t( 'chat_topics' ) . ' t LEFT JOIN ' . self::t( 'topic_reads' ) . ' r ON r.topic_id = t.id AND r.user_id = %d WHERE t.channel_id = %d', $uid, $ch->id ) ) as $x ) {
				$pos[ (int) $x->id ] = max( (int) $x->l, $prev );
			}
			$first = 0;
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, topic_id FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND user_id <> %d AND deleted_at IS NULL ORDER BY id LIMIT 2000', $ch->id, $prev, $uid ) ) as $m ) {
				$p = isset( $pos[ (int) $m->topic_id ] ) ? $pos[ (int) $m->topic_id ] : $prev;
				if ( (int) $m->id > $p ) {
					$first = (int) $m->id;
					break;
				}
			}
			$last = $first ? $first - 1 : self::last_id( $ch->id );
		}
		if ( $last <= $prev ) {
			return;
		}
		if ( $row ) {
			$wpdb->update( self::t( 'reads' ), array( 'last_id' => $last, 'got_id' => max( $last, (int) $row->got_id ) ), array( 'channel_id' => $ch->id, 'user_id' => $uid ) );
		} else {
			$wpdb->insert( self::t( 'reads' ), array( 'channel_id' => $ch->id, 'user_id' => $uid, 'last_id' => $last, 'got_id' => $last ) );
		}
		MP_Live::bump();
	}

	public static function last_id( $channel_id ) {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d', $channel_id ) );
	}

	/** user id => the newest message their device has received (read counts as received). */
	public static function got_map( $channel_id ) {
		global $wpdb;
		$channel_id = (int) $channel_id;
		if ( ! isset( self::$gots[ $channel_id ] ) ) {
			self::$gots[ $channel_id ] = array();
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, last_id, got_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d', $channel_id ) ) as $x ) {
				self::$gots[ $channel_id ][ (int) $x->user_id ] = max( (int) $x->last_id, (int) $x->got_id );
			}
		}
		return self::$gots[ $channel_id ];
	}

	/** Has my message reached anyone else's device? (the second, grey tick) */
	public static function got( $m ) {
		foreach ( self::got_map( $m->channel_id ) as $who => $g ) {
			if ( (int) $who !== (int) $m->user_id && $g >= (int) $m->id ) {
				return true;
			}
		}
		return false;
	}

	public static function seen_count( $m ) {
		$n = 0;
		foreach ( MP_Rest::channel_reads( $m->channel_id ) as $who => $last ) {
			if ( (int) $who !== (int) $m->user_id && $last >= (int) $m->id ) {
				++$n;
			}
		}
		return $n;
	}

	/** Messages I removed «for me» (so my other devices drop them too). */
	public static function hidden_since( $uid, $channel_id, $since ) {
		global $wpdb;
		if ( '' === $since ) {
			return array();
		}
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT h.message_id FROM ' . self::t( 'msg_hidden' ) . ' h JOIN ' . self::t( 'messages' ) . ' m ON m.id = h.message_id WHERE h.user_id = %d AND m.channel_id = %d ORDER BY h.message_id DESC LIMIT 300', $uid, $channel_id ) ) );
	}

	/** POST messages/{id}/hide — «delete for me»: gone from my chat, others still see it. */
	public static function hide( WP_REST_Request $r ) {
		global $wpdb;
		list( $m ) = self::message( $r['id'] );
		if ( ! $m ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$wpdb->replace( self::t( 'msg_hidden' ), array( 'user_id' => self::uid(), 'message_id' => $m->id ) );
		return array( 'id' => (int) $m->id, 'hidden' => true );
	}

	/** Unread @mentions of me and replies to my messages, per group: [count, first id]. */
	public static function mention_counts( $uid, array $ids ) {
		global $wpdb;
		$u = get_userdata( $uid );
		if ( ! $ids || ! $u ) {
			return array();
		}
		$m     = self::t( 'messages' );
		$in    = implode( ',', array_map( 'intval', $ids ) );
		$args  = array( $uid, $uid, $uid );
		$likes = '';
		foreach ( array_unique( array_filter( array( $u->display_name, strtok( $u->display_name, ' ' ) ) ) ) as $n ) {
			$likes .= ' OR m.body LIKE %s';
			$args[] = '%@' . $wpdb->esc_like( $n ) . '%';
		}
		$out = array();
		$sql = "SELECT m.channel_id, COUNT(*) n, MIN(m.id) f FROM $m m LEFT JOIN " . self::t( 'reads' ) . " r ON r.channel_id = m.channel_id AND r.user_id = %d LEFT JOIN $m q ON q.id = m.reply_to
			WHERE m.channel_id IN ($in) AND m.id > COALESCE(r.last_id, 0) AND m.user_id <> %d AND m.deleted_at IS NULL AND (q.user_id = %d$likes) GROUP BY m.channel_id";
		foreach ( $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) as $x ) { // phpcs:ignore
			$out[ (int) $x->channel_id ] = array( (int) $x->n, (int) $x->f );
		}
		return $out;
	}

	/** A reply to my message in a group reaches me like a mention (unless it is a private chat, which already notifies). */
	public static function reply_notify( $ch, $uid, $m, $preview, $actor ) {
		global $wpdb;
		if ( empty( $m->reply_to ) || 'direct' === $ch->type || 'saved' === $ch->type ) {
			return;
		}
		$to = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $m->reply_to ) );
		if ( $to && $to !== (int) $uid && in_array( $to, MP_Rest::channel_members( $ch ), true ) ) {
			MP_Notify::event( 'message_reply', $to, array( 'ACTOR' => $actor, 'GROUP' => $ch->title, 'PREVIEW' => $preview ), 'messages', $ch->id );
		}
	}

	/** Chat fields for the list: my role, whether I may write, settings, mentions, my own archive/mark/look. */
	public static function channel_extra( $ch, $uid ) {
		global $wpdb;
		$s     = self::settings( $ch );
		$role  = self::role_of( $ch, $uid );
		$why   = self::post_allowed( $ch, $uid );
		$ment  = in_array( $ch->type, array( 'group', 'project', 'client' ), true ) ? self::mention_counts( $uid, array( $ch->id ) ) : array();
		$looks = self::looks( $uid );
		$arch  = in_array( (int) $ch->id, self::meta_ids( $uid, 'mp_chat_arch' ), true );
		$last  = self::last_id( $ch->id );
		// An archived chat comes back to the list when a new message arrives (muted ones stay archived).
		if ( $arch && ! self::muted( $ch->id, $uid ) && $last > (int) get_user_meta( $uid, 'mp_chat_arch_at_' . $ch->id, true ) && (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND user_id <> %d', $ch->id, (int) get_user_meta( $uid, 'mp_chat_arch_at_' . $ch->id, true ), $uid ) ) ) {
			self::meta_toggle( $uid, 'mp_chat_arch', $ch->id, false );
			$arch = false;
		}
		$pins = self::meta_ids( $uid, 'mp_pins' );
		$rank = array_search( (int) $ch->id, $pins, true );
		return array(
			'role'      => $role,
			'can_post'  => '' === $why,
			'post_why'  => $why,
			'settings'  => array(
				'mode'   => $s['mode'],
				'slow'   => $s['slow'],
				'topics' => $s['topics'],
				'desc'   => $s['desc'],
				'invite' => 'admin' === $role && 'group' === $ch->type && '' !== $s['invite'] ? self::invite_url( $s['invite'] ) : '',
			),
			'mention'   => isset( $ment[ (int) $ch->id ] ) ? $ment[ (int) $ch->id ] : array( 0, 0 ),
			'arch_me'   => $arch,
			'marked'    => in_array( (int) $ch->id, self::meta_ids( $uid, 'mp_unread_mark' ), true ),
			'look'      => isset( $looks[ (int) $ch->id ] ) ? $looks[ (int) $ch->id ] : null,
			'last_id'   => $last,
			'pin_rank'  => false === $rank ? -1 : (int) $rank,
			'sched'     => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'chat_scheduled' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) ),
		);
	}

	/* ------------------------------------------------------------------ Scheduled messages */

	/** Keeps a message to post at $at ('Y-m-d H:i' local time). */
	public static function schedule( $ch, $uid, array $row, $at ) {
		global $wpdb;
		$at = preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $at ) ? $at . ':00' : $at;
		if ( ! MP_Util::valid_datetime( $at ) || strtotime( $at ) <= current_time( 'timestamp' ) + 20 ) { // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp
			return self::err( 'زمان ارسال باید در آینده باشد.' );
		}
		$wpdb->insert(
			self::t( 'chat_scheduled' ),
			array(
				'channel_id' => $ch->id,
				'user_id'    => $uid,
				'topic_id'   => isset( $row['topic_id'] ) ? (int) $row['topic_id'] : 0,
				'body'       => (string) $row['body'],
				'file_id'    => (int) $row['file_id'],
				'reply_to'   => isset( $row['reply_to'] ) ? (int) $row['reply_to'] : 0,
				'extra'      => wp_json_encode(
					array(
						'x'          => isset( $row['extra'] ) ? json_decode( $row['extra'], true ) : null,
						'album'      => isset( $row['album'] ) ? $row['album'] : '',
						'as_file'    => ! empty( $row['as_file'] ),
						'transcript' => isset( $row['transcript'] ) ? $row['transcript'] : '',
					),
					JSON_UNESCAPED_UNICODE
				),
				'silent'     => ! empty( $row['silent'] ) ? 1 : 0,
				'send_at'    => $at,
				'created_at' => MP_Util::now(),
			)
		);
		return array( 'scheduled' => self::scheduled_payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_scheduled' ) . ' WHERE id = %d', $wpdb->insert_id ) ) ) );
	}

	private static function scheduled_payload( $s ) {
		$e = json_decode( (string) $s->extra, true );
		$x = is_array( $e ) && ! empty( $e['x'] ) ? $e['x'] : null;
		$fake = (object) array( 'body' => $s->body, 'file_id' => $s->file_id, 'extra' => $x ? wp_json_encode( $x ) : '', 'deleted_at' => null, 'as_file' => is_array( $e ) && ! empty( $e['as_file'] ) );
		return array( 'id' => (int) $s->id, 'body' => $s->body, 'text' => self::snippet( $fake ), 'file' => $s->file_id ? MP_Files::payload( MP_Files::get( $s->file_id ) ) : null, 'send_at' => $s->send_at, 'silent' => (bool) $s->silent );
	}

	/** Due scheduled messages become real ones (at most a few per call; called often). */
	public static function flush_scheduled() {
		global $wpdb;
		static $done = false;
		if ( $done ) {
			return;
		}
		$done = true;
		$due  = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_scheduled' ) . ' WHERE send_at <= %s ORDER BY send_at, id LIMIT 20', MP_Util::now() ) );
		foreach ( $due as $s ) {
			// Whoever deletes the row posts it: two requests at once never post twice.
			if ( 1 !== (int) $wpdb->delete( self::t( 'chat_scheduled' ), array( 'id' => $s->id ) ) ) {
				continue;
			}
			$ch = MP_Rest::channel_for( (int) $s->channel_id, (int) $s->user_id );
			if ( ! $ch ) {
				continue;
			}
			$e   = json_decode( (string) $s->extra, true );
			$e   = is_array( $e ) ? $e : array();
			$row = array( 'channel_id' => $ch->id, 'user_id' => (int) $s->user_id, 'body' => $s->body, 'file_id' => (int) $s->file_id, 'created_at' => MP_Util::now(), 'reply_to' => (int) $s->reply_to, 'topic_id' => (int) $s->topic_id, 'silent' => (int) $s->silent );
			if ( ! empty( $e['x'] ) ) {
				$row['extra'] = wp_json_encode( $e['x'], JSON_UNESCAPED_UNICODE );
			}
			if ( ! empty( $e['album'] ) ) {
				$row['album'] = $e['album'];
			}
			if ( ! empty( $e['as_file'] ) ) {
				$row['as_file'] = 1;
			}
			if ( ! empty( $e['transcript'] ) ) {
				$row['transcript'] = $e['transcript'];
			}
			MP_Rest::post_message( $ch, (int) $s->user_id, $row );
		}
	}

	/** GET channels/{id}/scheduled — my messages waiting to be sent here. */
	public static function scheduled( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		return array_map( array( __CLASS__, 'scheduled_payload' ), $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'chat_scheduled' ) . ' WHERE channel_id = %d AND user_id = %d ORDER BY send_at, id', $ch->id, $uid ) ) );
	}

	public static function unschedule( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->delete( self::t( 'chat_scheduled' ), array( 'id' => (int) $r['id'], 'user_id' => self::uid() ) );
		return array( 'deleted' => true );
	}

	public static function send_scheduled_now( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->update( self::t( 'chat_scheduled' ), array( 'send_at' => MP_Util::now() ), array( 'id' => (int) $r['id'], 'user_id' => self::uid() ) );
		self::flush_scheduled();
		return array( 'sent' => true );
	}

	/* ------------------------------------------------------------------ Polls */

	/** POST messages/{id}/vote {opts: [i…]} — empty takes my vote back. */
	public static function vote( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		$x = $m ? self::x( $m ) : array();
		if ( ! $m || empty( $x['poll'] ) || ! empty( $m->deleted_at ) ) {
			return self::err( 'نظرسنجی پیدا نشد.', 404 );
		}
		if ( ! empty( $x['poll']['closed'] ) ) {
			return self::err( 'این نظرسنجی بسته شده است.' );
		}
		$uid  = self::uid();
		$opts = array_values( array_unique( array_filter( array_map( 'intval', (array) $r['opts'] ), function ( $o ) use ( $x ) { return $o >= 0 && $o < count( $x['poll']['o'] ); } ) ) );
		if ( empty( $x['poll']['multi'] ) ) {
			$opts = array_slice( $opts, 0, 1 );
		}
		$wpdb->delete( self::t( 'poll_votes' ), array( 'message_id' => $m->id, 'user_id' => $uid ) );
		foreach ( $opts as $o ) {
			$wpdb->insert( self::t( 'poll_votes' ), array( 'message_id' => $m->id, 'user_id' => $uid, 'opt' => $o, 'created_at' => MP_Util::now() ) );
		}
		unset( self::$votes[ (int) $m->id ] );
		self::touch( $m->id );
		MP_Live::bump();
		return MP_Rest::message_payload( $m, $uid, MP_Rest::channel_reads( $ch->id ) );
	}

	/** POST messages/{id}/poll-close — the poll's maker (or a supervisor) stops voting; results stay. */
	public static function poll_close( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		$x = $m ? self::x( $m ) : array();
		if ( ! $m || empty( $x['poll'] ) ) {
			return self::err( 'نظرسنجی پیدا نشد.', 404 );
		}
		if ( (int) $m->user_id !== self::uid() && ! MP_Util::is_manager() ) {
			return self::err( 'فقط سازنده نظرسنجی می‌تواند آن را ببندد.', 403 );
		}
		$x['poll']['closed'] = true;
		$wpdb->update( self::t( 'messages' ), array( 'extra' => wp_json_encode( $x, JSON_UNESCAPED_UNICODE ), 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		MP_Live::bump();
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $m->id ) );
		return MP_Rest::message_payload( $m, self::uid(), MP_Rest::channel_reads( $ch->id ) );
	}

	/* ------------------------------------------------------------------ Edit history, reminder, translation, summary */

	/** GET messages/{id}/edits — every earlier text, newest first. */
	public static function edits( WP_REST_Request $r ) {
		global $wpdb;
		list( $m ) = self::message( $r['id'] );
		if ( ! $m || ! empty( $m->deleted_at ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		$out = array( array( 'body' => $m->body, 'at' => $m->edited_at ? $m->edited_at : $m->created_at, 'now' => true ) );
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'msg_edits' ) . ' WHERE message_id = %d ORDER BY id DESC', $m->id ) ) as $e ) {
			$out[] = array( 'body' => $e->body, 'at' => $e->edited_at, 'now' => false );
		}
		return $out;
	}

	/** POST messages/{id}/remind {date, time} — «remind me about this message». */
	public static function remind( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		if ( ! MP_Util::valid_date( (string) $r['date'] ) || ! MP_Util::valid_time( (string) $r['time'] ) || '' === (string) $r['time'] ) {
			return self::err( 'تاریخ و ساعت یادآوری معتبر نیست.' );
		}
		$text = self::snippet( $m );
		$wpdb->insert(
			self::t( 'reminders' ),
			array(
				'user_id'      => self::uid(),
				'title'        => MP_Util::text( 'پیام ' . self::author( $m ) . ': ' . ( '' !== $text ? $text : '…' ), 160 ),
				'note'         => 'chat:' . (int) $ch->id . ':' . (int) $m->id,
				'remind_date'  => $r['date'],
				'remind_time'  => $r['time'],
				'repeat_every' => 'none',
				'created_at'   => MP_Util::now(),
			)
		);
		return array( 'ok' => true );
	}

	/** POST messages/{id}/translate {to: fa|en} — through the panel's AI service (cached a week). */
	public static function translate( WP_REST_Request $r ) {
		list( $m ) = self::message( $r['id'] );
		if ( ! $m || '' === trim( (string) $m->body . $m->transcript ) ) {
			return self::err( 'متنی برای ترجمه نیست.', 404 );
		}
		$to  = 'en' === $r['to'] ? 'en' : 'fa';
		$key = 'mp_tr_' . $to . '_' . (int) $m->id . '_' . md5( $m->body );
		$hit = get_transient( $key );
		if ( is_string( $hit ) ) {
			return array( 'text' => $hit, 'to' => $to );
		}
		$res = MP_AI::ask( 'Translate the user\'s message into ' . ( 'fa' === $to ? 'Persian (Farsi)' : 'English' ) . '. Keep emoji, names, numbers and links. Reply with the translation only, nothing else.', self::plain( '' !== trim( $m->body ) ? $m->body : $m->transcript ) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$res = trim( $res );
		set_transient( $key, $res, WEEK_IN_SECONDS );
		return array( 'text' => $res, 'to' => $to );
	}

	/** POST channels/{id}/summary — what I missed: the unread messages (or the latest ones) in a few lines. */
	public static function summary( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch ) {
			return self::err( 'گفت‌وگو پیدا نشد.', 404 );
		}
		$read = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND id > %d AND deleted_at IS NULL ORDER BY id LIMIT 300', $ch->id, (int) $r['all'] ? 0 : $read ) );
		$unread = true;
		if ( count( $rows ) < 3 ) {
			$unread = false;
			$rows   = array_reverse( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND deleted_at IS NULL ORDER BY id DESC LIMIT 80', $ch->id ) ) );
		}
		if ( ! $rows ) {
			return self::err( 'پیامی برای خلاصه کردن نیست.' );
		}
		$lines = array();
		foreach ( $rows as $m ) {
			$t = self::snippet( $m );
			if ( $m->transcript ) {
				$t .= ' (متن ویس: ' . mb_substr( $m->transcript, 0, 300 ) . ')';
			}
			$lines[] = self::author( $m ) . ' [' . substr( $m->created_at, 5, 11 ) . ']: ' . mb_substr( self::plain( (string) $m->body ) ? self::plain( (string) $m->body ) : $t, 0, 500 );
		}
		$res = MP_AI::ask( 'تو دستیار پنل یک استودیوی طراحی هستی. این پیام‌های یک گفت‌وگوی کاری را به فارسی روان و کوتاه خلاصه کن: حداکثر ۶ بند کوتاه با «•»؛ تصمیم‌ها، کارهایی که از کسی خواسته شده (با نام)، مهلت‌ها و سؤال‌های بی‌جواب را حتماً بیاور. چیزی از خودت اضافه نکن.', implode( "\n", $lines ) );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		return array( 'summary' => trim( $res ), 'count' => count( $rows ), 'unread' => $unread );
	}

	/** GET messages/{id}/locate — the chat (and topic) a message link points to. */
	public static function locate( WP_REST_Request $r ) {
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m ) {
			return self::err( 'این پیام پیدا نشد یا به آن دسترسی ندارید.', 404 );
		}
		return array( 'channel_id' => (int) $ch->id, 'topic_id' => (int) $m->topic_id, 'id' => (int) $m->id );
	}

	/** GET channels/{id}/date?date=Y-m-d — the first message on or after that day (or the last before it). */
	public static function at_date( WP_REST_Request $r ) {
		global $wpdb;
		$uid = self::uid();
		$ch  = MP_Rest::channel_for( (int) $r['id'], $uid );
		if ( ! $ch || ! MP_Util::valid_date( (string) $r['date'] ) ) {
			return self::err( 'تاریخ معتبر نیست.', 400 );
		}
		$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MIN(id) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND created_at >= %s' . self::not_hidden( $uid ), $ch->id, $r['date'] . ' 00:00:00' ) ); // phpcs:ignore
		if ( ! $id ) {
			$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d' . self::not_hidden( $uid ), $ch->id ) ); // phpcs:ignore
		}
		return array( 'id' => $id );
	}

	/* ------------------------------------------------------------------ Design review on a photo */

	/** POST messages/{id}/review {state: ok|fix|''} — «تأیید» or «نیاز به اصلاح» on a design; posted as a reply too. */
	public static function review( WP_REST_Request $r ) {
		global $wpdb;
		list( $m, $ch ) = self::message( $r['id'] );
		if ( ! $m || ! $m->file_id || ! empty( $m->deleted_at ) ) {
			return self::err( 'طرح پیدا نشد.', 404 );
		}
		$uid   = self::uid();
		$state = MP_Util::pick( (string) $r['state'], array( 'ok', 'fix', '' ), '' );
		$x     = self::x( $m );
		if ( '' === $state ) {
			unset( $x['review'] );
		} else {
			$x['review'] = array( 'state' => $state, 'by' => $uid, 'at' => MP_Util::now() );
		}
		$wpdb->update( self::t( 'messages' ), array( 'extra' => $x ? wp_json_encode( $x, JSON_UNESCAPED_UNICODE ) : null, 'updated_at' => MP_Util::now() ), array( 'id' => $m->id ) );
		if ( '' !== $state && ! is_wp_error( self::can_post( $ch, $uid ) ) ) {
			$note = MP_Util::long_text( $r['note'], 1000 );
			MP_Rest::post_message( $ch, $uid, array( 'channel_id' => $ch->id, 'user_id' => $uid, 'body' => ( 'ok' === $state ? '✅ طرح تأیید شد' : '✏️ این طرح نیاز به اصلاح دارد' ) . ( '' !== $note ? "\n" . $note : '' ), 'file_id' => 0, 'reply_to' => (int) $m->id, 'topic_id' => (int) $m->topic_id, 'created_at' => MP_Util::now() ) );
		}
		MP_Live::bump();
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE id = %d', $m->id ) );
		return MP_Rest::message_payload( $m, $uid, MP_Rest::channel_reads( $ch->id ) );
	}

	/* ------------------------------------------------------------------ Task / project cards */

	/** A live card: the task's status, person and date, or the project's progress. Null when I may not see it. */
	public static function card( $t, $id ) {
		global $wpdb;
		if ( 'project' === $t ) {
			if ( ! $id || ! MP_Util::can_see_project( $id ) ) {
				return null;
			}
			$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $id ) );
			if ( ! $p ) {
				return null;
			}
			$all  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . ' WHERE project_id = %d AND archived_at IS NULL', $id ) );
			$done = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . " WHERE project_id = %d AND archived_at IS NULL AND status = 'done'", $id ) );
			return array( 'title' => $p->name, 'status' => isset( $p->status ) ? (string) $p->status : '', 'tasks' => $all, 'done' => $done, 'end' => isset( $p->end_date ) ? (string) $p->end_date : '' );
		}
		$task = MP_Rest::get_task( (int) $id );
		if ( ! $task || ! empty( $task->archived_at ) || ! MP_Rest::can_view_task( $task ) ) {
			return null;
		}
		$u = get_userdata( $task->user_id );
		return array( 'title' => $task->title, 'status' => $task->status, 'user' => $u ? $u->display_name : '', 'user_id' => (int) $task->user_id, 'date' => $task->task_date, 'time' => (string) $task->task_time, 'project_id' => (int) $task->project_id, 'priority' => $task->priority );
	}

	/** GET chat-cards?tasks=1,2&projects=3 — fresh states for the cards on screen. */
	public static function cards( WP_REST_Request $r ) {
		$out = array( 'tasks' => array(), 'projects' => array() );
		foreach ( array( 'tasks' => 'task', 'projects' => 'project' ) as $k => $t ) {
			foreach ( array_slice( array_unique( array_filter( array_map( 'intval', explode( ',', (string) $r[ $k ] ) ) ) ), 0, 60 ) as $id ) {
				$c                    = self::card( $t, $id );
				$out[ $k ][ (string) $id ] = $c ? $c : array( 'gone' => true );
			}
		}
		$out['tasks']    = (object) $out['tasks'];
		$out['projects'] = (object) $out['projects'];
		return $out;
	}

	/* ------------------------------------------------------------------ Stickers and GIFs */

	public static function sticker_payload( $s ) {
		$f = MP_Files::get( $s->file_id );
		return $f ? array( 'id' => (int) $s->id, 'kind' => $s->kind, 'pack' => $s->pack, 'emoji' => $s->emoji, 'file_id' => (int) $s->file_id, 'url' => MP_Files::url( $s->file_id ), 'mime' => $f->mime, 'mine' => (int) $s->created_by === self::uid() ) : null;
	}

	/** GET stickers — the studio's packs and its shared GIFs. */
	public static function stickers() {
		global $wpdb;
		$packs = array();
		$gifs  = array();
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'stickers' ) . ' ORDER BY pack, sort, id' ) as $s ) { // phpcs:ignore
			$p = self::sticker_payload( $s );
			if ( ! $p ) {
				continue;
			}
			if ( 'gif' === $s->kind ) {
				$gifs[] = $p;
			} else {
				$packs[ $s->pack ][] = $p;
			}
		}
		$list = array();
		foreach ( $packs as $name => $items ) {
			$list[] = array( 'name' => $name, 'items' => $items );
		}
		return array( 'packs' => $list, 'gifs' => array_reverse( $gifs ), 'can_manage' => MP_Util::is_manager() );
	}

	/** POST stickers {kind, pack, emoji, file_id?} + file — supervisors add stickers; anyone can save a GIF. */
	public static function add_sticker( WP_REST_Request $r ) {
		global $wpdb;
		$kind = 'gif' === $r['kind'] ? 'gif' : 'sticker';
		if ( 'sticker' === $kind && ! MP_Util::is_manager() ) {
			return self::err( 'فقط ناظر می‌تواند بسته استیکر بسازد.', 403 );
		}
		$fid = (int) $r['file_id'];
		if ( $fid ) {
			// A GIF already in a chat: saved by reference.
			list( $m ) = self::message( (int) $r['message_id'] );
			if ( ! $m || (int) $m->file_id !== $fid ) {
				return self::err( 'فایل پیدا نشد.', 404 );
			}
			$f = MP_Files::get( $fid );
			$copy = MP_Files::store_bytes( 'sticker', 0, $f->name, $f->mime, (string) file_get_contents( MP_Files::dir() . '/' . $f->path ), pathinfo( $f->path, PATHINFO_EXTENSION ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			$file = $copy;
		} else {
			$file = MP_Files::store( 'sticker', 0, true );
			if ( is_wp_error( $file ) ) {
				return $file;
			}
		}
		if ( ! $file ) {
			return self::err( 'ذخیره فایل انجام نشد.', 500 );
		}
		$pack = 'sticker' === $kind ? MP_Util::text( $r['pack'], 60 ) : '';
		$wpdb->insert( self::t( 'stickers' ), array( 'kind' => $kind, 'pack' => '' !== $pack || 'gif' === $kind ? $pack : 'استودیو', 'file_id' => $file->id, 'emoji' => mb_substr( (string) $r['emoji'], 0, 4 ), 'sort' => (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::t( 'stickers' ) ), 'created_by' => self::uid(), 'created_at' => MP_Util::now() ) ); // phpcs:ignore
		return self::stickers();
	}

	public static function delete_sticker( WP_REST_Request $r ) {
		global $wpdb;
		$s = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'stickers' ) . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $s || ( ! MP_Util::is_manager() && (int) $s->created_by !== self::uid() ) ) {
			return self::err( 'اجازه حذف ندارید.', 403 );
		}
		$wpdb->delete( self::t( 'stickers' ), array( 'id' => $s->id ) );
		// Messages that already used it keep showing it, so the file stays.
		return self::stickers();
	}

	/** GET chat-upload/status?upload= — where an interrupted upload continues (after the page was closed). */
	public static function chunk_status( WP_REST_Request $r ) {
		$up   = preg_replace( '/[^a-z0-9]/i', '', (string) $r['upload'] );
		$part = MP_Files::dir() . '/chunks/' . self::uid() . '-' . substr( $up, 0, 40 ) . '.part';
		$next = is_file( $part . '.next' ) ? (int) file_get_contents( $part . '.next' ) : 0; // phpcs:ignore WordPress.WP.AlternativeFunctions
		return array( 'next' => is_file( $part ) ? $next : 0 );
	}
}

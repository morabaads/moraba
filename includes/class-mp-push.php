<?php
defined( 'ABSPATH' ) || exit;

/**
 * Web Push (VAPID) without payload: the push only wakes the service worker, which then reads the
 * newest notification from ?mp_push_feed=1 with the user's own cookie. No message text leaves the site
 * through the push service, and no payload encryption is needed.
 */
class MP_Push {

	const MAX_DEVICES = 6;

	public static function supported() {
		return function_exists( 'openssl_pkey_new' ) && function_exists( 'openssl_sign' );
	}

	/** @return array{0:string,1:string} [private PEM, public key (base64url, uncompressed P-256 point)] */
	public static function keys() {
		$pem = get_option( 'mp_vapid_private' );
		$pub = get_option( 'mp_vapid_public' );
		if ( $pem && $pub ) {
			return array( $pem, $pub );
		}
		$key = openssl_pkey_new( array( 'curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC ) );
		if ( ! $key ) {
			return array( '', '' );
		}
		openssl_pkey_export( $key, $pem );
		$d   = openssl_pkey_get_details( $key );
		$pub = self::b64( "\x04" . str_pad( $d['ec']['x'], 32, "\0", STR_PAD_LEFT ) . str_pad( $d['ec']['y'], 32, "\0", STR_PAD_LEFT ) );
		update_option( 'mp_vapid_private', $pem, false );
		update_option( 'mp_vapid_public', $pub, false );
		return array( $pem, $pub );
	}

	public static function b64( $bin ) {
		return rtrim( strtr( base64_encode( $bin ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions
	}

	/** ECDSA DER signature → raw 64-byte r||s (JWS ES256). */
	public static function der_to_raw( $der ) {
		$pos = 2;
		if ( ord( $der[1] ) & 0x80 ) {
			$pos += ord( $der[1] ) & 0x7f;
		}
		$out = '';
		for ( $i = 0; $i < 2; $i++ ) {
			$len  = ord( $der[ $pos + 1 ] );
			$int  = substr( $der, $pos + 2, $len );
			$int  = ltrim( $int, "\0" );
			$out .= str_pad( $int, 32, "\0", STR_PAD_LEFT );
			$pos += 2 + $len;
		}
		return $out;
	}

	public static function jwt( $endpoint ) {
		list( $pem ) = self::keys();
		$parts       = wp_parse_url( $endpoint );
		$claims      = array(
			'aud' => $parts['scheme'] . '://' . $parts['host'],
			'exp' => time() + 12 * HOUR_IN_SECONDS,
			'sub' => 'mailto:' . get_option( 'admin_email' ),
		);
		$input = self::b64( wp_json_encode( array( 'typ' => 'JWT', 'alg' => 'ES256' ) ) ) . '.' . self::b64( wp_json_encode( $claims ) );
		$der   = '';
		openssl_sign( $input, $der, openssl_pkey_get_private( $pem ), OPENSSL_ALGO_SHA256 );
		return $input . '.' . self::b64( self::der_to_raw( $der ) );
	}

	/** Push endpoints of the panel app, or ($chat) of «مربع چت», which only hears about messages. */
	public static function devices( $user_id, $chat = false ) {
		$subs = get_user_meta( $user_id, $chat ? 'mp_push_chat' : 'mp_push_subs', true );
		return is_array( $subs ) ? $subs : array();
	}

	public static function valid_endpoint( $url ) {
		return is_string( $url ) && strlen( $url ) < 1000 && 0 === strpos( $url, 'https://' ) && wp_http_validate_url( $url );
	}

	public static function subscribe( $user_id, $endpoint, $chat = false ) {
		$subs = array_values( array_diff( self::devices( $user_id, $chat ), array( $endpoint ) ) );
		array_unshift( $subs, $endpoint );
		update_user_meta( $user_id, $chat ? 'mp_push_chat' : 'mp_push_subs', array_slice( $subs, 0, self::MAX_DEVICES ) );
	}

	public static function unsubscribe( $user_id, $endpoint, $chat = false ) {
		update_user_meta( $user_id, $chat ? 'mp_push_chat' : 'mp_push_subs', array_values( array_diff( self::devices( $user_id, $chat ), array( $endpoint ) ) ) );
	}

	/** Wake every device of the user. Non-blocking, so saving a task never waits for push services. */
	public static function send( $user_id, $message = false ) {
		if ( ! self::supported() ) {
			return 0;
		}
		list( , $pub ) = self::keys();
		$n             = 0;
		// «مربع چت» devices wake only for chat messages.
		foreach ( array_merge( self::devices( $user_id ), $message ? self::devices( $user_id, true ) : array() ) as $endpoint ) {
			wp_remote_post(
				$endpoint,
				array(
					'blocking' => false,
					'timeout'  => 5,
					'headers'  => array(
						'TTL'           => '86400',
						'Urgency'       => 'high',
						'Authorization' => 'vapid t=' . self::jwt( $endpoint ) . ', k=' . $pub,
					),
					'body'     => '',
				)
			);
			++$n;
		}
		return $n;
	}

	/** Newest unread notification for the service worker (cookie-authenticated, read-only). */
	public static function feed() {
		global $wpdb;
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'X-Content-Type-Options: nosniff' );
		$uid = get_current_user_id();
		if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) ) {
			status_header( 401 );
			exit( '{}' );
		}
		// «خوانده شد» on a chat notification (only from the service worker: it sends this header).
		if ( isset( $_GET['read'] ) && ! empty( $_SERVER['HTTP_X_MP_PUSH'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$ch = MP_Rest::channel_for( (int) $_GET['read'], $uid ); // phpcs:ignore WordPress.Security.NonceVerification
			if ( $ch ) {
				MP_Chat::mark_read( $ch, $uid, MP_Chat::last_id( $ch->id ) );
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . MP_Install::table( 'notifications' ) . " SET is_read = 1 WHERE user_id = %d AND target = 'messages' AND ref_id = %d", $uid, $ch->id ) );
			}
			exit( '{"ok":true}' );
		}
		// &chat=1: «مربع چت» (service worker and Android app) — only chat messages, opened in the chat app.
		$only  = isset( $_GET['chat'] ) ? " AND target IN ('messages','chatmsg')" : ''; // phpcs:ignore WordPress.Security.NonceVerification
		$n     = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'notifications' ) . ' WHERE user_id = %d AND is_read = 0' . $only . ' ORDER BY id DESC LIMIT 1', $uid ) ); // phpcs:ignore
		$count = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . MP_Install::table( 'notifications' ) . ' WHERE user_id = %d AND is_read = 0' . $only, $uid ) ); // phpcs:ignore
		$views = array( 'calendar' => 'calendar', 'task' => 'mytasks', 'messages' => 'messages', 'meeting' => 'dashboard', 'projects' => 'projects', 'reminders' => 'reminders', 'attendance' => 'attendance', 'reports' => 'reports' );
		$chat = $n && 'messages' === $n->target && $n->ref_id;
		$base = $only ? MP_Frontend::chat_url() : MP_Frontend::panel_url();
		$url  = $base . '#' . ( isset( $views[ $n ? $n->target : '' ] ) ? $views[ $n->target ] : 'dashboard' );
		if ( $chat ) {
			$url = $base . '#chat-' . (int) $n->ref_id;
		} elseif ( $n && 'chatmsg' === $n->target ) {
			$url = $base . '#msg-' . (int) $n->ref_id;
		}
		echo wp_json_encode(
			$n ? array(
				'id'      => (int) $n->id,
				'title'   => $n->title,
				'body'    => MP_Jalali::digits( $n->detail ),
				'url'     => $url,
				// One notification per chat: a new message replaces the previous one, like Telegram.
				'tag'     => $chat ? 'mp-chat-' . (int) $n->ref_id : 'mp-' . $n->id,
				'channel' => $chat ? (int) $n->ref_id : 0,
				'count'   => $count,
			) : array( 'count' => 0 ),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
		);
		exit;
	}
}

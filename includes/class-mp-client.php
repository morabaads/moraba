<?php
defined( 'ABSPATH' ) || exit;

/**
 * Client groups: people on the client side, their mobile login, and the group's look.
 *
 * - A client group can have any number of client contacts (name + mobile), added at any time, even in
 *   the middle of a conversation. The team can text a contact the link.
 * - With «ورود با کد پیامک» on, the portal asks for a mobile number; only numbers saved for that group
 *   get a 5-digit code (same SMS service as the staff login). A signed cookie keeps them logged in for
 *   30 days. Every client route — messages, portal, files — checks it.
 * - Each group can have its own logo (the client's), shown in the portal next to the studio's.
 */
class MP_Client {

	const COOKIE_DAYS = 30;

	public static function register() {
		$auth = array( 'MP_Rest', 'can_access' );
		$tok  = 'client/(?P<token>[A-Za-z0-9]{32})';
		$id   = '(?P<id>\d+)';
		$routes = array(
			array( "channels/$id/client", 'GET', 'settings', $auth ),
			array( "channels/$id/client", 'POST', 'save_settings', $auth ),
			array( "channels/$id/contacts", 'POST', 'add_contact', $auth ),
			array( "client-contacts/$id", 'DELETE', 'remove_contact', $auth ),
			array( "client-contacts/$id/sms", 'POST', 'sms_link', $auth ),
			array( "$tok/me", 'GET', 'me', '__return_true' ),
			array( "$tok/login/request", 'POST', 'login_request', '__return_true' ),
			array( "$tok/login/verify", 'POST', 'login_verify', '__return_true' ),
			array( "$tok/logout", 'POST', 'logout', '__return_true' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $r[3] ) );
		}
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	private static function err( $m, $s = 400, $code = 'mp_error' ) {
		return new WP_Error( $code, $m, array( 'status' => $s ) );
	}

	/** The client link: /c/{token}/ with pretty permalinks, ?mp_client= otherwise. */
	public static function url( $token ) {
		return get_option( 'permalink_structure' ) ? home_url( '/c/' . $token . '/' ) : add_query_arg( 'mp_client', $token, home_url( '/' ) );
	}

	public static function channel( $token ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND token = %s AND archived_at IS NULL", (string) $token ) );
	}

	/** Client group the current panel user may manage. */
	private static function team_channel( $id ) {
		global $wpdb;
		$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE id = %d AND type = 'client'", (int) $id ) );
		return $ch && MP_Rest::can_read_channel( $ch->id ) ? $ch : null;
	}

	public static function logo_url( $ch ) {
		if ( empty( $ch->logo_file_id ) ) {
			return '';
		}
		$p = MP_Files::payload( MP_Files::get( (int) $ch->logo_file_id ) );
		return $p ? $p['url'] : '';
	}

	private static function contacts( $channel_id ) {
		global $wpdb;
		return array_map(
			function ( $c ) {
				return array( 'id' => (int) $c->id, 'name' => $c->name, 'mobile' => $c->mobile, 'last_login' => $c->last_login );
			},
			$wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE channel_id = %d ORDER BY id', $channel_id ) )
		);
	}

	/* ------------------------------------------------------------------ Session (signed cookie) */

	private static function cookie_name( $ch ) {
		return 'mp_cl_' . (int) $ch->id;
	}

	private static function sign( $data ) {
		return hash_hmac( 'sha256', $data, wp_salt( 'auth' ) );
	}

	/** Logged-in client contact for this group, or null. */
	public static function session( $ch ) {
		global $wpdb;
		$c = isset( $_COOKIE[ self::cookie_name( $ch ) ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::cookie_name( $ch ) ] ) ) : '';
		$p = explode( '|', $c );
		if ( 3 !== count( $p ) || (int) $p[1] < time() || ! hash_equals( self::sign( $ch->id . '|' . $p[0] . '|' . $p[1] . '|' . $ch->token ), $p[2] ) ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d AND channel_id = %d', (int) $p[0], $ch->id ) );
	}

	/** WP_Error when the group needs a login and there is none; null when the client may continue. */
	public static function gate( $ch ) {
		if ( ! $ch ) {
			return self::err( 'این لینک معتبر نیست.', 404 );
		}
		if ( ! empty( $ch->auth_required ) && ! self::session( $ch ) ) {
			return self::err( 'برای دیدن این صفحه وارد شوید.', 401, 'mp_login_required' );
		}
		return null;
	}

	/** Name to show for what the client writes: the logged-in contact, else what they typed. */
	public static function author( $ch, $typed ) {
		$s = self::session( $ch );
		return $s ? $s->name : ( '' !== trim( (string) $typed ) ? MP_Util::text( $typed, 80 ) : $ch->client_name );
	}

	/* ------------------------------------------------------------------ Client routes */

	/** GET client/{token}/me — what the page needs before anything else. */
	public static function me( WP_REST_Request $r ) {
		$ch = self::channel( $r['token'] );
		if ( ! $ch ) {
			return self::err( 'این لینک معتبر نیست یا غیرفعال شده است.', 404 );
		}
		$s = self::session( $ch );
		return array(
			'title'         => $ch->title,
			'client'        => $ch->client_name,
			'logo'          => self::logo_url( $ch ),
			'auth_required' => ! empty( $ch->auth_required ),
			'logged_in'     => (bool) $s,
			'name'          => $s ? $s->name : '',
			'sms'           => MP_Auth::otp_enabled(),
		);
	}

	private static function otp_key( $ch, $mobile ) {
		return 'mp_cotp_' . md5( $ch->id . '|' . $mobile );
	}

	/** POST client/{token}/login/request {mobile} */
	public static function login_request( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::channel( $r['token'] );
		if ( ! $ch ) {
			return self::err( 'این لینک معتبر نیست.', 404 );
		}
		if ( ! MP_Auth::otp_enabled() ) {
			return self::err( 'سرویس پیامک فعال نیست؛ با تیم تماس بگیرید.', 503 );
		}
		$mobile = MP_Auth::normalize( $r['mobile'] );
		if ( ! $mobile ) {
			return self::err( 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷' );
		}
		$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ipk = 'mp_cotp_ip_' . md5( $ip );
		$n   = (int) get_transient( $ipk );
		if ( $n >= MP_Auth::MAX_IP ) {
			return self::err( 'درخواست‌ها زیاد بود. کمی بعد دوباره امتحان کنید.', 429 );
		}
		set_transient( $ipk, $n + 1, HOUR_IN_SECONDS );
		$contact = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE channel_id = %d AND mobile = %s', $ch->id, $mobile ) );
		if ( ! $contact ) {
			return self::err( 'این شماره برای این پروژه ثبت نشده. از تیم مربع بخواهید شماره شما را اضافه کند.', 404 );
		}
		$state = get_transient( self::otp_key( $ch, $mobile ) );
		$now   = time();
		if ( is_array( $state ) && ! empty( $state['sent'] ) && $state['sent'] > $now - MP_Auth::RESEND_WAIT ) {
			return self::err( 'کد تازه ارسال شده؛ ' . MP_Jalali::digits( (string) ( MP_Auth::RESEND_WAIT - ( $now - $state['sent'] ) ) ) . ' ثانیه دیگر دوباره امتحان کنید.', 429 );
		}
		$code = (string) wp_rand( 10000, 99999 );
		set_transient( self::otp_key( $ch, $mobile ), array( 'hash' => wp_hash( $mobile . '|' . $code ), 'exp' => $now + MP_Auth::CODE_TTL, 'tries' => 0, 'sent' => $now ), HOUR_IN_SECONDS );
		if ( defined( 'MP_TESTING' ) && MP_TESTING ) {
			$GLOBALS['mp_last_otp'] = $code;
		}
		if ( ! MP_Auth::send_code( $mobile, $code ) ) {
			return self::err( 'ارسال پیامک انجام نشد؛ کمی بعد دوباره امتحان کنید.', 502 );
		}
		return array( 'sent' => true, 'ttl' => MP_Auth::CODE_TTL, 'wait' => MP_Auth::RESEND_WAIT, 'mobile' => $mobile );
	}

	/** POST client/{token}/login/verify {mobile, code} */
	public static function login_verify( WP_REST_Request $r ) {
		global $wpdb;
		$ch     = self::channel( $r['token'] );
		$mobile = MP_Auth::normalize( $r['mobile'] );
		if ( ! $ch || ! $mobile ) {
			return self::err( 'اطلاعات ورود معتبر نیست.' );
		}
		$state = get_transient( self::otp_key( $ch, $mobile ) );
		if ( ! is_array( $state ) || empty( $state['hash'] ) || $state['exp'] < time() ) {
			return self::err( 'کد منقضی شده؛ کد جدید بگیرید.' );
		}
		$code = preg_replace( '/\D/', '', J_latin( (string) $r['code'] ) );
		if ( ! hash_equals( $state['hash'], wp_hash( $mobile . '|' . $code ) ) ) {
			++$state['tries'];
			if ( $state['tries'] >= MP_Auth::MAX_TRIES ) {
				$state['hash'] = '';
			}
			set_transient( self::otp_key( $ch, $mobile ), $state, HOUR_IN_SECONDS );
			return self::err( $state['hash'] ? 'کد درست نیست.' : 'کد چند بار اشتباه وارد شد؛ کد جدید بگیرید.' );
		}
		delete_transient( self::otp_key( $ch, $mobile ) );
		$contact = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE channel_id = %d AND mobile = %s', $ch->id, $mobile ) );
		if ( ! $contact ) {
			return self::err( 'این شماره دیگر در این پروژه نیست.', 403 );
		}
		$exp = time() + self::COOKIE_DAYS * DAY_IN_SECONDS;
		$val = $contact->id . '|' . $exp . '|' . self::sign( $ch->id . '|' . $contact->id . '|' . $exp . '|' . $ch->token );
		setcookie( self::cookie_name( $ch ), $val, array( 'expires' => $exp, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
		$_COOKIE[ self::cookie_name( $ch ) ] = $val;
		$wpdb->update( self::t( 'client_contacts' ), array( 'last_login' => MP_Util::now() ), array( 'id' => $contact->id ) );
		return array( 'logged_in' => true, 'name' => $contact->name );
	}

	public static function logout( WP_REST_Request $r ) {
		$ch = self::channel( $r['token'] );
		if ( $ch ) {
			setcookie( self::cookie_name( $ch ), '', array( 'expires' => time() - 3600, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
		}
		return array( 'logged_out' => true );
	}

	/* ------------------------------------------------------------------ Team routes */

	private static function settings_payload( $ch ) {
		return array(
			'id'            => (int) $ch->id,
			'title'         => $ch->title,
			'client'        => $ch->client_name,
			'url'           => self::url( $ch->token ),
			'logo'          => self::logo_url( $ch ),
			'logo_file_id'  => (int) $ch->logo_file_id,
			'auth_required' => ! empty( $ch->auth_required ),
			'sms'           => MP_Auth::otp_enabled(),
			'contacts'      => self::contacts( $ch->id ),
		);
	}

	public static function settings( WP_REST_Request $r ) {
		$ch = self::team_channel( $r['id'] );
		return $ch ? self::settings_payload( $ch ) : self::err( 'گروه مشتری پیدا نشد.', 404 );
	}

	/** POST channels/{id}/client {auth_required?, logo_file_id?, title?, client_name?} */
	public static function save_settings( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::team_channel( $r['id'] );
		if ( ! $ch ) {
			return self::err( 'گروه مشتری پیدا نشد.', 404 );
		}
		$f = array();
		if ( null !== $r['auth_required'] ) {
			$f['auth_required'] = $r['auth_required'] && 'false' !== $r['auth_required'] ? 1 : 0;
			if ( $f['auth_required'] && ! self::contacts( $ch->id ) ) {
				return self::err( 'اول حداقل یک شماره مشتری اضافه کنید، بعد ورود با کد را روشن کنید.' );
			}
		}
		if ( null !== $r['logo_file_id'] ) {
			$fid = (int) $r['logo_file_id'];
			if ( $fid ) {
				$file = MP_Files::get( $fid );
				if ( ! $file || 'client_logo' !== $file->context || 0 !== strpos( $file->mime, 'image/' ) ) {
					return self::err( 'لوگو باید تصویر باشد.' );
				}
			}
			$f['logo_file_id'] = $fid;
		}
		if ( null !== $r['title'] && '' !== trim( (string) $r['title'] ) ) {
			$f['title'] = MP_Util::text( $r['title'], 160 );
		}
		if ( null !== $r['client_name'] && '' !== trim( (string) $r['client_name'] ) ) {
			$f['client_name'] = MP_Util::text( $r['client_name'], 120 );
		}
		if ( $f ) {
			$wpdb->update( self::t( 'channels' ), $f, array( 'id' => $ch->id ) );
		}
		return self::settings_payload( self::team_channel( $ch->id ) );
	}

	/** POST channels/{id}/contacts {name, mobile, sms?} — also works in the middle of a conversation. */
	public static function add_contact( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::team_channel( $r['id'] );
		if ( ! $ch ) {
			return self::err( 'گروه مشتری پیدا نشد.', 404 );
		}
		$name   = MP_Util::text( $r['name'], 80 );
		$mobile = MP_Auth::normalize( $r['mobile'] );
		if ( '' === $name || ! $mobile ) {
			return self::err( 'نام و شماره موبایل معتبر وارد کنید.' );
		}
		if ( $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'client_contacts' ) . ' WHERE channel_id = %d AND mobile = %s', $ch->id, $mobile ) ) ) {
			return self::err( 'این شماره در این گروه هست.' );
		}
		$wpdb->insert( self::t( 'client_contacts' ), array( 'channel_id' => $ch->id, 'name' => $name, 'mobile' => $mobile, 'created_at' => MP_Util::now() ) );
		$cid = (int) $wpdb->insert_id;
		// Everyone in the conversation sees who joined.
		$wpdb->insert( self::t( 'messages' ), array( 'channel_id' => $ch->id, 'user_id' => get_current_user_id(), 'body' => $name . ' به گفت‌وگو اضافه شد.', 'created_at' => MP_Util::now() ) );
		MP_Audit::log( 'add', 'member', $ch->id, $name . ' به گروه مشتری «' . $ch->title . '»' );
		if ( ! empty( $r['sms'] ) ) {
			self::send_link( $ch, $mobile, $name );
		}
		return self::settings_payload( $ch );
	}

	public static function remove_contact( WP_REST_Request $r ) {
		global $wpdb;
		$c  = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d', (int) $r['id'] ) );
		$ch = $c ? self::team_channel( $c->channel_id ) : null;
		if ( ! $ch ) {
			return self::err( 'پیدا نشد.', 404 );
		}
		$wpdb->delete( self::t( 'client_contacts' ), array( 'id' => $c->id ) );
		MP_Audit::log( 'remove', 'member', $ch->id, $c->name . ' از گروه مشتری «' . $ch->title . '»' );
		return self::settings_payload( $ch );
	}

	private static function send_link( $ch, $mobile, $name ) {
		return MP_Auth::text( $mobile, $name . ' عزیز، پرتال پروژه «' . $ch->title . '» در مربع استودیو: ' . self::url( $ch->token ) );
	}

	public static function sms_link( WP_REST_Request $r ) {
		global $wpdb;
		$c  = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d', (int) $r['id'] ) );
		$ch = $c ? self::team_channel( $c->channel_id ) : null;
		if ( ! $ch ) {
			return self::err( 'پیدا نشد.', 404 );
		}
		return self::send_link( $ch, $c->mobile, $c->name ) ? array( 'sent' => true ) : self::err( 'ارسال پیامک انجام نشد؛ تنظیمات پیامک را بررسی کنید.', 502 );
	}
}

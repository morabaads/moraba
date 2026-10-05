<?php
defined( 'ABSPATH' ) || exit;

/**
 * Mobile numbers as the login identity, one-time codes by SMS (sms.ir or Kavenegar),
 * and a guard for hosts where PHP mail() is disabled.
 */
class MP_Auth {

	const CODE_TTL    = 180; // seconds a code stays valid
	const RESEND_WAIT = 60;  // seconds between two codes for one number
	const MAX_TRIES   = 5;   // wrong guesses before the code is burned
	const MAX_SENDS   = 6;   // codes per number per hour
	const MAX_IP      = 20;  // code requests per IP per hour

	/** Provider's reason for the last failed send, shown to the admin by the test button. */
	public static $last_error = '';

	public static function init() {
		// Hosts that disable mail() make wp_mail() fatal (e.g. when adding a user). Skip mail there,
		// unless an SMTP plugin has hooked PHPMailer, in which case mail() is never used.
		add_filter( 'pre_wp_mail', array( __CLASS__, 'guard_mail' ), 999 );
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function guard_mail( $short ) {
		if ( null !== $short || function_exists( 'mail' ) || has_action( 'phpmailer_init' ) ) {
			return $short;
		}
		return false;
	}

	/* ------------------------------------------------------------------ Mobile numbers */

	/** Any common Iranian format (Persian digits, +98, 0098, 98, 9xx) → 09xxxxxxxxx, or '' if invalid. */
	public static function normalize( $raw ) {
		$n = preg_replace( '/\D/', '', J_latin( (string) $raw ) );
		if ( 0 === strpos( $n, '0098' ) ) {
			$n = substr( $n, 4 );
		} elseif ( 0 === strpos( $n, '98' ) && 12 === strlen( $n ) ) {
			$n = substr( $n, 2 );
		}
		if ( 10 === strlen( $n ) && '9' === $n[0] ) {
			$n = '0' . $n;
		}
		return preg_match( '/^09\d{9}$/', $n ) ? $n : '';
	}

	/**
	 * Finds the user by number whatever format it was saved in (older versions stored it as typed:
	 * spaces, Persian digits, +98…). Prefers a user who can open the panel if several match.
	 */
	public static function user_by_mobile( $mobile ) {
		global $wpdb;
		if ( ! $mobile ) {
			return null;
		}
		// Staff lists are small; comparing normalized values also catches old formats.
		$rows  = $wpdb->get_results( "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key = 'mp_phone' AND meta_value <> ''" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$found = null;
		foreach ( $rows as $row ) {
			if ( self::normalize( $row->meta_value ) !== $mobile || ! get_userdata( $row->user_id ) ) {
				continue;
			}
			if ( $row->meta_value !== $mobile ) {
				update_user_meta( $row->user_id, 'mp_phone', $mobile ); // heal the stored format
			}
			if ( user_can( (int) $row->user_id, 'mp_access_panel' ) ) {
				return (int) $row->user_id;
			}
			$found = $found ? $found : (int) $row->user_id;
		}
		return $found;
	}

	/** True when another user already owns this number. */
	public static function mobile_taken( $mobile, $except_user = 0 ) {
		$owner = self::user_by_mobile( $mobile );
		return $owner && $owner !== (int) $except_user;
	}

	/* ------------------------------------------------------------------ SMS */

	public static function provider() {
		$p = get_option( 'mp_sms_provider', '' );
		if ( 'smsir' === $p && get_option( 'mp_smsir_key', '' ) ) {
			return 'smsir';
		}
		if ( 'kavenegar' === $p && get_option( 'mp_sms_key', '' ) ) {
			return 'kavenegar';
		}
		return '';
	}

	public static function otp_enabled() {
		return (bool) self::provider();
	}

	private static function post( $url, $args ) {
		$args = wp_parse_args( $args, array( 'timeout' => 12 ) );
		$res  = wp_remote_post( $url, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		return array( 'code' => $code, 'body' => is_array( $body ) ? $body : array() );
	}

	/**
	 * Plain text message. Non-blocking by default (returns true when handed to a provider);
	 * blocking returns whether the provider accepted it and sets $last_error otherwise.
	 */
	public static function text( $mobile, $message, $blocking = false ) {
		self::$last_error = '';
		$mobile           = self::normalize( $mobile );
		if ( ! $mobile ) {
			self::$last_error = 'شماره موبایل معتبر نیست.';
			return false;
		}
		switch ( self::provider() ) {
			case 'smsir':
				if ( ! get_option( 'mp_smsir_line', '' ) ) {
					self::$last_error = 'شماره خط sms.ir خالی است؛ پیامک متن عادی بدون خط ارسال نمی‌شود (برای این پیام پترن ثبت کنید یا شماره خط را وارد کنید).';
					return false;
				}
				$args = array(
					'headers' => array( 'X-API-KEY' => get_option( 'mp_smsir_key' ), 'Content-Type' => 'application/json', 'Accept' => 'text/plain' ),
					'body'    => wp_json_encode( array( 'lineNumber' => (int) get_option( 'mp_smsir_line' ), 'messageText' => $message, 'mobiles' => array( $mobile ) ) ),
				);
				if ( ! $blocking ) {
					wp_remote_post( 'https://api.sms.ir/v1/send/bulk', $args + array( 'blocking' => false, 'timeout' => 5 ) );
					return true;
				}
				$res = self::post( 'https://api.sms.ir/v1/send/bulk', $args + array( 'timeout' => 10 ) );
				$ok  = ! is_wp_error( $res ) && isset( $res['body']['status'] ) && 1 === (int) $res['body']['status'];
				if ( ! $ok ) {
					self::$last_error = is_wp_error( $res ) ? $res->get_error_message() : 'sms.ir HTTP ' . $res['code'] . ( isset( $res['body']['message'] ) ? ' — ' . $res['body']['message'] : '' );
				}
				return $ok;
			case 'kavenegar':
				$url  = 'https://api.kavenegar.com/v1/' . rawurlencode( get_option( 'mp_sms_key' ) ) . '/sms/send.json';
				$args = array( 'body' => array( 'receptor' => $mobile, 'sender' => get_option( 'mp_sms_sender', '' ), 'message' => $message ) );
				if ( ! $blocking ) {
					wp_remote_post( $url, $args + array( 'blocking' => false, 'timeout' => 5 ) );
					return true;
				}
				$res = self::post( $url, $args );
				if ( is_wp_error( $res ) || 200 !== $res['code'] ) {
					self::$last_error = is_wp_error( $res ) ? $res->get_error_message() : 'کاوه‌نگار HTTP ' . $res['code'] . ( isset( $res['body']['return']['message'] ) ? ' — ' . $res['body']['return']['message'] : '' );
					return false;
				}
				return true;
		}
		self::$last_error = 'سرویس پیامک انتخاب نشده یا کلید API خالی است.';
		return false;
	}

	/** Login code. Blocking, so the person is told right away if the provider refused. Text and pattern come from «اعلان‌ها و پیامک‌ها». */
	public static function send_code( $mobile, $code ) {
		$ok = MP_Messages::send_sms( 'otp', $mobile, array( 'CODE' => (string) $code ) );
		if ( ! $ok ) {
			self::$last_error = MP_Messages::$last_error;
		}
		return $ok;
	}

	/* ------------------------------------------------------------------ One-time code login */

	public static function routes() {
		$open = '__return_true';
		register_rest_route( 'moraba-panel/v1', 'otp/request', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'request_code' ), 'permission_callback' => $open ) );
		register_rest_route( 'moraba-panel/v1', 'otp/verify', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'verify_code' ), 'permission_callback' => $open ) );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_otp', $msg, array( 'status' => $status ) );
	}

	private static function key( $mobile ) {
		return 'mp_otp_' . md5( $mobile . wp_salt( 'nonce' ) );
	}

	private static function hash( $mobile, $code ) {
		return hash_hmac( 'sha256', $mobile . '|' . $code, wp_salt( 'auth' ) );
	}

	private static function ip() {
		return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	}

	public static function request_code( WP_REST_Request $r ) {
		if ( ! self::otp_enabled() ) {
			return self::err( 'ورود با پیامک فعال نیست. با نام کاربری وارد شوید.' );
		}
		$mobile = self::normalize( $r['mobile'] );
		if ( ! $mobile ) {
			return self::err( 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷' );
		}
		$ip_key = 'mp_otp_ip_' . md5( self::ip() );
		$ip_n   = (int) get_transient( $ip_key );
		if ( $ip_n >= self::MAX_IP ) {
			return self::err( 'درخواست‌ها زیاد بود. کمی بعد دوباره امتحان کنید.', 429 );
		}
		set_transient( $ip_key, $ip_n + 1, HOUR_IN_SECONDS );

		$state = get_transient( self::key( $mobile ) );
		$state = is_array( $state ) ? $state : array( 'sends' => array() );
		$now   = time();
		$sends = array_values(
			array_filter(
				(array) $state['sends'],
				function ( $t ) use ( $now ) {
					return $t > $now - HOUR_IN_SECONDS;
				}
			)
		);
		if ( $sends && end( $sends ) > $now - self::RESEND_WAIT ) {
			return self::err( 'کد قبلی تازه ارسال شده؛ ' . MP_Jalali::digits( (string) ( self::RESEND_WAIT - ( $now - end( $sends ) ) ) ) . ' ثانیه دیگر دوباره امتحان کنید.', 429 );
		}
		if ( count( $sends ) >= self::MAX_SENDS ) {
			return self::err( 'تعداد درخواست کد برای این شماره زیاد بود. یک ساعت دیگر امتحان کنید.', 429 );
		}

		$uid = self::user_by_mobile( $mobile );
		// Internal panel: telling people exactly what is missing saves a support call.
		if ( ! $uid ) {
			return self::err( 'این شماره برای هیچ کارمندی ثبت نشده. از ناظر بخواهید شماره شما را در تنظیمات پنل ثبت کند.', 404 );
		}
		if ( ! user_can( $uid, 'mp_access_panel' ) ) {
			return self::err( 'شماره شما ثبت شده ولی حسابتان هنوز نقش «کارمند» یا «ناظر» پنل را ندارد. از مدیر سایت بخواهید در «پنل مربع ← دسترسی به پنل» تیک نقش شما را بزند.', 403 );
		}

		$code    = (string) wp_rand( 10000, 99999 );
		$sends[] = $now;
		set_transient(
			self::key( $mobile ),
			array( 'hash' => self::hash( $mobile, $code ), 'exp' => $now + self::CODE_TTL, 'tries' => 0, 'sends' => $sends ),
			HOUR_IN_SECONDS
		);
		if ( defined( 'MP_TESTING' ) && MP_TESTING ) {
			$GLOBALS['mp_last_otp'] = $code;
		}
		if ( ! self::send_code( $mobile, $code ) ) {
			return self::err( 'ارسال پیامک انجام نشد. تنظیمات پنل پیامک را بررسی کنید یا با نام کاربری وارد شوید.', 502 );
		}
		return array( 'sent' => true, 'ttl' => self::CODE_TTL, 'wait' => self::RESEND_WAIT, 'mobile' => $mobile );
	}

	public static function verify_code( WP_REST_Request $r ) {
		$mobile = self::normalize( $r['mobile'] );
		$code   = preg_replace( '/\D/', '', J_latin( (string) $r['code'] ) );
		$state  = $mobile ? get_transient( self::key( $mobile ) ) : null;
		if ( ! is_array( $state ) || empty( $state['hash'] ) || $state['exp'] < time() ) {
			return self::err( 'کد منقضی شده. کد جدید بگیرید.' );
		}
		if ( ! hash_equals( $state['hash'], self::hash( $mobile, $code ) ) ) {
			++$state['tries'];
			if ( $state['tries'] >= self::MAX_TRIES ) {
				$state['hash'] = '';
			}
			set_transient( self::key( $mobile ), $state, HOUR_IN_SECONDS );
			return self::err( $state['hash'] ? 'کد درست نیست.' : 'کد چند بار اشتباه وارد شد. کد جدید بگیرید.' );
		}
		$uid = self::user_by_mobile( $mobile );
		if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) ) {
			return self::err( 'دسترسی ندارید.', 403 );
		}
		$state['hash'] = '';
		set_transient( self::key( $mobile ), $state, HOUR_IN_SECONDS );
		wp_set_current_user( $uid );
		wp_set_auth_cookie( $uid, ! empty( $r['remember'] ), is_ssl() );
		do_action( 'wp_login', get_userdata( $uid )->user_login, get_userdata( $uid ) );
		MP_Audit::log( 'login', 'user', $uid, 'ورود با موبایل' );
		return array( 'ok' => true, 'redirect' => MP_Frontend::panel_url() );
	}
}

<?php
defined( 'ABSPATH' ) || exit;

/**
 * The Android app's way in: one address (/mp-app/) for staff and clients alike.
 *
 * - Signed in as staff → the panel. Signed in to one client portal → that portal; to several → a short list.
 * - Otherwise one login: the mobile number gets a code; the server knows whether it belongs to a colleague
 *   (panel login), to a client contact (that client's portals), or both.
 * - ?mp_client_feed=1 — the newest team message in the client's portals, for the app's notifications
 *   (staff use the panel's own push feed).
 */
class MP_App {

	public static function url() {
		return get_option( 'permalink_structure' ) ? home_url( '/mp-app/' ) : add_query_arg( 'mp_app', 1, home_url( '/' ) );
	}

	public static function register() {
		$open = '__return_true';
		register_rest_route( 'moraba-panel/v1', '/app/otp/request', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'request_code' ), 'permission_callback' => $open ) );
		register_rest_route( 'moraba-panel/v1', '/app/otp/verify', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'verify_code' ), 'permission_callback' => $open ) );
		register_rest_route( 'moraba-panel/v1', '/app/info', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'info' ), 'permission_callback' => $open ) );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_error', $msg, array( 'status' => $status ) );
	}

	/** GET app/info — what the app's first screen shows about a site before signing in. */
	public static function info() {
		return array(
			'name'  => get_bloginfo( 'name' ),
			'entry' => self::url(),
			'otp'   => MP_Auth::otp_enabled(),
			'icon'  => MP_URL . 'assets/img/icon-192.png',
			'app'   => 2,
		);
	}

	/** Client contacts with this mobile, in portals that are still open. */
	private static function contacts( $mobile ) {
		global $wpdb;
		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT cc.* FROM ' . MP_Install::table( 'client_contacts' ) . ' cc JOIN ' . MP_Install::table( 'channels' ) . " ch ON ch.id = cc.channel_id WHERE cc.mobile = %s AND ch.type = 'client' AND ch.archived_at IS NULL",
				$mobile
			)
		);
	}

	private static function staff( $mobile ) {
		$uid = MP_Auth::user_by_mobile( $mobile );
		return $uid && user_can( $uid, 'mp_access_panel' ) ? (int) $uid : 0;
	}

	private static function key( $mobile ) {
		return 'mp_aotp_' . md5( $mobile );
	}

	/** POST app/otp/request {mobile} — one code, whoever the number belongs to. */
	public static function request_code( WP_REST_Request $r ) {
		if ( ! MP_Auth::otp_enabled() ) {
			return self::err( 'ورود با پیامک روی این سایت فعال نیست؛ کارمندان با نام کاربری وارد شوند و مشتریان از لینک پرتال.' );
		}
		$mobile = MP_Auth::normalize( $r['mobile'] );
		if ( ! $mobile ) {
			return self::err( 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷' );
		}
		$ip    = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ipk   = 'mp_aotp_ip_' . md5( $ip );
		$ipn   = (int) get_transient( $ipk );
		if ( $ipn >= MP_Auth::MAX_IP ) {
			return self::err( 'درخواست‌ها زیاد بود. کمی بعد دوباره امتحان کنید.', 429 );
		}
		set_transient( $ipk, $ipn + 1, HOUR_IN_SECONDS );
		if ( ! self::staff( $mobile ) && ! self::contacts( $mobile ) ) {
			return self::err( 'این شماره نه برای کارمندان ثبت شده و نه برای مشتریان. اگر کارمند هستید از ناظر و اگر مشتری هستید از تیم مربع بخواهید شماره شما را ثبت کند.', 404 );
		}
		$now   = time();
		$state = get_transient( self::key( $mobile ) );
		$sends = is_array( $state ) && ! empty( $state['sends'] ) ? array_values( array_filter( (array) $state['sends'], function ( $t ) use ( $now ) { return $t > $now - HOUR_IN_SECONDS; } ) ) : array();
		if ( $sends && end( $sends ) > $now - MP_Auth::RESEND_WAIT ) {
			return self::err( 'کد قبلی تازه ارسال شده؛ ' . MP_Jalali::digits( (string) ( MP_Auth::RESEND_WAIT - ( $now - end( $sends ) ) ) ) . ' ثانیه دیگر دوباره امتحان کنید.', 429 );
		}
		if ( count( $sends ) >= MP_Auth::MAX_SENDS ) {
			return self::err( 'تعداد درخواست کد برای این شماره زیاد بود. یک ساعت دیگر امتحان کنید.', 429 );
		}
		$code    = (string) wp_rand( 10000, 99999 );
		$sends[] = $now;
		set_transient( self::key( $mobile ), array( 'hash' => wp_hash( 'app|' . $mobile . '|' . $code ), 'exp' => $now + MP_Auth::CODE_TTL, 'tries' => 0, 'sends' => $sends ), HOUR_IN_SECONDS );
		if ( defined( 'MP_TESTING' ) && MP_TESTING ) {
			$GLOBALS['mp_last_otp'] = $code;
		}
		if ( ! MP_Auth::send_code( $mobile, $code ) ) {
			return self::err( 'ارسال پیامک انجام نشد؛ کمی بعد دوباره امتحان کنید.', 502 );
		}
		return array( 'sent' => true, 'ttl' => MP_Auth::CODE_TTL, 'wait' => MP_Auth::RESEND_WAIT, 'mobile' => $mobile );
	}

	/** POST app/otp/verify {mobile, code} — signs in as staff, as the client contact(s), or both. */
	public static function verify_code( WP_REST_Request $r ) {
		global $wpdb;
		$mobile = MP_Auth::normalize( $r['mobile'] );
		$code   = preg_replace( '/\D/', '', J_latin( (string) $r['code'] ) );
		$state  = $mobile ? get_transient( self::key( $mobile ) ) : null;
		if ( ! is_array( $state ) || empty( $state['hash'] ) || $state['exp'] < time() ) {
			return self::err( 'کد منقضی شده. کد جدید بگیرید.' );
		}
		if ( ! hash_equals( $state['hash'], wp_hash( 'app|' . $mobile . '|' . $code ) ) ) {
			++$state['tries'];
			if ( $state['tries'] >= MP_Auth::MAX_TRIES ) {
				$state['hash'] = '';
			}
			set_transient( self::key( $mobile ), $state, HOUR_IN_SECONDS );
			return self::err( $state['hash'] ? 'کد درست نیست.' : 'کد چند بار اشتباه وارد شد. کد جدید بگیرید.' );
		}
		$state['hash'] = '';
		set_transient( self::key( $mobile ), $state, HOUR_IN_SECONDS );
		$uid      = self::staff( $mobile );
		$contacts = self::contacts( $mobile );
		if ( ! $uid && ! $contacts ) {
			return self::err( 'این شماره دیگر در پنل یا پرتالی ثبت نیست.', 403 );
		}
		if ( $uid ) {
			wp_set_current_user( $uid );
			wp_set_auth_cookie( $uid, true, is_ssl() );
			do_action( 'wp_login', get_userdata( $uid )->user_login, get_userdata( $uid ) );
			MP_Audit::log( 'login', 'user', $uid, 'ورود از اپ اندروید' );
		}
		foreach ( $contacts as $c ) {
			$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'channels' ) . ' WHERE id = %d', $c->channel_id ) );
			if ( $ch ) {
				MP_Client::start_session( $ch, $c );
			}
		}
		return array( 'ok' => true, 'kind' => $uid ? ( $contacts ? 'both' : 'staff' ) : 'client', 'redirect' => self::url() );
	}

	/** Client portals this browser is signed in to: [channel, contact]. */
	public static function portals() {
		global $wpdb;
		$out = array();
		foreach ( array_keys( $_COOKIE ) as $k ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			if ( ! preg_match( '/^mp_cl_(\d+)$/', $k, $m ) ) {
				continue;
			}
			$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'channels' ) . " WHERE id = %d AND type = 'client' AND archived_at IS NULL", (int) $m[1] ) );
			$c  = $ch ? MP_Client::signed_in( $ch ) : null;
			if ( $c ) {
				$out[] = array( $ch, $c );
			}
		}
		return $out;
	}

	/** /mp-app/ — sends the app to the right place, or shows the shared login. */
	public static function render() {
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		$staff   = is_user_logged_in() && current_user_can( 'mp_access_panel' );
		$portals = self::portals();
		$choose  = isset( $_GET['choose'] ); // phpcs:ignore WordPress.Security.NonceVerification
		if ( $staff && ( ! $portals || ! $choose ) ) {
			wp_safe_redirect( MP_Frontend::panel_url() );
			exit;
		}
		if ( ! $staff && 1 === count( $portals ) ) {
			wp_safe_redirect( MP_Client::url( $portals[0][0]->token ) );
			exit;
		}
		if ( $portals ) {
			self::chooser( $staff, $portals );
			exit;
		}
		$mp_app = true;
		include MP_DIR . 'templates/login.php';
		exit;
	}

	/** Signed in to several portals (or staff and a portal): pick one. */
	private static function chooser( $staff, $portals ) {
		?><!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e0e10"><meta name="robots" content="noindex,nofollow"><title>MORABA | انتخاب</title>
<link rel="stylesheet" href="<?php echo esc_url( MP_Frontend::asset( 'css/app.css' ) ); ?>"></head>
<body class="mp-gate mp-login"><main class="login-card">
<img src="<?php echo esc_url( MP_Frontend::asset( 'img/logo-light.png' ) ); ?>" alt="MORABA" class="login-logo">
<h1>کجا برویم؟</h1><p class="login-sub">با این شماره به چند جا دسترسی دارید.</p>
<div class="app-choose">
<?php if ( $staff ) : ?>
	<a class="login-alt" href="<?php echo esc_url( MP_Frontend::panel_url() ); ?>"><span>پنل کارمندان</span></a>
<?php endif; ?>
<?php foreach ( $portals as $p ) : ?>
	<a class="login-alt" href="<?php echo esc_url( MP_Client::url( $p[0]->token ) ); ?>"><span><?php echo esc_html( $p[0]->client_name ? $p[0]->client_name . ' · ' . $p[0]->title : $p[0]->title ); ?></span></a>
<?php endforeach; ?>
</div></main></body></html>
		<?php
	}

	/** ?mp_client_feed=1 — the newest message from the team in this client's portals (for the app's notifications). */
	public static function client_feed() {
		global $wpdb;
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		$best = null;
		foreach ( self::portals() as $p ) {
			$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'messages' ) . ' WHERE channel_id = %d AND deleted_at IS NULL AND (user_id > 0 OR kind <> %s) ORDER BY id DESC LIMIT 1', $p[0]->id, '' ) );
			if ( $m && ( ! $best || (int) $m->id > (int) $best[0]->id ) ) {
				$best = array( $m, $p[0] );
			}
		}
		if ( ! $best ) {
			exit( wp_json_encode( array( 'id' => 0 ) ) );
		}
		list( $m, $ch ) = $best;
		$u = $m->user_id ? get_userdata( $m->user_id ) : null;
		echo wp_json_encode(
			array(
				'id'    => (int) $m->id,
				'title' => ( $u ? $u->display_name : 'تیم مربع' ) . ' · ' . ( $ch->client_name ? $ch->client_name : $ch->title ),
				'body'  => MP_Jalali::digits( MP_Chat::snippet( $m ) ),
				'url'   => MP_Client::url( $ch->token ) . '#chat',
			),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
		);
		exit;
	}
}

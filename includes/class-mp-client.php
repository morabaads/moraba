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
			array( 'clients', 'GET', 'index', $auth ),
			array( 'customers', 'GET', 'customers', $auth ),
			array( 'customers', 'POST', 'save_customer', $auth ),
			array( "customers/$id", 'POST', 'save_customer', $auth ),
			array( "customers/$id", 'DELETE', 'archive_customer', array( 'MP_Rest', 'can_manage' ) ),
			array( 'portal-brand', 'GET', 'get_brand', $auth ),
			array( 'portal-brand', 'POST', 'save_brand', array( 'MP_Rest', 'can_manage' ) ),
			array( "channels/$id/client/preview", 'POST', 'start_preview', $auth ),
			array( "channels/$id/staff", 'POST', 'save_staff', $auth ),
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

	/* ------------------------------------------------------------------ System messages */

	/**
	 * Posts a system line (new design, delivered file, invoice…) in client groups: the given one, or
	 * every open client group of the project. $meta: {t: design|file|invoice, id, url?}.
	 */
	public static function system( $channel_id, $project_id, $body, $meta = array() ) {
		global $wpdb;
		$ids = $channel_id ? array( (int) $channel_id ) : ( $project_id ? array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", (int) $project_id ) ) ) : array() );
		foreach ( $ids as $id ) {
			$wpdb->insert(
				self::t( 'messages' ),
				array(
					'channel_id' => $id,
					'user_id'    => 0,
					'guest_name' => '',
					'body'       => MP_Util::long_text( $body, 1000 ),
					'kind'       => 'system',
					'meta'       => $meta ? substr( wp_json_encode( $meta ), 0, 255 ) : '',
					'created_at' => MP_Util::now(),
				)
			);
		}
		return count( $ids );
	}

	/** kind/meta of a message row for the payloads. */
	public static function msg_extra( $m ) {
		$meta = ! empty( $m->meta ) ? json_decode( $m->meta, true ) : null;
		return array( 'kind' => isset( $m->kind ) ? (string) $m->kind : '', 'meta' => is_array( $meta ) ? $meta : null );
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
		$s = self::real_session( $ch );
		if ( $s ) {
			return $s;
		}
		$p = self::preview( $ch );
		if ( ! $p ) {
			return null;
		}
		return $p['contact'] ? $p['contact'] : (object) array( 'id' => 0, 'channel_id' => (int) $ch->id, 'name' => 'مشتری', 'mobile' => '' );
	}

	/** True when this browser sees the portal through a staff «دیدن مثل مشتری» (view only). */
	public static function is_preview( $ch ) {
		return ! self::real_session( $ch ) && (bool) self::preview( $ch );
	}

	private static function preview_cookie( $ch ) {
		return 'mp_clp_' . (int) $ch->id;
	}

	/** @return array{uid:int,contact:?object}|null A valid staff preview of this group, if any. */
	private static function preview( $ch ) {
		global $wpdb;
		$c = isset( $_COOKIE[ self::preview_cookie( $ch ) ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::preview_cookie( $ch ) ] ) ) : '';
		$p = explode( '|', $c );
		if ( 4 !== count( $p ) || (int) $p[2] < time() || ! hash_equals( self::sign( 'pv|' . $ch->id . '|' . $p[0] . '|' . $p[1] . '|' . $p[2] . '|' . $ch->token ), $p[3] ) ) {
			return null;
		}
		$contact = (int) $p[1] ? $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d AND channel_id = %d', (int) $p[1], $ch->id ) ) : null;
		return array( 'uid' => (int) $p[0], 'contact' => $contact );
	}

	/** Logged-in client contact for this group (their own mobile + code login), or null. */
	private static function real_session( $ch ) {
		global $wpdb;
		$c = isset( $_COOKIE[ self::cookie_name( $ch ) ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::cookie_name( $ch ) ] ) ) : '';
		$p = explode( '|', $c );
		if ( 3 !== count( $p ) || (int) $p[1] < time() || ! hash_equals( self::sign( $ch->id . '|' . $p[0] . '|' . $p[1] . '|' . $ch->token ), $p[2] ) ) {
			return null;
		}
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d AND channel_id = %d', (int) $p[0], $ch->id ) );
	}

	/**
	 * Every client link needs a mobile + one-time code login whenever the SMS service works; only
	 * numbers saved for that group get in. Without SMS nobody could log in, so the old per-group
	 * switch decides then.
	 */
	public static function login_required( $ch ) {
		return MP_Auth::otp_enabled() || ! empty( $ch->auth_required );
	}

	/** WP_Error when the group needs a login and there is none; null when the client may continue. */
	public static function gate( $ch ) {
		if ( ! $ch ) {
			return self::err( 'این لینک معتبر نیست.', 404 );
		}
		if ( self::login_required( $ch ) && ! self::session( $ch ) ) {
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
		$s  = self::session( $ch );
		$pv = $s && self::is_preview( $ch );
		return array(
			'title'         => $ch->title,
			'client'        => $ch->client_name,
			'team'          => self::brand()['name'],
			'preview'       => $pv,
			'logo'          => self::logo_url( $ch ),
			'auth_required' => self::login_required( $ch ),
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
		self::start_session( $ch, $contact );
		return array( 'logged_in' => true, 'name' => $contact->name );
	}

	/** Signs this browser in as the client contact (portal login, or the Android app's shared login). */
	public static function start_session( $ch, $contact ) {
		global $wpdb;
		$exp = time() + self::COOKIE_DAYS * DAY_IN_SECONDS;
		$val = $contact->id . '|' . $exp . '|' . self::sign( $ch->id . '|' . $contact->id . '|' . $exp . '|' . $ch->token );
		setcookie( self::cookie_name( $ch ), $val, array( 'expires' => $exp, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
		$_COOKIE[ self::cookie_name( $ch ) ] = $val;
		$wpdb->update( self::t( 'client_contacts' ), array( 'last_login' => MP_Util::now() ), array( 'id' => $contact->id ) );
	}

	/** The client contact signed in to this group in this browser (not a staff preview), or null. */
	public static function signed_in( $ch ) {
		return self::real_session( $ch );
	}

	public static function logout( WP_REST_Request $r ) {
		$ch = self::channel( $r['token'] );
		if ( $ch ) {
			foreach ( array( self::cookie_name( $ch ), self::preview_cookie( $ch ) ) as $name ) {
				setcookie( $name, '', array( 'expires' => time() - 3600, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
			}
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
			'project_id'    => (int) $ch->project_id,
			'project'       => $ch->project_id ? (string) $GLOBALS['wpdb']->get_var( $GLOBALS['wpdb']->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $ch->project_id ) ) : '',
			'auth_required' => self::login_required( $ch ),
			'sms'           => MP_Auth::otp_enabled(),
			'contacts'      => self::contacts( $ch->id ),
			'staff'         => self::staff_payload( $ch ),
			'can_staff'     => MP_Util::is_manager() || (int) $ch->created_by === get_current_user_id(),
			'manager'       => MP_Util::is_manager(),
		);
	}

	/* ------------------------------------------------------------------ Customers */

	public static function customer( $id ) {
		global $wpdb;
		return $id ? $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'clients' ) . ' WHERE id = %d AND archived_at IS NULL', (int) $id ) ) : null;
	}

	/** Project ids of a customer. */
	public static function customer_projects( $id ) {
		global $wpdb;
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT project_id FROM ' . self::t( 'client_projects' ) . ' WHERE client_id = %d', (int) $id ) ) );
	}

	/**
	 * The customer to use: the given id, else the one with this name, else a new one. The project
	 * (if any) is added to the customer's projects. Returns the id (0 without a name).
	 */
	public static function customer_id( $name, $id = 0, $project_id = 0, $phone = '', $info = '' ) {
		global $wpdb;
		$c = self::customer( $id );
		if ( ! $c ) {
			$name = MP_Util::text( $name, 160 );
			if ( '' === $name ) {
				return 0;
			}
			$c = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'clients' ) . ' WHERE name = %s AND archived_at IS NULL ORDER BY id LIMIT 1', $name ) );
			if ( ! $c ) {
				$wpdb->insert( self::t( 'clients' ), array( 'name' => $name, 'phone' => MP_Util::text( $phone, 40 ), 'info' => MP_Util::long_text( $info, 1000 ), 'created_by' => get_current_user_id(), 'created_at' => MP_Util::now() ) );
				$c = self::customer( (int) $wpdb->insert_id );
			} elseif ( '' === $c->phone && '' !== trim( (string) $phone ) ) {
				$wpdb->update( self::t( 'clients' ), array( 'phone' => MP_Util::text( $phone, 40 ) ), array( 'id' => $c->id ) );
			}
		}
		if ( $c && $project_id ) {
			$wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . self::t( 'client_projects' ) . ' (client_id, project_id) VALUES (%d, %d)', $c->id, (int) $project_id ) ); // phpcs:ignore
		}
		return $c ? (int) $c->id : 0;
	}

	/** Once: customers from the names already used on client groups and invoices. */
	public static function migrate_customers() {
		global $wpdb;
		foreach ( $wpdb->get_results( 'SELECT id, client_name, project_id FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND client_id = 0 AND client_name <> ''" ) as $ch ) {
			$wpdb->update( self::t( 'channels' ), array( 'client_id' => self::customer_id( $ch->client_name, 0, (int) $ch->project_id ) ), array( 'id' => $ch->id ) );
		}
		foreach ( $wpdb->get_results( 'SELECT id, client_name, client_phone, client_info, project_id FROM ' . self::t( 'invoices' ) . " WHERE client_id = 0 AND client_name <> ''" ) as $x ) {
			$wpdb->update( self::t( 'invoices' ), array( 'client_id' => self::customer_id( $x->client_name, 0, (int) $x->project_id, $x->client_phone, (string) $x->client_info ) ), array( 'id' => $x->id ) );
		}
	}

	private static function customer_payload( $c ) {
		return array(
			'id'       => (int) $c->id,
			'name'     => $c->name,
			'phone'    => $c->phone,
			'info'     => (string) $c->info,
			'projects' => self::customer_projects( $c->id ),
		);
	}

	/** GET customers — for pickers (invoice editor, new client group). */
	public static function customers() {
		global $wpdb;
		return array_map( array( __CLASS__, 'customer_payload' ), $wpdb->get_results( 'SELECT * FROM ' . self::t( 'clients' ) . ' WHERE archived_at IS NULL ORDER BY name' ) );
	}

	/** POST customers[/id] {name, phone, info, project_ids[]} */
	public static function save_customer( WP_REST_Request $r ) {
		global $wpdb;
		$id   = (int) $r['id'];
		$name = MP_Util::text( $r['name'], 160 );
		if ( '' === $name ) {
			return self::err( 'نام مشتری را وارد کنید.' );
		}
		if ( $id && ! self::customer( $id ) ) {
			return self::err( 'مشتری پیدا نشد.', 404 );
		}
		$row = array( 'name' => $name, 'phone' => MP_Util::text( $r['phone'], 40 ), 'info' => MP_Util::long_text( $r['info'], 1000 ) );
		if ( $id ) {
			$wpdb->update( self::t( 'clients' ), $row, array( 'id' => $id ) );
			// Its client groups keep showing the same name.
			$wpdb->update( self::t( 'channels' ), array( 'client_name' => MP_Util::text( $name, 120 ) ), array( 'client_id' => $id ) );
		} else {
			$wpdb->insert( self::t( 'clients' ), $row + array( 'created_by' => get_current_user_id(), 'created_at' => MP_Util::now() ) );
			$id = (int) $wpdb->insert_id;
		}
		if ( is_array( $r['project_ids'] ) ) {
			$keep = array();
			foreach ( $r['project_ids'] as $pid ) {
				$pid = (int) $pid;
				if ( $pid && MP_Util::can_see_project( $pid ) ) {
					$keep[] = $pid;
				}
			}
			// Only projects this user can see are touched; others stay as they were.
			foreach ( self::customer_projects( $id ) as $pid ) {
				if ( ! in_array( $pid, $keep, true ) && MP_Util::can_see_project( $pid ) ) {
					$wpdb->delete( self::t( 'client_projects' ), array( 'client_id' => $id, 'project_id' => $pid ) );
				}
			}
			foreach ( $keep as $pid ) {
				self::customer_id( '', $id, $pid );
			}
		}
		MP_Audit::log( $r['id'] ? 'update' : 'create', 'client', $id, $name );
		// With a mobile, the customer can always open a portal: they join the client group of each chosen
		// project (made if missing) and every client group they already have; with none at all, a group of
		// their own (no project) is made. Each new membership texts them that group's link; groups they are
		// already in are left alone (no repeated SMS).
		$portal = array();
		$mobile = MP_Auth::normalize( $r['phone'] );
		if ( $mobile ) {
			$cust   = self::customer( $id );
			$groups = array();
			foreach ( isset( $keep ) ? $keep : array() as $pid ) {
				$ch = self::group_for( $cust, $pid );
				if ( $ch ) {
					$groups[ (int) $ch->id ] = $ch;
				}
			}
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND client_id = %d AND archived_at IS NULL ORDER BY id", $id ) ) as $ch ) {
				$groups[ (int) $ch->id ] = $ch;
			}
			// Existing client groups picked in the form: the customer joins them too (a group with no customer becomes theirs).
			foreach ( is_array( $r['group_ids'] ) ? $r['group_ids'] : array() as $gid ) {
				$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE id = %d AND type = 'client' AND archived_at IS NULL", (int) $gid ) );
				if ( ! $ch || ! MP_Rest::can_read_channel( $ch->id ) ) {
					continue;
				}
				if ( ! (int) $ch->client_id ) {
					$wpdb->update( self::t( 'channels' ), array( 'client_id' => $id ), array( 'id' => $ch->id ) );
				}
				$groups[ (int) $ch->id ] = $ch;
			}
			if ( ! $groups ) {
				$ch = self::group_for( $cust, 0 );
				if ( $ch ) {
					$groups[ (int) $ch->id ] = $ch;
				}
			}
			foreach ( $groups as $ch ) {
				$res = self::add_person( $ch, $cust->name, $mobile );
				if ( $res['added'] ) {
					$portal[] = array( 'group' => $ch->title, 'project' => $ch->project_id ? (string) $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $ch->project_id ) ) : '', 'sms' => $res['sms'], 'error' => $res['error'] );
				}
			}
		}
		return self::customer_payload( self::customer( $id ) ) + array( 'portal' => $portal, 'mobile_ok' => (bool) $mobile || '' === trim( (string) $r['phone'] ) );
	}

	/** DELETE customers/{id} — archive (groups and invoices stay). */
	public static function archive_customer( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::customer( (int) $r['id'] );
		if ( ! $c ) {
			return self::err( 'مشتری پیدا نشد.', 404 );
		}
		$wpdb->update( self::t( 'clients' ), array( 'archived_at' => MP_Util::now() ), array( 'id' => $c->id ) );
		// Their client groups go to the archive with them: the portal links stop and everyone logged in is out.
		// Messages and invoices stay; a group can be brought back from «گروه‌های آرشیو‌شده».
		$groups = (int) $wpdb->query( $wpdb->prepare( 'UPDATE ' . self::t( 'channels' ) . " SET archived_at = %s WHERE type = 'client' AND client_id = %d AND archived_at IS NULL", MP_Util::now(), $c->id ) ); // phpcs:ignore
		MP_Audit::log( 'archive', 'client', $c->id, $c->name . ( $groups ? ' (با ' . MP_Jalali::digits( $groups ) . ' گروه و لینک پرتال)' : '' ) );
		return array( 'archived' => true, 'groups' => $groups );
	}

	/** One client group for the «مشتریان» page. */
	private static function group_summary( $ch, $uid ) {
		global $wpdb;
		$last   = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'messages' ) . ' WHERE channel_id = %d AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', $ch->id ) );
		$read   = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT last_id FROM ' . self::t( 'reads' ) . ' WHERE channel_id = %d AND user_id = %d', $ch->id, $uid ) );
		$unread = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'messages' ) . " WHERE channel_id = %d AND id > %d AND user_id = 0 AND kind = '' AND deleted_at IS NULL", $ch->id, $read ) );
		$lu     = $last && $last->user_id ? get_userdata( $last->user_id ) : null;
		return array(
			'id'         => (int) $ch->id,
			'title'      => $ch->title,
			'client'     => $ch->client_name,
			'project_id' => (int) $ch->project_id,
			'logo'       => self::logo_url( $ch ),
			'url'        => self::url( $ch->token ),
			'token'      => $ch->token,
			'auth'       => self::login_required( $ch ),
			'contacts'   => self::contacts( $ch->id ),
			'unread'     => $unread,
			'waiting'    => (bool) ( $last && ! $last->user_id && '' === (string) $last->kind ), // last word is the client's
			'last'       => $last ? array(
				'body'   => $last->body ? wp_trim_words( $last->body, 16 ) : ( $last->file_id ? '📎 فایل' : '' ),
				'author' => $lu ? $lu->display_name : ( '' !== (string) $last->kind ? 'مربع استودیو' : ( $last->guest_name ? $last->guest_name : $ch->client_name ) ),
				'client' => ! $last->user_id && '' === (string) $last->kind,
				'at'     => $last->created_at,
			) : null,
		);
	}

	public static function project_summary( $pid ) {
		global $wpdb;
		$p = $wpdb->get_row( $wpdb->prepare( 'SELECT id, name, status, end_date FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $pid ) );
		if ( ! $p ) {
			return null;
		}
		$c = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) total, SUM(status = 'done') done FROM " . self::t( 'tasks' ) . ' WHERE project_id = %d AND archived_at IS NULL AND client_hidden = 0', $pid ) );
		return array(
			'id'       => (int) $p->id,
			'name'     => $p->name,
			'status'   => $p->status,
			'end'      => $p->end_date,
			'progress' => $c && $c->total ? (int) round( $c->done / $c->total * 100 ) : ( 'done' === $p->status ? 100 : 0 ),
			'designs'  => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'client_items' ) . " WHERE project_id = %d AND kind = 'design' AND status = 'pending' AND archived_at IS NULL", $pid ) ),
			'changes'  => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'client_items' ) . " WHERE project_id = %d AND kind = 'design' AND status = 'changes' AND archived_at IS NULL", $pid ) ),
		);
	}

	/**
	 * GET clients — the «مشتریان» page: every customer with their projects (progress, designs waiting),
	 * client groups (people, last message, replies waiting) and, for managers, unpaid invoices.
	 */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		self::migrate_customers(); // groups made before customers existed
		$uid     = get_current_user_id();
		$manager = MP_Util::is_manager();
		$groups  = array();
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND archived_at IS NULL ORDER BY id DESC" ) as $ch ) {
			if ( MP_Rest::can_read_channel( $ch->id ) ) {
				$groups[ (int) $ch->client_id ][] = self::group_summary( $ch, $uid );
			}
		}
		$out = array();
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'clients' ) . ' WHERE archived_at IS NULL ORDER BY id DESC' ) as $c ) {
			$projects = array();
			foreach ( self::customer_projects( $c->id ) as $pid ) {
				if ( MP_Util::can_see_project( $pid ) ) {
					$ps = self::project_summary( $pid );
					if ( $ps ) {
						$projects[] = $ps;
					}
				}
			}
			$mine = isset( $groups[ (int) $c->id ] ) ? $groups[ (int) $c->id ] : array();
			if ( ! $manager && ! $mine && ! $projects ) {
				continue; // someone else's customer
			}
			$unpaid = 0;
			$due    = 0;
			if ( $manager ) {
				foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'invoices' ) . " WHERE client_id = %d AND kind = 'invoice' AND status = 'sent' AND archived_at IS NULL", $c->id ) ) as $x ) {
					++$unpaid;
					$due += MP_Invoices::payload( $x )['total'];
				}
			}
			$logo = '';
			foreach ( $mine as $g ) {
				if ( $g['logo'] ) {
					$logo = $g['logo'];
					break;
				}
			}
			$out[] = self::customer_payload( $c ) + array(
				'logo'         => $logo,
				'project_list' => $projects,
				'groups'       => $mine,
				'unpaid'       => $unpaid,
				'due'          => $due,
				'created_at'   => $c->created_at,
			);
		}
		return array( 'clients' => $out, 'manager' => $manager );
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
		if ( null !== $r['project_id'] ) {
			// Which project this client group (and its portal) belongs to; 0 = chat only, no portal.
			$pid = (int) $r['project_id'];
			if ( $pid && ! MP_Util::can_see_project( $pid ) ) {
				return self::err( 'به این پروژه دسترسی ندارید.', 403 );
			}
			$f['project_id'] = $pid;
			if ( $pid && $ch->client_id ) {
				self::customer_id( '', (int) $ch->client_id, $pid );
			}
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

	/**
	 * POST channels/{id}/client/preview {contact_id?} — this browser sees the portal as that client person
	 * (or as a client in general) for two hours. View only: sending, comments and decisions are refused.
	 */
	public static function start_preview( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::team_channel( $r['id'] );
		if ( ! $ch || $ch->archived_at ) {
			return self::err( 'گروه مشتری پیدا نشد.', 404 );
		}
		$cid = (int) $r['contact_id'];
		if ( $cid && ! $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'client_contacts' ) . ' WHERE id = %d AND channel_id = %d', $cid, $ch->id ) ) ) {
			$cid = 0;
		}
		$uid = get_current_user_id();
		$exp = time() + 2 * HOUR_IN_SECONDS;
		$val = $uid . '|' . $cid . '|' . $exp . '|' . self::sign( 'pv|' . $ch->id . '|' . $uid . '|' . $cid . '|' . $exp . '|' . $ch->token );
		// A real client login in this browser would win over the preview; it is cleared first.
		setcookie( self::cookie_name( $ch ), '', array( 'expires' => time() - 3600, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
		setcookie( self::preview_cookie( $ch ), $val, array( 'expires' => $exp, 'path' => COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax' ) );
		MP_Audit::log( 'view', 'channel', $ch->id, 'دیدن پرتال «' . $ch->title . '» مثل مشتری' );
		return array( 'url' => self::url( $ch->token ) );
	}

	/** Panel people who always see a client group: the project's members (or its maker when it has none). */
	private static function base_staff( $ch ) {
		return $ch->project_id ? MP_Util::project_members( $ch->project_id ) : array( (int) $ch->created_by );
	}

	/** Colleagues added to a client group on top of the project's members. */
	public static function extra_staff( $channel_id ) {
		global $wpdb;
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . self::t( 'channel_members' ) . ' WHERE channel_id = %d', (int) $channel_id ) ) );
	}

	private static function staff_payload( $ch ) {
		$base = self::base_staff( $ch );
		$out  = array();
		foreach ( array_unique( array_merge( $base, self::extra_staff( $ch->id ) ) ) as $u ) {
			$user = get_userdata( $u );
			if ( $user ) {
				$out[] = array( 'id' => (int) $u, 'name' => $user->display_name, 'fixed' => in_array( (int) $u, $base, true ) );
			}
		}
		return $out;
	}

	/** POST channels/{id}/staff {user_ids[]} — colleagues of this client group besides the project's members. */
	public static function save_staff( WP_REST_Request $r ) {
		global $wpdb;
		$ch = self::team_channel( $r['id'] );
		if ( ! $ch ) {
			return self::err( 'گروه مشتری پیدا نشد.', 404 );
		}
		if ( ! MP_Util::is_manager() && (int) $ch->created_by !== get_current_user_id() ) {
			return self::err( 'فقط ناظر یا سازنده گروه می‌تواند همکار اضافه کند.', 403 );
		}
		$base = self::base_staff( $ch );
		$want = array();
		foreach ( is_array( $r['user_ids'] ) ? $r['user_ids'] : array() as $u ) {
			$u = (int) $u;
			if ( MP_Util::is_panel_user( $u ) && ! in_array( $u, $base, true ) ) {
				$want[] = $u;
			}
		}
		$old = self::extra_staff( $ch->id );
		foreach ( array_diff( $old, $want ) as $u ) {
			$wpdb->delete( self::t( 'channel_members' ), array( 'channel_id' => $ch->id, 'user_id' => $u ) );
		}
		foreach ( array_diff( array_unique( $want ), $old ) as $u ) {
			$wpdb->insert( self::t( 'channel_members' ), array( 'channel_id' => $ch->id, 'user_id' => $u ) );
			if ( $u !== get_current_user_id() ) {
				MP_Notify::event( 'group_added', $u, array( 'GROUP' => $ch->title ), 'messages', $ch->id );
			}
			MP_Audit::log( 'add', 'member', $ch->id, get_userdata( $u )->display_name . ' به گروه مشتری «' . $ch->title . '»' );
		}
		return self::settings_payload( $ch );
	}

	/* ------------------------------------------------------------------ Studio look of the portals */

	const BRAND = 'mp_portal_brand';

	/** Logo, square icon and team name shown in every client portal (defaults: Moraba's own). */
	public static function brand() {
		$b   = get_option( self::BRAND, array() );
		$b   = is_array( $b ) ? $b : array();
		$url = function ( $fid ) {
			$p = $fid ? MP_Files::payload( MP_Files::get( (int) $fid ) ) : null;
			return $p ? $p['url'] : '';
		};
		$logo = $url( isset( $b['logo'] ) ? $b['logo'] : 0 );
		$icon = $url( isset( $b['icon'] ) ? $b['icon'] : 0 );
		return array(
			'name'        => ! empty( $b['name'] ) ? (string) $b['name'] : 'تیم مربع استودیو',
			'logo'        => $logo ? $logo : MP_URL . 'assets/img/logo.png',
			'icon'        => $icon ? $icon : MP_URL . 'assets/img/symbol.png',
			'logo_id'     => $logo ? (int) $b['logo'] : 0,
			'icon_id'     => $icon ? (int) $b['icon'] : 0,
			'custom_logo' => (bool) $logo,
		);
	}

	public static function get_brand() {
		return self::brand();
	}

	/** POST portal-brand {name?, logo_file_id?, icon_file_id?} — 0 brings back the default. */
	public static function save_brand( WP_REST_Request $r ) {
		$b = get_option( self::BRAND, array() );
		$b = is_array( $b ) ? $b : array();
		if ( null !== $r['name'] ) {
			$b['name'] = MP_Util::text( $r['name'], 60 );
		}
		foreach ( array( 'logo' => 'logo_file_id', 'icon' => 'icon_file_id' ) as $k => $in ) {
			if ( null === $r[ $in ] ) {
				continue;
			}
			$fid = (int) $r[ $in ];
			$f   = $fid ? MP_Files::get( $fid ) : null;
			if ( $fid && ( ! $f || 'client_logo' !== $f->context || 0 !== strpos( $f->mime, 'image/' ) ) ) {
				return self::err( 'فایل تصویر معتبر نیست.' );
			}
			$b[ $k ] = $fid;
		}
		update_option( self::BRAND, $b, false );
		MP_Audit::log( 'update', 'channel', 0, 'ظاهر استودیو در پرتال مشتری' );
		return self::brand();
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
		// The link goes by SMS unless the box was unticked.
		$res = self::add_person( $ch, $name, $mobile, null === $r['sms'] || ( ! empty( $r['sms'] ) && 'false' !== $r['sms'] ) );
		return self::settings_payload( $ch ) + array( 'sms_sent' => $res['sms'], 'sms_error' => $res['error'] );
	}

	/**
	 * Puts a person into a client group (they can then log into its portal with their mobile) and texts
	 * them the group's link. Someone already in the group is left alone and not texted again.
	 * @return array{added:bool, sms:?bool, error:string} sms: null = not sent (off / already there).
	 */
	public static function add_person( $ch, $name, $mobile, $sms = true ) {
		global $wpdb;
		if ( $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'client_contacts' ) . ' WHERE channel_id = %d AND mobile = %s', $ch->id, $mobile ) ) ) {
			return array( 'added' => false, 'sms' => null, 'error' => '' );
		}
		$wpdb->insert( self::t( 'client_contacts' ), array( 'channel_id' => $ch->id, 'name' => $name, 'mobile' => $mobile, 'created_at' => MP_Util::now() ) );
		// Everyone in the conversation sees who joined.
		self::system( $ch->id, 0, $name . ' به گفت‌وگو اضافه شد.', array( 't' => 'join' ) );
		MP_Audit::log( 'add', 'member', $ch->id, $name . ' به گروه مشتری «' . $ch->title . '»' );
		if ( ! $sms ) {
			return array( 'added' => true, 'sms' => null, 'error' => '' );
		}
		if ( ! MP_Auth::otp_enabled() ) {
			return array( 'added' => true, 'sms' => false, 'error' => 'سرویس پیامک در تنظیمات افزونه روشن نیست.' );
		}
		$ok = self::send_link( $ch, $mobile, $name );
		return array( 'added' => true, 'sms' => $ok, 'error' => $ok ? '' : MP_Messages::$last_error );
	}

	/** The customer's client group for a project; made when there is none yet. */
	public static function group_for( $customer, $project_id ) {
		global $wpdb;
		$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND client_id = %d AND project_id = %d AND archived_at IS NULL ORDER BY id LIMIT 1", $customer->id, $project_id ) );
		if ( $ch ) {
			return $ch;
		}
		$wpdb->insert(
			self::t( 'channels' ),
			array(
				'type'        => 'client',
				'project_id'  => (int) $project_id,
				'title'       => MP_Util::text( $customer->name, 160 ),
				'client_name' => MP_Util::text( $customer->name, 120 ),
				'client_id'   => (int) $customer->id,
				'token'       => wp_generate_password( 32, false, false ),
				'created_by'  => get_current_user_id(),
				'created_at'  => MP_Util::now(),
			)
		);
		$id = (int) $wpdb->insert_id; // read before the audit log's own insert replaces it
		MP_Audit::log( 'create', 'channel', $id, 'گروه مشتری «' . $customer->name . '» (خودکار)' );
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . ' WHERE id = %d', $id ) );
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
		return MP_Messages::send_sms( 'portal_link', $mobile, array( 'NAME' => $name, 'GROUP' => $ch->title, 'LINK' => self::url( $ch->token ) ) );
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

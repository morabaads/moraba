<?php
defined( 'ABSPATH' ) || exit;

/**
 * Contracts: templates with {variables}, filled per project and customer, printed on a styled
 * A4 page (print / save as PDF) and signed online by the client.
 *
 * - A template is plain text: «## » article, «### » sub-heading, «- » item, «> » note (تبصره),
 *   anything in {braces} is a variable. The variables of a contract are found in its text, so a
 *   new template only needs braces around what changes.
 * - A contract keeps its own copy of the text: editing a template never changes a sent contract.
 * - Sending applies the studio's signature and posts a card in the client chat (and optionally SMS).
 * - The client signs on /k/{token}/: reads, agrees, draws a signature and confirms with a code sent
 *   to their mobile. Time, IP, device and a fingerprint (SHA-256) of the exact text are stored; a
 *   signed contract can no longer be edited, and the page shows whether the text still matches.
 */
class MP_Contracts {

	const SETTINGS = 'mp_contract_settings';
	/** Filled by the system from the settings and the contract itself; never asked for. */
	const SYSTEM_VARS = array( 'نام استودیو', 'نشانی استودیو', 'شماره قرارداد', 'تاریخ قرارداد', 'نام پروژه' );
	const STATUS   = array( 'draft' => 'پیش‌نویس', 'sent' => 'منتظر امضای مشتری', 'signed' => 'امضاشده', 'cancelled' => 'لغوشده' );

	public static function register() {
		$m  = array( 'MP_Rest', 'can_manage' );
		$id = '(?P<id>\d+)';
		$routes = array(
			array( 'contracts', 'GET', 'index', $m ),
			array( 'contracts', 'POST', 'save', $m ),
			array( "contracts/$id", 'POST', 'save', $m ),
			array( "contracts/$id", 'DELETE', 'archive', $m ),
			array( "contracts/$id/send", 'POST', 'send', $m ),
			array( "contracts/$id/status", 'POST', 'set_status', $m ),
			array( "contracts/$id/duplicate", 'POST', 'duplicate', $m ),
			array( 'contracts/settings', 'POST', 'save_settings', $m ),
			array( 'contract-templates', 'POST', 'save_template', $m ),
			array( "contract-templates/$id", 'POST', 'save_template', $m ),
			array( "contract-templates/$id", 'DELETE', 'delete_template', $m ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/code', 'POST', 'client_code', '__return_true' ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/sign', 'POST', 'client_sign', '__return_true' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $r[3] ) );
		}
	}

	private static function t( $n = 'contracts' ) {
		return MP_Install::table( $n );
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_error', $m, array( 'status' => $s ) );
	}

	/* ------------------------------------------------------------------ Settings & templates */

	public static function settings() {
		$s = get_option( self::SETTINGS, array() );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array(
				'studio'     => 'استودیو مربع',
				'agent'      => 'علی چهارمحالی زاده',
				'address'    => 'اهواز، سی‌متری، خیابان موسوی، نبش معمارزاده، پلاک ۲۰، طبقه ۳',
				'accent'     => '#f28a24',
				'style'      => 'modern',
				'logo'       => true,
				'footer'     => 'این قرارداد به صورت الکترونیکی تنظیم و امضا شده است.',
				'signature'  => '', // studio signature (PNG data URL)
				'otp'        => true,
			)
		);
	}

	public static function save_settings( WP_REST_Request $r ) {
		$old = self::settings();
		$sig = (string) $r['signature'];
		$s   = array(
			'studio'    => MP_Util::text( $r['studio'], 120 ),
			'agent'     => MP_Util::text( $r['agent'], 120 ),
			'address'   => MP_Util::text( $r['address'], 300 ),
			'accent'    => preg_match( '/^#[0-9a-fA-F]{6}$/', (string) $r['accent'] ) ? strtolower( $r['accent'] ) : '#f28a24',
			'style'     => MP_Util::pick( $r['style'], array( 'modern', 'classic', 'minimal' ), 'modern' ),
			'logo'      => ! empty( $r['logo'] ) && 'false' !== $r['logo'],
			'footer'    => MP_Util::text( $r['footer'], 300 ),
			'signature' => null === $r['signature'] ? $old['signature'] : ( self::valid_png( $sig ) ? $sig : '' ),
			'otp'       => ! empty( $r['otp'] ) && 'false' !== $r['otp'],
		);
		update_option( self::SETTINGS, $s, false );
		return self::settings();
	}

	private static function valid_png( $data ) {
		return is_string( $data ) && strlen( $data ) < 300000 && preg_match( '#^data:image/png;base64,[A-Za-z0-9+/=]+$#', $data );
	}

	public static function default_body() {
		return (string) file_get_contents( MP_DIR . 'includes/contract-default.txt' ); // phpcs:ignore
	}

	/** Templates; the built-in one (id 0) is always there. */
	private static function templates() {
		global $wpdb;
		$out = array( array( 'id' => 0, 'title' => 'قرارداد طراحی و توسعه وب‌سایت (پیش‌فرض)', 'body' => self::default_body(), 'builtin' => true ) );
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t( 'contract_templates' ) . ' ORDER BY id' ) as $t ) {
			$out[] = array( 'id' => (int) $t->id, 'title' => $t->title, 'body' => $t->body, 'builtin' => false );
		}
		return $out;
	}

	public static function save_template( WP_REST_Request $r ) {
		global $wpdb;
		$title = MP_Util::text( $r['title'], 160 );
		$body  = MP_Util::long_text( $r['body'], 60000 );
		if ( '' === $title || '' === trim( $body ) ) {
			return self::err( 'نام و متن قالب را وارد کنید.' );
		}
		$row = array( 'title' => $title, 'body' => $body, 'updated_at' => MP_Util::now() );
		if ( (int) $r['id'] ) {
			$wpdb->update( self::t( 'contract_templates' ), $row, array( 'id' => (int) $r['id'] ) );
		} else {
			$wpdb->insert( self::t( 'contract_templates' ), $row + array( 'created_at' => MP_Util::now() ) );
		}
		return self::templates();
	}

	public static function delete_template( WP_REST_Request $r ) {
		global $wpdb;
		$wpdb->delete( self::t( 'contract_templates' ), array( 'id' => (int) $r['id'] ) );
		return self::templates();
	}

	/* ------------------------------------------------------------------ Variables & rendering */

	/** Variable names in a text, in order of first use. */
	public static function variables( $body ) {
		preg_match_all( '/\{([^{}\n]{1,60})\}/u', (string) $body, $m );
		return array_values( array_unique( array_map( 'trim', $m[1] ) ) );
	}

	/** How a variable is typed and shown, from its name. */
	public static function kind( $name ) {
		if ( preg_match( '/مبلغ|هزینه|قیمت/u', $name ) ) {
			return 'money';
		}
		if ( preg_match( '/تاریخ/u', $name ) ) {
			return 'date';
		}
		if ( preg_match( '/کد ?ملی|شناسه ملی/u', $name ) ) {
			return 'national';
		}
		if ( preg_match( '/تماس|موبایل|تلفن/u', $name ) ) {
			return 'phone';
		}
		if ( preg_match( '/آدرس|نشانی|شرح|توضیح|دامنه/u', $name ) ) {
			return 'long';
		}
		return 'text';
	}

	/** Toman amount in Persian words: 45000000 → «چهل و پنج میلیون». */
	public static function words( $n ) {
		$n = (int) $n;
		if ( 0 === $n ) {
			return 'صفر';
		}
		$ones  = array( '', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه' );
		$teens = array( 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده' );
		$tens  = array( '', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود' );
		$hund  = array( '', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد' );
		$three = function ( $x ) use ( $ones, $teens, $tens, $hund ) {
			$p = array();
			if ( $x >= 100 ) {
				$p[] = $hund[ intdiv( $x, 100 ) ];
				$x  %= 100;
			}
			if ( $x >= 20 ) {
				$p[] = $tens[ intdiv( $x, 10 ) ];
				$x  %= 10;
			} elseif ( $x >= 10 ) {
				$p[] = $teens[ $x - 10 ];
				$x   = 0;
			}
			if ( $x ) {
				$p[] = $ones[ $x ];
			}
			return implode( ' و ', $p );
		};
		$units = array( '', ' هزار', ' میلیون', ' میلیارد', ' هزار میلیارد' );
		$parts = array();
		$i     = 0;
		while ( $n > 0 && $i < count( $units ) ) {
			$chunk = $n % 1000;
			if ( $chunk ) {
				array_unshift( $parts, 1 === $chunk && 1 === $i ? 'هزار' : $three( $chunk ) . $units[ $i ] );
			}
			$n = intdiv( $n, 1000 );
			++$i;
		}
		return implode( ' و ', $parts );
	}

	/** Value of a variable as printed on the contract. */
	private static function show( $name, $value ) {
		$value = trim( (string) $value );
		if ( '' === $value ) {
			return '';
		}
		$kind = self::kind( $name );
		if ( 'money' === $kind ) {
			$n = (int) preg_replace( '/\D/', '', J_latin( $value ) );
			return $n ? MP_Jalali::digits( number_format( $n ) ) . ' تومان (' . self::words( $n ) . ' تومان)' : $value;
		}
		if ( 'date' === $kind && preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return MP_Jalali::format( $value );
		}
		return MP_Jalali::digits( $value );
	}

	/** Variables filled by the system (never asked for). */
	private static function system_vars( $c ) {
		$s = self::settings();
		global $wpdb;
		$p = $c && $c->project_id ? $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $c->project_id ) ) : '';
		return array(
			'نام استودیو'    => $s['studio'],
			'نشانی استودیو'  => $s['address'],
			'شماره قرارداد'  => $c ? $c->number : '',
			'تاریخ قرارداد'  => $c ? MP_Jalali::format( substr( $c->created_at, 0, 10 ) ) : '',
			'نام پروژه'      => (string) $p,
		);
	}

	/** The contract text as HTML (escaped), variables filled; empty ones stay as a dotted blank. */
	public static function render_body( $body, $vars, $c = null ) {
		$vars = array_merge( is_array( $vars ) ? $vars : array(), array_filter( self::system_vars( $c ) ) );
		$fill = function ( $line ) use ( $vars ) {
			$html = esc_html( $line );
			return preg_replace_callback(
				'/\{([^{}\n]{1,60})\}/u',
				function ( $m ) use ( $vars ) {
					$name = trim( html_entity_decode( $m[1], ENT_QUOTES, 'UTF-8' ) );
					$v    = isset( $vars[ $name ] ) ? self::show( $name, $vars[ $name ] ) : '';
					return '' !== $v ? '<b class="v">' . esc_html( $v ) . '</b>' : '<span class="blank" title="' . esc_attr( $name ) . '">' . esc_html( $name ) . '</span>';
				},
				$html
			);
		};
		$out  = '';
		$list = false;
		foreach ( preg_split( '/\r?\n/', (string) $body ) as $line ) {
			$t = trim( $line );
			if ( 0 === strpos( $t, '- ' ) ) {
				if ( ! $list ) {
					$out .= '<ul>';
					$list = true;
				}
				$out .= '<li>' . $fill( substr( $t, 2 ) ) . '</li>';
				continue;
			}
			if ( $list ) {
				$out .= '</ul>';
				$list = false;
			}
			if ( '' === $t ) {
				continue;
			}
			if ( 0 === strpos( $t, '### ' ) ) {
				$out .= '<h3>' . $fill( substr( $t, 4 ) ) . '</h3>';
			} elseif ( 0 === strpos( $t, '## ' ) ) {
				$out .= '<h2>' . $fill( substr( $t, 3 ) ) . '</h2>';
			} elseif ( 0 === strpos( $t, '# ' ) ) {
				$out .= '<h1>' . $fill( substr( $t, 2 ) ) . '</h1>';
			} elseif ( 0 === strpos( $t, '> ' ) ) {
				$out .= '<p class="note">' . $fill( substr( $t, 2 ) ) . '</p>';
			} else {
				$out .= '<p>' . $fill( $t ) . '</p>';
			}
		}
		return $out . ( $list ? '</ul>' : '' );
	}

	/** Fingerprint of exactly what was signed (text + values). */
	private static function fingerprint( $c ) {
		return hash( 'sha256', $c->number . "\n" . $c->body . "\n" . wp_json_encode( self::vars_of( $c ) ) );
	}

	private static function vars_of( $c ) {
		$v = json_decode( (string) $c->vars, true );
		return is_array( $v ) ? $v : array();
	}

	/* ------------------------------------------------------------------ Team routes */

	private static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', (int) $id ) );
	}

	public static function by_token( $token ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE token = %s AND archived_at IS NULL', (string) $token ) );
	}

	public static function url( $token ) {
		return get_option( 'permalink_structure' ) ? home_url( '/k/' . $token . '/' ) : add_query_arg( 'mp_contract', $token, home_url( '/' ) );
	}

	private static function next_number() {
		$year = MP_Jalali::from_iso( MP_Util::today() )[0];
		$key  = 'mp_contract_seq_' . $year;
		$n    = (int) get_option( $key, 0 ) + 1;
		update_option( $key, $n, false );
		return 'CT-' . $year . '-' . str_pad( (string) $n, 3, '0', STR_PAD_LEFT );
	}

	/** Amount of the contract, when one of its variables is a sum. */
	private static function amount( $c ) {
		foreach ( self::vars_of( $c ) as $k => $v ) {
			if ( 'money' === self::kind( $k ) ) {
				return (int) preg_replace( '/\D/', '', J_latin( (string) $v ) );
			}
		}
		return 0;
	}

	public static function payload( $c ) {
		global $wpdb;
		$p     = $c->project_id ? $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $c->project_id ) ) : '';
		$vars  = self::vars_of( $c );
		$phone = '';
		foreach ( $vars as $k => $v ) {
			if ( 'phone' === self::kind( $k ) && $v ) {
				$phone = $v;
				break;
			}
		}
		return array(
			'id'             => (int) $c->id,
			'number'         => $c->number,
			'title'          => $c->title,
			'project_id'     => (int) $c->project_id,
			'project'        => (string) $p,
			'client_id'      => (int) $c->client_id,
			'client_name'    => $c->client_name,
			'template_id'    => (int) $c->template_id,
			'body'           => $c->body,
			'vars'           => (object) $vars,
			'amount'         => self::amount( $c ),
			'phone'          => $phone,
			'status'         => $c->status,
			'url'            => self::url( $c->token ),
			'sent_at'        => $c->sent_at,
			'signed_at'      => $c->signed_at,
			'signer_name'    => $c->signer_name,
			'signer_mobile'  => $c->signer_mobile,
			'fingerprint'    => $c->doc_hash ? strtoupper( substr( $c->doc_hash, 0, 16 ) ) : '',
			'created_at'     => $c->created_at,
			'archived'       => ! empty( $c->archived_at ),
			'channels'       => self::channels( (int) $c->project_id, (int) $c->client_id ),
		);
	}

	/** Client groups the contract can be sent in (the project's, else the customer's). */
	private static function channels( $pid, $cid ) {
		global $wpdb;
		$rows = $pid ? $wpdb->get_results( $wpdb->prepare( 'SELECT id, title FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", $pid ) ) : array();
		if ( ! $rows && $cid ) {
			$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id, title FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND client_id = %d AND archived_at IS NULL", $cid ) );
		}
		return array_map(
			function ( $c ) {
				return array( 'id' => (int) $c->id, 'title' => $c->title );
			},
			$rows
		);
	}

	/** GET contracts?archived=&project_id= */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		$where = array( $r['archived'] ? 'archived_at IS NOT NULL' : 'archived_at IS NULL' );
		if ( (int) $r['project_id'] ) {
			$where[] = $wpdb->prepare( 'project_id = %d', (int) $r['project_id'] );
		}
		$rows = $wpdb->get_results( 'SELECT * FROM ' . self::t() . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY id DESC LIMIT 500' ); // phpcs:ignore
		return array( 'items' => array_map( array( __CLASS__, 'payload' ), $rows ), 'templates' => self::templates(), 'settings' => self::settings() );
	}

	/** POST contracts[/id] {title, project_id, client_id, client_name, template_id, body, vars} */
	public static function save( WP_REST_Request $r ) {
		global $wpdb;
		$id  = (int) $r['id'];
		$old = $id ? self::get( $id ) : null;
		if ( $id && ! $old ) {
			return self::err( 'قرارداد پیدا نشد.', 404 );
		}
		if ( $old && 'signed' === $old->status ) {
			return self::err( 'قرارداد امضاشده قابل ویرایش نیست؛ برای تغییر، یک نسخه تازه بسازید.' );
		}
		$body = MP_Util::long_text( $r['body'], 60000 );
		if ( '' === trim( $body ) ) {
			return self::err( 'متن قرارداد خالی است.' );
		}
		$vars = array();
		foreach ( self::variables( $body ) as $name ) {
			if ( in_array( $name, self::SYSTEM_VARS, true ) ) {
				continue;
			}
			$in = is_array( $r['vars'] ) && isset( $r['vars'][ $name ] ) ? $r['vars'][ $name ] : '';
			$in = MP_Util::long_text( (string) $in, 1000 );
			if ( 'money' === self::kind( $name ) || 'national' === self::kind( $name ) || 'phone' === self::kind( $name ) ) {
				$in = J_latin( $in );
			}
			$vars[ $name ] = $in;
		}
		$cust   = (int) $r['client_id'] ? MP_Client::customer( (int) $r['client_id'] ) : null;
		$client = $cust ? $cust->name : MP_Util::text( $r['client_name'], 160 );
		$pid    = (int) $r['project_id'];
		if ( $pid && ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'به این پروژه دسترسی ندارید.', 403 );
		}
		$row = array(
			'title'       => MP_Util::text( $r['title'], 200 ),
			'project_id'  => $pid,
			'client_id'   => '' !== $client ? MP_Client::customer_id( $client, $cust ? $cust->id : 0, $pid ) : 0,
			'client_name' => $client,
			'template_id' => (int) $r['template_id'],
			'body'        => $body,
			'vars'        => wp_json_encode( $vars, JSON_UNESCAPED_UNICODE ),
			'updated_at'  => MP_Util::now(),
		);
		if ( '' === $row['title'] ) {
			$row['title'] = 'قرارداد' . ( $client ? ' ' . $client : '' );
		}
		if ( $old ) {
			$wpdb->update( self::t(), $row, array( 'id' => $id ) );
			MP_Audit::log( 'update', 'contract', $id, $old->number );
		} else {
			$wpdb->insert(
				self::t(),
				$row + array(
					'number'     => self::next_number(),
					'status'     => 'draft',
					'token'      => wp_generate_password( 32, false, false ),
					'created_by' => get_current_user_id(),
					'created_at' => MP_Util::now(),
				)
			);
			$id = (int) $wpdb->insert_id;
			MP_Audit::log( 'create', 'contract', $id, self::get( $id )->number . ' · ' . $client );
		}
		return self::payload( self::get( $id ) );
	}

	/** POST contracts/{id}/send {channel_id?, sms?} — studio signs, the client is told where to sign. */
	public static function send( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c || 'cancelled' === $c->status ) {
			return self::err( 'قرارداد پیدا نشد.', 404 );
		}
		$missing = array();
		foreach ( self::vars_of( $c ) as $k => $v ) {
			if ( '' === trim( (string) $v ) ) {
				$missing[] = $k;
			}
		}
		if ( $missing ) {
			return self::err( 'این موارد هنوز خالی است: ' . implode( '، ', array_slice( $missing, 0, 5 ) ) );
		}
		if ( 'draft' === $c->status ) {
			$wpdb->update( self::t(), array( 'status' => 'sent', 'sent_at' => MP_Util::now(), 'studio_signer' => get_current_user_id() ), array( 'id' => $c->id ) );
			$c = self::get( $c->id );
		}
		$cid = (int) $r['channel_id'];
		if ( $cid && ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'به این گروه دسترسی ندارید.', 403 );
		}
		$text = 'قرارداد ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ( $c->title ? ' — ' . $c->title : '' ) . ' برای مطالعه و امضا ارسال شد.';
		MP_Client::system( $cid, $cid ? 0 : (int) $c->project_id, $text, array( 't' => 'contract', 'id' => (int) $c->id, 'url' => self::url( $c->token ) ) );
		$sms = false;
		if ( ! empty( $r['sms'] ) ) {
			$p   = self::payload( $c );
			$mob = MP_Auth::normalize( $p['phone'] );
			$sms = $mob && MP_Auth::text( $mob, $c->client_name . ' عزیز، قرارداد «' . $c->title . '» از ' . self::settings()['studio'] . ' آماده امضاست: ' . self::url( $c->token ) );
		}
		MP_Audit::log( 'update', 'contract', $c->id, $c->number . ' ارسال برای امضا' );
		return self::payload( self::get( $c->id ) ) + array( 'sms_sent' => (bool) $sms );
	}

	public static function set_status( WP_REST_Request $r ) {
		global $wpdb;
		$c      = self::get( (int) $r['id'] );
		$status = MP_Util::pick( $r['status'], array( 'draft', 'cancelled' ), '' );
		if ( ! $c || ! $status ) {
			return self::err( 'وضعیت معتبر نیست.' );
		}
		if ( 'signed' === $c->status ) {
			return self::err( 'قرارداد امضاشده را نمی‌توان تغییر داد؛ می‌توانید آرشیوش کنید.' );
		}
		$wpdb->update( self::t(), array( 'status' => $status, 'updated_at' => MP_Util::now() ), array( 'id' => $c->id ) );
		return self::payload( self::get( $c->id ) );
	}

	public static function archive( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c ) {
			return self::err( 'قرارداد پیدا نشد.', 404 );
		}
		$wpdb->update( self::t(), array( 'archived_at' => $r['restore'] ? null : MP_Util::now() ), array( 'id' => $c->id ) );
		MP_Audit::log( $r['restore'] ? 'restore' : 'archive', 'contract', $c->id, $c->number );
		return self::payload( self::get( $c->id ) );
	}

	/** A new draft with the same text and values (e.g. to change a signed one). */
	public static function duplicate( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c ) {
			return self::err( 'قرارداد پیدا نشد.', 404 );
		}
		$wpdb->insert(
			self::t(),
			array(
				'number'      => self::next_number(),
				'title'       => $c->title,
				'project_id'  => $c->project_id,
				'client_id'   => $c->client_id,
				'client_name' => $c->client_name,
				'template_id' => $c->template_id,
				'body'        => $c->body,
				'vars'        => $c->vars,
				'status'      => 'draft',
				'token'       => wp_generate_password( 32, false, false ),
				'created_by'  => get_current_user_id(),
				'created_at'  => MP_Util::now(),
				'updated_at'  => MP_Util::now(),
			)
		);
		return self::payload( self::get( (int) $wpdb->insert_id ) );
	}

	/* ------------------------------------------------------------------ Client signing */

	private static function otp_key( $c ) {
		return 'mp_ksig_' . $c->id;
	}

	/** Mobile the signing code goes to: the contract's phone value, else the logged-in portal contact. */
	private static function signer_mobile( $c ) {
		$p = self::payload( $c );
		$m = MP_Auth::normalize( $p['phone'] );
		if ( ! $m && $c->project_id ) {
			global $wpdb;
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", $c->project_id ) ) as $ch ) {
				$s = MP_Client::session( $ch );
				if ( $s ) {
					return $s->mobile;
				}
			}
		}
		return $m;
	}

	private static function mask( $m ) {
		return $m ? MP_Jalali::digits( substr( $m, 0, 4 ) . '•••' . substr( $m, -4 ) ) : '';
	}

	private static function need_otp() {
		return self::settings()['otp'] && MP_Auth::otp_enabled();
	}

	/** POST contract/{token}/code — 5-digit code to the client's mobile. */
	public static function client_code( WP_REST_Request $r ) {
		$c = self::by_token( $r['token'] );
		if ( ! $c || 'sent' !== $c->status ) {
			return self::err( 'این قرارداد برای امضا باز نیست.', 404 );
		}
		if ( ! self::need_otp() ) {
			return self::err( 'تأیید پیامکی فعال نیست.' );
		}
		$mobile = self::signer_mobile( $c );
		if ( ! $mobile ) {
			return self::err( 'شماره موبایلی برای این قرارداد ثبت نشده؛ با تیم تماس بگیرید.' );
		}
		$state = get_transient( self::otp_key( $c ) );
		$now   = time();
		if ( is_array( $state ) && $state['sent'] > $now - MP_Auth::RESEND_WAIT ) {
			return self::err( 'کد تازه ارسال شده؛ ' . MP_Jalali::digits( (string) ( MP_Auth::RESEND_WAIT - ( $now - $state['sent'] ) ) ) . ' ثانیه دیگر دوباره امتحان کنید.', 429 );
		}
		$code = (string) wp_rand( 10000, 99999 );
		set_transient( self::otp_key( $c ), array( 'hash' => wp_hash( $mobile . '|' . $code ), 'exp' => $now + 300, 'tries' => 0, 'sent' => $now, 'mobile' => $mobile ), HOUR_IN_SECONDS );
		if ( defined( 'MP_TESTING' ) && MP_TESTING ) {
			$GLOBALS['mp_last_otp'] = $code;
		}
		if ( ! MP_Auth::send_code( $mobile, $code ) ) {
			return self::err( 'ارسال پیامک انجام نشد؛ کمی بعد دوباره امتحان کنید.', 502 );
		}
		return array( 'sent' => true, 'to' => self::mask( $mobile ), 'wait' => MP_Auth::RESEND_WAIT );
	}

	/** POST contract/{token}/sign {name, signature, code, agree} */
	public static function client_sign( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::by_token( $r['token'] );
		if ( ! $c || 'sent' !== $c->status ) {
			return self::err( 'این قرارداد برای امضا باز نیست.', 404 );
		}
		$name = MP_Util::text( $r['name'], 120 );
		$sig  = (string) $r['signature'];
		if ( empty( $r['agree'] ) || '' === $name ) {
			return self::err( 'نام خود را بنویسید و پذیرش مفاد قرارداد را تأیید کنید.' );
		}
		if ( ! self::valid_png( $sig ) ) {
			return self::err( 'امضای خود را در کادر بکشید.' );
		}
		$mobile = '';
		$method = 'draw';
		if ( self::need_otp() ) {
			$state = get_transient( self::otp_key( $c ) );
			if ( ! is_array( $state ) || empty( $state['hash'] ) || $state['exp'] < time() ) {
				return self::err( 'کد تأیید منقضی شده؛ کد جدید بگیرید.' );
			}
			$code = preg_replace( '/\D/', '', J_latin( (string) $r['code'] ) );
			if ( ! hash_equals( $state['hash'], wp_hash( $state['mobile'] . '|' . $code ) ) ) {
				++$state['tries'];
				if ( $state['tries'] >= MP_Auth::MAX_TRIES ) {
					$state['hash'] = '';
				}
				set_transient( self::otp_key( $c ), $state, HOUR_IN_SECONDS );
				return self::err( 'کد تأیید درست نیست.' );
			}
			delete_transient( self::otp_key( $c ) );
			$mobile = $state['mobile'];
			$method = 'otp';
		}
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 255 ) : '';
		$wpdb->update(
			self::t(),
			array(
				'status'         => 'signed',
				'signed_at'      => MP_Util::now(),
				'signer_name'    => $name,
				'signer_mobile'  => $mobile,
				'signer_ip'      => $ip,
				'signer_ua'      => $ua,
				'sign_method'    => $method,
				'client_sig'     => $sig,
				'doc_hash'       => self::fingerprint( $c ),
				'updated_at'     => MP_Util::now(),
			),
			array( 'id' => $c->id )
		);
		MP_Client::system( 0, (int) $c->project_id, 'قرارداد ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ' توسط ' . $name . ' امضا شد ✓', array( 't' => 'contract', 'id' => (int) $c->id, 'url' => self::url( $c->token ) ) );
		foreach ( MP_Util::panel_users() as $m ) {
			if ( MP_Util::is_manager( $m ) ) {
				MP_Notify::send( $m, 'contract', $name . ' قرارداد ' . $c->number . ' را امضا کرد', $c->title, 'contracts', $c->id, true );
			}
		}
		MP_Audit::log( 'update', 'contract', $c->id, $c->number . ' امضای مشتری (' . $method . ')' );
		return array( 'signed' => true );
	}

	/** Contracts of a project for the client portal (never drafts). */
	public static function for_portal( $pid ) {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE project_id = %d AND status IN ('sent','signed') AND archived_at IS NULL ORDER BY id DESC", $pid ) ) as $c ) {
			$out[] = array( 'number' => $c->number, 'title' => $c->title, 'status' => $c->status, 'url' => self::url( $c->token ), 'sent_at' => $c->sent_at, 'signed_at' => $c->signed_at, 'signer' => $c->signer_name );
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Public page */

	public static function render_public( $token ) {
		$c = self::by_token( $token );
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		if ( ! $c ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$s      = self::settings();
		$vars   = self::vars_of( $c );
		$studio = $c->studio_signer ? get_userdata( $c->studio_signer ) : null;
		$intact = 'signed' !== $c->status || hash_equals( (string) $c->doc_hash, self::fingerprint( $c ) );
		$client = '';
		foreach ( $vars as $k => $v ) {
			if ( preg_match( '/نام.*(مشتری|کارفرما)/u', $k ) && $v ) {
				$client = $v;
				break;
			}
		}
		$client = $client ? $client : $c->client_name;
		$agent  = isset( $vars['نام مجری'] ) && $vars['نام مجری'] ? $vars['نام مجری'] : $s['agent'];
		$otp    = self::need_otp();
		include MP_DIR . 'templates/contract.php';
		exit;
	}
}

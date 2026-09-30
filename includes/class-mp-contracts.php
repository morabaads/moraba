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
	const SYSTEM_VARS = array( 'نام استودیو', 'نشانی استودیو', 'شماره قرارداد', 'تاریخ قرارداد', 'نام پروژه', 'شماره قرارداد اصلی' );
	const STATUS   = array( 'draft' => 'پیش‌نویس', 'sent' => 'منتظر امضای مشتری', 'client_signed' => 'منتظر امضای مجری', 'signed' => 'امضاشده', 'cancelled' => 'لغوشده' );

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
			array( "contracts/$id/amend", 'POST', 'amend', $m ),
			array( "contracts/$id/stage", 'POST', 'issue_stage', $m ),
			array( "contracts/$id/extend", 'POST', 'extend', $m ),
			array( "contracts/$id/studio-sign", 'POST', 'studio_sign', $m ),
			array( 'contracts/settings', 'POST', 'save_settings', $m ),
			array( 'contract-templates', 'POST', 'save_template', $m ),
			array( "contract-templates/$id", 'POST', 'save_template', $m ),
			array( "contract-templates/$id", 'DELETE', 'delete_template', $m ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/code', 'POST', 'client_code', '__return_true' ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/sign', 'POST', 'client_sign', '__return_true' ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/seen', 'POST', 'client_seen', '__return_true' ),
			array( 'contract/(?P<token>[A-Za-z0-9]{32})/pdf', 'POST', 'client_pdf', '__return_true' ),
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
				// Optional features, each can be switched off.
				'f_invoice'   => true,  // payment stages → invoices (at signing / when a milestone is done)
				'f_track'     => true,  // who opened it, how often, how far they read
				'f_remind'    => true,  // SMS reminders while unsigned
				'remind_days' => 3,
				'remind_max'  => 3,
				'f_expiry'    => true,  // signing deadline
				'expire_days' => 14,
				'f_annex'     => true,  // attachments (features / specs) and amendments
				'f_multi'     => false, // several signers in order
				'f_clauses'   => true,  // ready-made clauses in the editor
				'f_idcard'    => false, // photo of the national ID card when signing
				'f_pdf'       => true,  // real PDF file, archived in the project after signing
				'stages'      => array(
					array( 'pct' => 50, 'title' => 'پیش‌پرداخت همزمان با امضای قرارداد', 'on' => 'sign' ),
					array( 'pct' => 30, 'title' => 'پس از ارائه و تأیید طرح اولیه (UI)', 'on' => 'manual' ),
					array( 'pct' => 20, 'title' => 'پس از پیاده‌سازی روی هاست و آماده شدن نسخه اولیه', 'on' => 'manual' ),
				),
				'clauses'     => self::DEFAULT_CLAUSES,
			)
		);
	}

	const DEFAULT_CLAUSES = array(
		array( 'title' => 'مالکیت کد و فایل‌ها', 'body' => "پس از تسویه کامل مبلغ قرارداد، مالکیت فایل‌های نهایی طراحی و کدهای اختصاصی پروژه به کارفرما منتقل می‌شود.\nمجری حق دارد نمونه‌ای از کار را در نمونه‌کارهای خود نمایش دهد، مگر آنکه کارفرما کتباً مخالفت کند.\nکتابخانه‌ها، قالب‌ها و افزونه‌های عمومی یا تجاری مشمول مجوز سازنده خود هستند." ),
		array( 'title' => 'فسخ قرارداد', 'body' => "هر یک از طرفین در صورت نقض تعهدات توسط طرف مقابل و عدم رفع آن ظرف ۷ روز پس از اخطار کتبی، حق فسخ قرارداد را دارد.\nدر صورت فسخ از سوی کارفرما، مبالغ پرداخت‌شده بابت مراحل انجام‌شده قابل استرداد نیست و هزینه کار انجام‌شده در مرحله جاری به نسبت پیشرفت محاسبه می‌شود.\nدر صورت فسخ از سوی مجری بدون قصور کارفرما، مبلغ مرحله انجام‌نشده به کارفرما بازگردانده می‌شود." ),
		array( 'title' => 'حل اختلاف', 'body' => "طرفین تلاش می‌کنند اختلافات احتمالی را از راه گفت‌وگو و توافق حل کنند.\nدر صورت عدم توافق ظرف ۱۵ روز، موضوع به داوری مرضی‌الطرفین ارجاع می‌شود و رأی داور برای طرفین لازم‌الاجراست؛ در غیر این صورت مراجع قضایی صالح رسیدگی خواهند کرد." ),
		array( 'title' => 'محرمانگی', 'body' => "طرفین متعهد می‌شوند کلیه اطلاعات، اسناد، داده‌ها و دسترسی‌هایی را که در اجرای این قرارداد در اختیارشان قرار می‌گیرد محرمانه نگه دارند و جز برای اجرای قرارداد استفاده نکنند.\nاین تعهد پس از پایان قرارداد نیز به قوت خود باقی است." ),
		array( 'title' => 'فورس ماژور', 'body' => "در صورت بروز حوادث قهری و خارج از اراده طرفین (مانند بلایای طبیعی، قطعی گسترده اینترنت یا تصمیمات حاکمیتی)، مدت قرارداد به میزان تأخیر ناشی از آن تمدید می‌شود و هیچ‌یک از طرفین مسئول تأخیر نخواهد بود." ),
	);

	const AMENDMENT_BODY = "## موضوع الحاقیه\nاین الحاقیه به قرارداد شماره {شماره قرارداد اصلی} فی‌مابین {نام استودیو} و {نام مشتری} تنظیم می‌گردد و جزء لاینفک آن قرارداد است.\n\n## تغییرات\n- شرح تغییر: {شرح تغییرات}\n- مبلغ الحاقیه: {مبلغ الحاقیه}\n- مدت اضافه: {مدت اضافه}\n\n## سایر مفاد\nسایر مفاد قرارداد اصلی بدون تغییر به قوت خود باقی است.";

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
		foreach ( array( 'f_invoice', 'f_track', 'f_remind', 'f_expiry', 'f_annex', 'f_multi', 'f_clauses', 'f_idcard', 'f_pdf' ) as $k ) {
			$s[ $k ] = null === $r[ $k ] ? $old[ $k ] : ( ! empty( $r[ $k ] ) && 'false' !== $r[ $k ] );
		}
		$s['remind_days'] = null === $r['remind_days'] ? $old['remind_days'] : max( 1, min( 30, (int) $r['remind_days'] ) );
		$s['remind_max']  = null === $r['remind_max'] ? $old['remind_max'] : max( 1, min( 10, (int) $r['remind_max'] ) );
		$s['expire_days'] = null === $r['expire_days'] ? $old['expire_days'] : max( 1, min( 365, (int) $r['expire_days'] ) );
		$s['stages']      = null === $r['stages'] ? $old['stages'] : self::clean_stages( $r['stages'], false );
		$s['clauses']     = $old['clauses'];
		if ( is_array( $r['clauses'] ) ) {
			$s['clauses'] = array();
			foreach ( array_slice( $r['clauses'], 0, 40 ) as $cl ) {
				$t = MP_Util::text( isset( $cl['title'] ) ? $cl['title'] : '', 120 );
				$b = MP_Util::long_text( isset( $cl['body'] ) ? $cl['body'] : '', 4000 );
				if ( '' !== $t && '' !== trim( $b ) ) {
					$s['clauses'][] = array( 'title' => $t, 'body' => $b );
				}
			}
		}
		update_option( self::SETTINGS, $s, false );
		return self::settings();
	}

	/** Payment stages: [{pct, title, on: sign|manual|milestone, milestone_id, invoice_id}]. */
	private static function clean_stages( $in, $keep_invoice ) {
		$out = array();
		foreach ( is_array( $in ) ? array_slice( $in, 0, 10 ) : array() as $st ) {
			$pct = max( 0, min( 100, (int) ( isset( $st['pct'] ) ? $st['pct'] : 0 ) ) );
			if ( ! $pct ) {
				continue;
			}
			$mid   = (int) ( isset( $st['milestone_id'] ) ? $st['milestone_id'] : 0 );
			$on    = MP_Util::pick( isset( $st['on'] ) ? $st['on'] : '', array( 'sign', 'manual', 'milestone' ), 'manual' );
			$out[] = array(
				'pct'          => $pct,
				'title'        => MP_Util::text( isset( $st['title'] ) ? $st['title'] : '', 160 ),
				'on'           => 'milestone' === $on && ! $mid ? 'manual' : $on,
				'milestone_id' => 'milestone' === $on ? $mid : 0,
				'invoice_id'   => $keep_invoice && ! empty( $st['invoice_id'] ) ? (int) $st['invoice_id'] : 0,
			);
		}
		return $out;
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
			'شماره قرارداد اصلی' => $c && ! empty( $c->parent_id ) ? (string) $wpdb->get_var( $wpdb->prepare( 'SELECT number FROM ' . self::t() . ' WHERE id = %d', $c->parent_id ) ) : '',
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
		return hash( 'sha256', $c->number . "\n" . $c->body . "\n" . wp_json_encode( self::vars_of( $c ) ) . ( ! empty( $c->annex ) ? "\n" . $c->annex_title . "\n" . $c->annex : '' ) );
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

	/** Customer's phone from the contract's values. */
	private static function phone_of( $c ) {
		foreach ( self::vars_of( $c ) as $k => $v ) {
			if ( 'phone' === self::kind( $k ) && $v ) {
				return $v;
			}
		}
		return '';
	}

	private static function client_of( $c ) {
		foreach ( self::vars_of( $c ) as $k => $v ) {
			if ( preg_match( '/نام.*(مشتری|کارفرما)/u', $k ) && $v ) {
				return $v;
			}
		}
		return $c->client_name;
	}

	/**
	 * Who signs, in order. Without the multi-signer feature (or none set) it is one person: the
	 * customer named in the contract, with the contract's phone.
	 */
	public static function signers_of( $c ) {
		$list = json_decode( (string) $c->signers, true );
		$list = is_array( $list ) ? $list : array();
		if ( ! $list || ! self::settings()['f_multi'] ) {
			$one  = $list ? $list[0] : array();
			$list = array( array_merge( array( 'name' => self::client_of( $c ), 'mobile' => MP_Auth::normalize( self::phone_of( $c ) ), 'role' => 'کارفرما' ), $one ) );
		}
		return $list;
	}

	private static function next_signer( $c ) {
		foreach ( self::signers_of( $c ) as $i => $sg ) {
			if ( empty( $sg['signed_at'] ) ) {
				return $i;
			}
		}
		return -1;
	}

	public static function expired( $c ) {
		return self::settings()['f_expiry'] && 'sent' === $c->status && $c->expires_at && $c->expires_at < MP_Util::today();
	}

	private static function stages_of( $c ) {
		$st = json_decode( (string) $c->stages, true );
		return is_array( $st ) ? $st : array();
	}

	public static function payload( $c ) {
		global $wpdb;
		$p       = $c->project_id ? $wpdb->get_var( $wpdb->prepare( 'SELECT name FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $c->project_id ) ) : '';
		$amount  = self::amount( $c );
		$signers = array();
		foreach ( self::signers_of( $c ) as $sg ) {
			$signers[] = array(
				'name'      => isset( $sg['name'] ) ? $sg['name'] : '',
				'mobile'    => isset( $sg['mobile'] ) ? $sg['mobile'] : '',
				'role'      => isset( $sg['role'] ) ? $sg['role'] : '',
				'signed_at' => isset( $sg['signed_at'] ) ? $sg['signed_at'] : null,
				'method'    => isset( $sg['method'] ) ? $sg['method'] : '',
				'id_card'   => ! empty( $sg['id_card'] ) ? $sg['id_card'] : '', // only the team sees this payload
			);
		}
		$stages = array();
		foreach ( self::stages_of( $c ) as $st ) {
			$st['amount']  = (int) round( $amount * $st['pct'] / 100 );
			$st['invoice'] = ! empty( $st['invoice_id'] ) && class_exists( 'MP_Invoices' ) ? MP_Invoices::status_of( $st['invoice_id'] ) : null;
			$stages[]      = $st;
		}
		$pdf = $c->pdf_file_id ? MP_Files::payload( MP_Files::get( $c->pdf_file_id ) ) : null;
		return array(
			'id'              => (int) $c->id,
			'number'          => $c->number,
			'title'           => $c->title,
			'kind'            => $c->kind ? $c->kind : 'contract',
			'parent_id'       => (int) $c->parent_id,
			'parent_number'   => $c->parent_id ? (string) $wpdb->get_var( $wpdb->prepare( 'SELECT number FROM ' . self::t() . ' WHERE id = %d', $c->parent_id ) ) : '',
			'project_id'      => (int) $c->project_id,
			'project'         => (string) $p,
			'client_id'       => (int) $c->client_id,
			'client_name'     => $c->client_name,
			'template_id'     => (int) $c->template_id,
			'body'            => $c->body,
			'annex_title'     => (string) $c->annex_title,
			'annex'           => (string) $c->annex,
			'vars'            => (object) self::vars_of( $c ),
			'amount'          => $amount,
			'phone'           => self::phone_of( $c ),
			'status'          => $c->status,
			'expired'         => self::expired( $c ),
			'expires_at'      => $c->expires_at,
			'url'             => self::url( $c->token ),
			'sent_at'         => $c->sent_at,
			'signed_at'       => $c->signed_at,
			'signer_name'     => $c->signer_name,
			'signer_mobile'   => $c->signer_mobile,
			'signers'         => $signers,
			'studio_signed'   => (bool) $c->studio_sig,
			'studio_signed_at'=> $c->studio_signed_at,
			'stages'          => $stages,
			'views'           => (int) $c->views,
			'first_viewed_at' => $c->first_viewed_at,
			'last_viewed_at'  => $c->last_viewed_at,
			'read_pct'        => (int) $c->read_pct,
			'reminders_sent'  => (int) $c->reminders_sent,
			'pdf'             => $pdf,
			'fingerprint'     => $c->doc_hash ? strtoupper( substr( $c->doc_hash, 0, 16 ) ) : '',
			'created_at'      => $c->created_at,
			'archived'        => ! empty( $c->archived_at ),
			'channels'        => self::channels( (int) $c->project_id, (int) $c->client_id ),
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
		if ( $old && in_array( $old->status, array( 'signed', 'client_signed' ), true ) ) {
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
		$set = self::settings();
		if ( $set['f_annex'] && null !== $r['annex'] ) {
			$row['annex_title'] = MP_Util::text( $r['annex_title'], 200 );
			$row['annex']       = MP_Util::long_text( $r['annex'], 40000 );
		}
		if ( $set['f_multi'] && is_array( $r['signers'] ) ) {
			$list = array();
			foreach ( array_slice( $r['signers'], 0, 6 ) as $sg ) {
				$n = MP_Util::text( isset( $sg['name'] ) ? $sg['name'] : '', 120 );
				if ( '' === $n ) {
					continue;
				}
				$list[] = array( 'name' => $n, 'mobile' => MP_Auth::normalize( isset( $sg['mobile'] ) ? $sg['mobile'] : '' ), 'role' => MP_Util::text( isset( $sg['role'] ) ? $sg['role'] : '', 60 ) );
			}
			if ( $old && 'sent' === $old->status && $old->signers ) {
				// Keep signatures already given; only the people after them can change.
				$prev = json_decode( $old->signers, true );
				foreach ( is_array( $prev ) ? $prev : array() as $i => $sg ) {
					if ( ! empty( $sg['signed_at'] ) ) {
						$list[ $i ] = $sg;
					}
				}
				ksort( $list );
				$list = array_values( $list );
			}
			$row['signers'] = $list ? wp_json_encode( $list, JSON_UNESCAPED_UNICODE ) : null;
		}
		if ( $set['f_invoice'] && null !== $r['stages'] ) {
			$prev = $old ? self::stages_of( $old ) : array();
			$new  = self::clean_stages( $r['stages'], false );
			foreach ( $new as $i => $st ) {
				if ( ! empty( $prev[ $i ]['invoice_id'] ) ) {
					$new[ $i ]['invoice_id'] = (int) $prev[ $i ]['invoice_id']; // an issued stage keeps its invoice
				}
			}
			$row['stages'] = wp_json_encode( $new, JSON_UNESCAPED_UNICODE );
		}
		if ( $set['f_expiry'] && null !== $r['expires_at'] ) {
			$row['expires_at'] = MP_Util::valid_date( $r['expires_at'] ) ? $r['expires_at'] : null;
		}
		if ( ! $old && $set['f_expiry'] && ! isset( $row['expires_at'] ) ) {
			$row['expires_at'] = gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' +' . (int) $set['expire_days'] . ' days UTC' ) );
		}
		if ( ! $old && $set['f_invoice'] && ! isset( $row['stages'] ) ) {
			$row['stages'] = wp_json_encode( self::clean_stages( $set['stages'], false ), JSON_UNESCAPED_UNICODE );
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
			$wpdb->update( self::t(), array( 'status' => 'sent', 'sent_at' => MP_Util::now() ), array( 'id' => $c->id ) );
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
		if ( in_array( $c->status, array( 'signed', 'client_signed' ), true ) ) {
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
				'annex_title' => $c->annex_title,
				'annex'       => $c->annex,
				'stages'      => wp_json_encode( self::clean_stages( self::stages_of( $c ), false ), JSON_UNESCAPED_UNICODE ),
				'expires_at'  => self::settings()['f_expiry'] ? gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' +' . (int) self::settings()['expire_days'] . ' days UTC' ) ) : null,
				'status'      => 'draft',
				'token'       => wp_generate_password( 32, false, false ),
				'created_by'  => get_current_user_id(),
				'created_at'  => MP_Util::now(),
				'updated_at'  => MP_Util::now(),
			)
		);
		return self::payload( self::get( (int) $wpdb->insert_id ) );
	}

	/** POST contracts/{id}/amend — a draft amendment (الحاقیه) to a signed contract. */
	public static function amend( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c || 'signed' !== $c->status ) {
			return self::err( 'الحاقیه فقط برای قرارداد امضاشده ساخته می‌شود.' );
		}
		$root = $c->parent_id ? self::get( $c->parent_id ) : $c;
		$n    = 1 + (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t() . " WHERE parent_id = %d AND kind = 'amendment'", $root->id ) );
		$old  = self::vars_of( $root );
		$vars = array();
		foreach ( self::variables( self::AMENDMENT_BODY ) as $k ) {
			if ( ! in_array( $k, self::SYSTEM_VARS, true ) ) {
				$vars[ $k ] = isset( $old[ $k ] ) ? $old[ $k ] : '';
			}
		}
		$wpdb->insert(
			self::t(),
			array(
				'number'      => $root->number . '-A' . $n,
				'title'       => 'الحاقیه ' . $n . ' — ' . $root->title,
				'kind'        => 'amendment',
				'parent_id'   => (int) $root->id,
				'project_id'  => $root->project_id,
				'client_id'   => $root->client_id,
				'client_name' => $root->client_name,
				'body'        => self::AMENDMENT_BODY,
				'vars'        => wp_json_encode( $vars, JSON_UNESCAPED_UNICODE ),
				'signers'     => $root->signers,
				'status'      => 'draft',
				'token'       => wp_generate_password( 32, false, false ),
				'expires_at'  => self::settings()['f_expiry'] ? gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' +' . (int) self::settings()['expire_days'] . ' days UTC' ) ) : null,
				'created_by'  => get_current_user_id(),
				'created_at'  => MP_Util::now(),
				'updated_at'  => MP_Util::now(),
			)
		);
		// Signatures of the original are not carried over.
		$new = self::get( (int) $wpdb->insert_id );
		if ( $new->signers ) {
			$list = array_map(
				function ( $sg ) {
					return array( 'name' => $sg['name'], 'mobile' => $sg['mobile'], 'role' => isset( $sg['role'] ) ? $sg['role'] : '' );
				},
				json_decode( $new->signers, true )
			);
			$wpdb->update( self::t(), array( 'signers' => wp_json_encode( $list, JSON_UNESCAPED_UNICODE ) ), array( 'id' => $new->id ) );
		}
		MP_Audit::log( 'create', 'contract', $new->id, $new->number );
		return self::payload( self::get( $new->id ) );
	}

	/** POST contracts/{id}/extend {days} — a new signing deadline (and the link works again). */
	public static function extend( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c || 'signed' === $c->status ) {
			return self::err( 'قرارداد پیدا نشد.', 404 );
		}
		$days = max( 1, min( 365, (int) ( $r['days'] ? $r['days'] : self::settings()['expire_days'] ) ) );
		$wpdb->update( self::t(), array( 'expires_at' => gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' +' . $days . ' days UTC' ) ), 'reminders_sent' => 0 ), array( 'id' => $c->id ) );
		return self::payload( self::get( $c->id ) );
	}

	/** Issues the invoice of one payment stage (once). */
	private static function stage_invoice( $c, $i ) {
		global $wpdb;
		$stages = self::stages_of( $c );
		if ( ! isset( $stages[ $i ] ) || ! empty( $stages[ $i ]['invoice_id'] ) || ! class_exists( 'MP_Invoices' ) ) {
			return 0;
		}
		$amount = (int) round( self::amount( $c ) * $stages[ $i ]['pct'] / 100 );
		$id     = MP_Invoices::issue(
			array(
				'amount'       => $amount,
				'title'        => 'مرحله ' . MP_Jalali::digits( (string) ( $i + 1 ) ) . ' قرارداد ' . $c->number,
				'item'         => $stages[ $i ]['title'] . ' (' . MP_Jalali::digits( (string) $stages[ $i ]['pct'] ) . '٪ مبلغ قرارداد ' . $c->number . ')',
				'project_id'   => $c->project_id,
				'client_id'    => $c->client_id,
				'client_name'  => self::client_of( $c ),
				'client_phone' => self::phone_of( $c ),
				'note'         => 'بر اساس ماده شرایط پرداخت قرارداد ' . $c->number,
			)
		);
		if ( $id ) {
			$stages[ $i ]['invoice_id'] = $id;
			$wpdb->update( self::t(), array( 'stages' => wp_json_encode( $stages, JSON_UNESCAPED_UNICODE ) ), array( 'id' => $c->id ) );
		}
		return $id;
	}

	/** POST contracts/{id}/stage {index} — issue a stage's invoice now. */
	public static function issue_stage( WP_REST_Request $r ) {
		$c = self::get( (int) $r['id'] );
		if ( ! $c || 'signed' !== $c->status ) {
			return self::err( 'فاکتور مراحل بعد از امضای قرارداد صادر می‌شود.' );
		}
		if ( ! self::stage_invoice( $c, (int) $r['index'] ) ) {
			return self::err( 'فاکتور صادر نشد (مبلغ قرارداد یا نام مشتری را بررسی کنید، یا قبلاً صادر شده است).' );
		}
		return self::payload( self::get( $c->id ) );
	}

	/** A project milestone is done: issue the stages waiting on it. */
	public static function milestone_done( $mid ) {
		global $wpdb;
		if ( ! self::settings()['f_invoice'] ) {
			return;
		}
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . self::t() . " WHERE status = 'signed' AND archived_at IS NULL AND stages IS NOT NULL" ) as $c ) {
			foreach ( self::stages_of( $c ) as $i => $st ) {
				if ( 'milestone' === $st['on'] && (int) $st['milestone_id'] === (int) $mid && empty( $st['invoice_id'] ) ) {
					self::stage_invoice( self::get( $c->id ), $i );
				}
			}
		}
	}

	/** Every few minutes (cron): SMS reminders for unsigned contracts. */
	public static function tick() {
		global $wpdb;
		$s = self::settings();
		if ( ! $s['f_remind'] || get_transient( 'mp_contract_tick' ) ) {
			return;
		}
		set_transient( 'mp_contract_tick', 1, HOUR_IN_SECONDS );
		$h = (int) current_time( 'H' );
		if ( $h < 9 || $h >= 20 ) {
			return; // no texts at night
		}
		$gap  = gmdate( 'Y-m-d H:i:s', strtotime( MP_Util::now() . ' -' . (int) $s['remind_days'] . ' days' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE status = 'sent' AND archived_at IS NULL AND sent_at <= %s AND reminders_sent < %d AND (last_reminded_at IS NULL OR last_reminded_at <= %s) LIMIT 20", $gap, (int) $s['remind_max'], $gap ) );
		foreach ( $rows as $c ) {
			if ( self::expired( $c ) ) {
				continue;
			}
			$i  = self::next_signer( $c );
			$sg = $i >= 0 ? self::signers_of( $c )[ $i ] : null;
			$m  = $sg ? MP_Auth::normalize( $sg['mobile'] ) : '';
			if ( $m ) {
				MP_Auth::text( $m, $sg['name'] . ' عزیز، قرارداد «' . $c->title . '» از ' . $s['studio'] . ' منتظر امضای شماست' . ( $c->expires_at && $s['f_expiry'] ? ' (مهلت تا ' . MP_Jalali::format( $c->expires_at ) . ')' : '' ) . ': ' . self::url( $c->token ) );
			}
			$wpdb->update( self::t(), array( 'reminders_sent' => $c->reminders_sent + 1, 'last_reminded_at' => MP_Util::now() ), array( 'id' => $c->id ) );
		}
	}

	/* ------------------------------------------------------------------ Client signing */

	private static function otp_key( $c, $i ) {
		return 'mp_ksig_' . $c->id . '_' . $i;
	}

	/** Mobile the next signer's code goes to; for a single signer, the portal login is a fallback. */
	private static function signer_mobile( $c, $i ) {
		$list = self::signers_of( $c );
		$m    = isset( $list[ $i ]['mobile'] ) ? MP_Auth::normalize( $list[ $i ]['mobile'] ) : '';
		if ( ! $m && 1 === count( $list ) && $c->project_id ) {
			global $wpdb;
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", $c->project_id ) ) as $ch ) {
				$sess = MP_Client::session( $ch );
				if ( $sess ) {
					return $sess->mobile;
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

	/** The contract when it can be signed now, else an error. */
	private static function signable( $token ) {
		$c = self::by_token( $token );
		if ( ! $c || 'sent' !== $c->status ) {
			return self::err( 'این قرارداد برای امضا باز نیست.', 404 );
		}
		if ( self::expired( $c ) ) {
			return self::err( 'مهلت امضای این قرارداد تمام شده است؛ از تیم بخواهید آن را تمدید کند.' );
		}
		return $c;
	}

	/** POST contract/{token}/code — 5-digit code to the next signer's mobile. */
	public static function client_code( WP_REST_Request $r ) {
		$c = self::signable( $r['token'] );
		if ( is_wp_error( $c ) ) {
			return $c;
		}
		if ( ! self::need_otp() ) {
			return self::err( 'تأیید پیامکی فعال نیست.' );
		}
		$i      = self::next_signer( $c );
		$mobile = self::signer_mobile( $c, $i );
		if ( ! $mobile ) {
			return self::err( 'شماره موبایلی برای امضاکننده ثبت نشده؛ با تیم تماس بگیرید.' );
		}
		$state = get_transient( self::otp_key( $c, $i ) );
		$now   = time();
		if ( is_array( $state ) && $state['sent'] > $now - MP_Auth::RESEND_WAIT ) {
			return self::err( 'کد تازه ارسال شده؛ ' . MP_Jalali::digits( (string) ( MP_Auth::RESEND_WAIT - ( $now - $state['sent'] ) ) ) . ' ثانیه دیگر دوباره امتحان کنید.', 429 );
		}
		$code = (string) wp_rand( 10000, 99999 );
		set_transient( self::otp_key( $c, $i ), array( 'hash' => wp_hash( $mobile . '|' . $code ), 'exp' => $now + 300, 'tries' => 0, 'sent' => $now, 'mobile' => $mobile ), HOUR_IN_SECONDS );
		if ( defined( 'MP_TESTING' ) && MP_TESTING ) {
			$GLOBALS['mp_last_otp'] = $code;
		}
		if ( ! MP_Auth::send_code( $mobile, $code ) ) {
			return self::err( 'ارسال پیامک انجام نشد؛ کمی بعد دوباره امتحان کنید.', 502 );
		}
		return array( 'sent' => true, 'to' => self::mask( $mobile ), 'wait' => MP_Auth::RESEND_WAIT );
	}

	/** POST contract/{token}/sign {name, signature, code, agree, id_card?} — the next signer signs. */
	public static function client_sign( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::signable( $r['token'] );
		if ( is_wp_error( $c ) ) {
			return $c;
		}
		$set  = self::settings();
		$i    = self::next_signer( $c );
		$list = self::signers_of( $c );
		$name = MP_Util::text( $r['name'], 120 );
		$sig  = (string) $r['signature'];
		if ( empty( $r['agree'] ) || '' === $name ) {
			return self::err( 'نام خود را بنویسید و پذیرش مفاد قرارداد را تأیید کنید.' );
		}
		if ( ! self::valid_png( $sig ) ) {
			return self::err( 'امضای خود را در کادر بکشید.' );
		}
		$card = (string) $r['id_card'];
		if ( $set['f_idcard'] ) {
			if ( strlen( $card ) > 2500000 || ! preg_match( '#^data:image/jpeg;base64,[A-Za-z0-9+/=]+$#', $card ) ) {
				return self::err( 'تصویر کارت ملی را بارگذاری کنید.' );
			}
		} else {
			$card = '';
		}
		$mobile = '';
		$method = 'draw';
		if ( self::need_otp() ) {
			$state = get_transient( self::otp_key( $c, $i ) );
			if ( ! is_array( $state ) || empty( $state['hash'] ) || $state['exp'] < time() ) {
				return self::err( 'کد تأیید منقضی شده؛ کد جدید بگیرید.' );
			}
			$code = preg_replace( '/\D/', '', J_latin( (string) $r['code'] ) );
			if ( ! hash_equals( $state['hash'], wp_hash( $state['mobile'] . '|' . $code ) ) ) {
				++$state['tries'];
				if ( $state['tries'] >= MP_Auth::MAX_TRIES ) {
					$state['hash'] = '';
				}
				set_transient( self::otp_key( $c, $i ), $state, HOUR_IN_SECONDS );
				return self::err( 'کد تأیید درست نیست.' );
			}
			delete_transient( self::otp_key( $c, $i ) );
			$mobile = $state['mobile'];
			$method = 'otp';
		}
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 255 ) : '';
		$list[ $i ] = array_merge( $list[ $i ], array( 'name' => $name, 'mobile' => $mobile ? $mobile : ( isset( $list[ $i ]['mobile'] ) ? $list[ $i ]['mobile'] : '' ), 'signed_at' => MP_Util::now(), 'sig' => $sig, 'ip' => $ip, 'ua' => $ua, 'method' => $method, 'id_card' => $card ) );
		$f    = array( 'signers' => wp_json_encode( $list, JSON_UNESCAPED_UNICODE ), 'updated_at' => MP_Util::now() );
		$done = self::next_signer( (object) array_merge( (array) $c, array( 'signers' => $f['signers'] ) ) ) < 0;
		if ( $done ) {
			$names = implode( '، ', wp_list_pluck( $list, 'name' ) );
			$f    += array(
				'status'        => $c->studio_sig ? 'signed' : 'client_signed', // both sides must sign
				'signed_at'     => MP_Util::now(),
				'signer_name'   => $names,
				'signer_mobile' => $mobile,
				'signer_ip'     => $ip,
				'signer_ua'     => $ua,
				'sign_method'   => $method,
				'client_sig'    => $sig,
				'doc_hash'      => self::fingerprint( $c ),
			);
		}
		$wpdb->update( self::t(), $f, array( 'id' => $c->id ) );
		if ( ! $done ) {
			// Tell the next person in line.
			$n  = $list[ $i + 1 ];
			$nm = MP_Auth::normalize( isset( $n['mobile'] ) ? $n['mobile'] : '' );
			if ( $nm ) {
				MP_Auth::text( $nm, $n['name'] . ' عزیز، ' . $name . ' قرارداد «' . $c->title . '» را امضا کرد؛ نوبت امضای شماست: ' . self::url( $c->token ) );
			}
			MP_Client::system( 0, (int) $c->project_id, $name . ' قرارداد ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ' را امضا کرد؛ نوبت ' . $n['name'] . ' است.', array( 't' => 'contract', 'id' => (int) $c->id, 'url' => self::url( $c->token ) ) );
			return array( 'signed' => true, 'complete' => false );
		}
		MP_Audit::log( 'update', 'contract', $c->id, $c->number . ' امضای مشتری (' . $method . ')' );
		if ( 'client_signed' === $f['status'] ) {
			MP_Client::system( 0, (int) $c->project_id, 'قرارداد ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ' توسط ' . $f['signer_name'] . ' امضا شد؛ منتظر امضای مجری.', array( 't' => 'contract', 'id' => (int) $c->id, 'url' => self::url( $c->token ) ) );
			foreach ( MP_Util::panel_users() as $m ) {
				if ( MP_Util::is_manager( $m ) ) {
					MP_Notify::send( $m, 'contract', $f['signer_name'] . ' قرارداد ' . $c->number . ' را امضا کرد؛ نوبت امضای مجری است', $c->title, 'contracts', $c->id, true );
				}
			}
			return array( 'signed' => true, 'complete' => false, 'waiting_studio' => true );
		}
		self::completed( self::get( $c->id ) );
		return array( 'signed' => true, 'complete' => true, 'pdf' => (bool) $set['f_pdf'] );
	}

	/** Both sides have signed: announce, notify, and issue the stages due at signing. */
	private static function completed( $c ) {
		MP_Client::system( 0, (int) $c->project_id, 'قرارداد ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ' توسط هر دو طرف امضا شد ✓', array( 't' => 'contract', 'id' => (int) $c->id, 'url' => self::url( $c->token ) ) );
		foreach ( MP_Util::panel_users() as $m ) {
			if ( MP_Util::is_manager( $m ) ) {
				MP_Notify::send( $m, 'contract', 'قرارداد ' . $c->number . ' کامل امضا شد', $c->title, 'contracts', $c->id, true );
			}
		}
		if ( self::settings()['f_invoice'] ) {
			foreach ( self::stages_of( $c ) as $k => $st ) {
				if ( 'sign' === $st['on'] ) {
					self::stage_invoice( self::get( $c->id ), $k );
				}
			}
		}
	}

	/**
	 * POST contracts/{id}/studio-sign {signature} — the contractor signs (a manager, in the panel or on
	 * the contract page). Before or after the client; the contract is complete once both have.
	 */
	public static function studio_sign( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::get( (int) $r['id'] );
		if ( ! $c || ! in_array( $c->status, array( 'sent', 'client_signed', 'signed' ), true ) ) {
			return self::err( 'این قرارداد هنوز ارسال نشده یا لغو شده است.' );
		}
		if ( $c->studio_sig ) {
			return self::err( 'مجری قبلاً امضا کرده است.' );
		}
		$sig = (string) $r['signature'];
		if ( 'saved' === $sig ) {
			$sig = self::settings()['signature'];
		}
		if ( ! self::valid_png( $sig ) ) {
			return self::err( 'امضا را در کادر بکشید.' );
		}
		$f = array( 'studio_sig' => $sig, 'studio_signed_at' => MP_Util::now(), 'studio_signer' => get_current_user_id(), 'updated_at' => MP_Util::now() );
		$complete = 'client_signed' === $c->status;
		if ( $complete ) {
			$f['status'] = 'signed';
		}
		$wpdb->update( self::t(), $f, array( 'id' => $c->id ) );
		MP_Audit::log( 'update', 'contract', $c->id, $c->number . ' امضای مجری' );
		if ( $complete ) {
			self::completed( self::get( $c->id ) );
		}
		return self::payload( self::get( $c->id ) ) + array( 'complete' => $complete, 'pdf' => $complete && self::settings()['f_pdf'] );
	}

	/** POST contract/{token}/seen {pct} — opened / read this far (not counted for the team). */
	public static function client_seen( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::by_token( $r['token'] );
		if ( ! $c || ! self::settings()['f_track'] || 'draft' === $c->status || current_user_can( 'mp_access_panel' ) ) {
			return array( 'ok' => true );
		}
		$f = array( 'read_pct' => max( (int) $c->read_pct, min( 100, (int) $r['pct'] ) ) );
		if ( ! empty( $r['open'] ) ) {
			$f['views']          = (int) $c->views + 1;
			$f['last_viewed_at'] = MP_Util::now();
			if ( ! $c->first_viewed_at ) {
				$f['first_viewed_at'] = MP_Util::now();
				foreach ( MP_Util::panel_users() as $m ) {
					if ( MP_Util::is_manager( $m ) ) {
						MP_Notify::send( $m, 'contract', self::client_of( $c ) . ' قرارداد ' . $c->number . ' را باز کرد', $c->title, 'contracts', $c->id );
					}
				}
			}
		}
		$wpdb->update( self::t(), $f, array( 'id' => $c->id ) );
		return array( 'ok' => true );
	}

	/**
	 * POST contract/{token}/pdf {pdf: data URL} — the signed contract's PDF (made in the browser
	 * with the page's own rendering), stored once and put in the project's delivered files.
	 */
	public static function client_pdf( WP_REST_Request $r ) {
		global $wpdb;
		$c = self::by_token( $r['token'] );
		if ( ! $c || 'signed' !== $c->status || $c->pdf_file_id || ! self::settings()['f_pdf'] ) {
			return array( 'stored' => false );
		}
		// The signer's browser right after signing, or a manager later; nobody else.
		if ( ! current_user_can( 'mp_manage_panel' ) && strtotime( $c->signed_at ) < strtotime( MP_Util::now() ) - 30 * MINUTE_IN_SECONDS ) {
			return self::err( 'زمان ثبت PDF گذشته است.', 403 );
		}
		$data = (string) $r['pdf'];
		if ( strlen( $data ) > 14000000 || ! preg_match( '#^data:application/pdf;(?:filename=[^;]*;)?base64,([A-Za-z0-9+/=]+)$#', $data, $m ) ) {
			return self::err( 'فایل PDF معتبر نیست.' );
		}
		$bytes = base64_decode( $m[1], true );
		if ( ! $bytes || 0 !== strpos( $bytes, '%PDF' ) ) {
			return self::err( 'فایل PDF معتبر نیست.' );
		}
		$name = 'contract-' . $c->number . '.pdf';
		$file = MP_Files::store_bytes( 'client_item', (int) $c->project_id, $name, 'application/pdf', $bytes, 'pdf' );
		if ( ! $file ) {
			return self::err( 'ذخیره PDF انجام نشد.', 500 );
		}
		$wpdb->update( self::t(), array( 'pdf_file_id' => (int) $file->id ), array( 'id' => $c->id ) );
		if ( $c->project_id ) {
			// In the portal's delivered files (the project archive), and announced in the chat.
			$wpdb->insert(
				self::t( 'client_items' ),
				array(
					'project_id' => (int) $c->project_id,
					'kind'       => 'file',
					'title'      => ( 'amendment' === $c->kind ? 'الحاقیه' : 'قرارداد' ) . ' امضاشده ' . $c->number,
					'note'       => $c->title,
					'file_id'    => (int) $file->id,
					'version'    => 1,
					'parent_id'  => 0,
					'status'     => 'delivered',
					'created_by' => 0,
					'created_at' => MP_Util::now(),
				)
			);
			MP_Client::system( 0, (int) $c->project_id, 'نسخه PDF قرارداد امضاشده ' . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" . ' در فایل‌های پروژه قرار گرفت.', array( 't' => 'file', 'id' => (int) $wpdb->insert_id ) );
		}
		return array( 'stored' => true );
	}

	/** Contracts of a project for the client portal (never drafts). */
	public static function for_portal( $pid ) {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t() . " WHERE project_id = %d AND status IN ('sent','client_signed','signed') AND archived_at IS NULL ORDER BY id DESC", $pid ) ) as $c ) {
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
		$otp     = self::need_otp();
		$signers = self::signers_of( $c );
		$next    = self::next_signer( $c );
		$expired = self::expired( $c );
		$team    = current_user_can( 'mp_manage_panel' );
		$nonce   = is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '';
		$parent  = $c->parent_id ? self::get( $c->parent_id ) : null;
		// Contracts signed before multi-signer support keep their single signature.
		if ( 'signed' === $c->status && 1 === count( $signers ) && empty( $signers[0]['sig'] ) ) {
			$signers[0] = array_merge( $signers[0], array( 'name' => $c->signer_name, 'mobile' => $c->signer_mobile, 'signed_at' => $c->signed_at, 'sig' => $c->client_sig, 'ip' => $c->signer_ip, 'method' => $c->sign_method ) );
		}
		include MP_DIR . 'templates/contract.php';
		exit;
	}
}

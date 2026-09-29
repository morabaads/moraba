<?php
defined( 'ABSPATH' ) || exit;

/**
 * Invoices and pro-forma invoices (پیش‌فاکتور) for clients.
 *
 * - Each one belongs to a project (optional) and a client; items are rows of title × quantity × unit price,
 *   with discount and VAT. Amounts are in toman.
 * - The client gets a public link (?mp_invoice=token): a clean printable page with the pay button (the
 *   invoice's own payment link or the default one from settings) and card-to-card details. A pro-forma
 *   can be accepted by the client from that page; supervisors are notified.
 * - Marking an invoice paid adds an income row to accounting (linked to the project); un-marking removes it.
 * - «ارسال» posts the link into the project's client group, or copies/shares it.
 * Nothing is deleted: removing an invoice archives it.
 */
class MP_Invoices {

	const SETTINGS = 'mp_invoice_settings';
	const STATUS   = array( 'draft' => 'پیش‌نویس', 'sent' => 'ارسال‌شده', 'accepted' => 'تأییدشده توسط مشتری', 'paid' => 'پرداخت‌شده', 'cancelled' => 'لغوشده' );

	public static function register() {
		$m  = array( 'MP_Rest', 'can_manage' );
		$id = '(?P<id>\d+)';
		$routes = array(
			array( 'invoices', 'GET', 'index' ),
			array( 'invoices', 'POST', 'save' ),
			array( "invoices/$id", 'POST', 'save' ),
			array( "invoices/$id", 'DELETE', 'archive' ),
			array( "invoices/$id/status", 'POST', 'set_status' ),
			array( "invoices/$id/convert", 'POST', 'convert' ),
			array( "invoices/$id/send", 'POST', 'send' ),
			array( 'invoices/settings', 'POST', 'save_settings' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $m ) );
		}
	}

	private static function t() {
		return MP_Install::table( 'invoices' );
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_error', $m, array( 'status' => $s ) );
	}

	public static function settings() {
		$s = get_option( self::SETTINGS, array() );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array( 'seller' => 'مربع استودیو', 'seller_info' => '', 'pay_url' => '', 'card' => '', 'card_owner' => '', 'tax' => 0, 'footer' => 'با سپاس از اعتماد شما', 'gateway' => '', 'merchant' => '', 'sandbox' => false )
		);
	}

	public static function url( $token ) {
		return get_option( 'permalink_structure' ) ? home_url( '/i/' . $token . '/' ) : add_query_arg( 'mp_invoice', $token, home_url( '/' ) );
	}

	/** Items, subtotal, discount, VAT and total from raw input. */
	private static function compute( $items, $discount, $tax ) {
		$clean = array();
		$sub   = 0;
		foreach ( is_array( $items ) ? array_slice( $items, 0, 100 ) : array() as $it ) {
			$title = MP_Util::text( isset( $it['title'] ) ? $it['title'] : '', 200 );
			$qty   = max( 0, (float) str_replace( ',', '.', (string) ( isset( $it['qty'] ) ? $it['qty'] : 1 ) ) );
			$price = (int) preg_replace( '/\D/', '', (string) ( isset( $it['price'] ) ? $it['price'] : 0 ) );
			if ( '' === $title && ! $price ) {
				continue;
			}
			$line    = (int) round( $qty * $price );
			$sub    += $line;
			$clean[] = array( 'title' => $title, 'qty' => $qty, 'price' => $price, 'total' => $line );
		}
		$discount = min( $sub, max( 0, (int) preg_replace( '/\D/', '', (string) $discount ) ) );
		$tax      = max( 0, min( 100, (int) $tax ) );
		$vat      = (int) round( ( $sub - $discount ) * $tax / 100 );
		return array( $clean, $sub, $discount, $tax, $vat, $sub - $discount + $vat );
	}

	public static function payload( $x ) {
		$p     = $x->project_id ? $GLOBALS['wpdb']->get_var( $GLOBALS['wpdb']->prepare( 'SELECT name FROM ' . MP_Install::table( 'projects' ) . ' WHERE id = %d', $x->project_id ) ) : '';
		$items = json_decode( (string) $x->items, true );
		list( , $sub, $discount, $tax, $vat, $total ) = self::compute( $items, $x->discount, $x->tax_percent );
		return array(
			'id'           => (int) $x->id,
			'kind'         => $x->kind,
			'number'       => $x->number,
			'title'        => $x->title,
			'project_id'   => (int) $x->project_id,
			'project'      => (string) $p,
			'client_id'    => (int) $x->client_id,
			'client_name'  => $x->client_name,
			'client_phone' => $x->client_phone,
			'client_info'  => (string) $x->client_info,
			'items'        => is_array( $items ) ? $items : array(),
			'subtotal'     => $sub,
			'discount'     => $discount,
			'tax'          => $tax,
			'vat'          => $vat,
			'total'        => $total,
			'status'       => $x->status,
			'issue_date'   => $x->issue_date,
			'due_date'     => $x->due_date,
			'note'         => (string) $x->note,
			'pay_url'      => (string) $x->pay_url,
			'url'          => self::url( $x->token ),
			'ledger_id'    => (int) $x->ledger_id,
			'paid_at'      => $x->paid_at,
			'pay_gateway'  => (string) $x->pay_gateway,
			'pay_ref'      => (string) $x->pay_ref,
			'archived'     => ! empty( $x->archived_at ),
			'channels'     => self::client_channels( (int) $x->project_id ),
		);
	}

	/** Client groups of the project, for «send in the client group». */
	private static function client_channels( $pid ) {
		global $wpdb;
		if ( ! $pid ) {
			return array();
		}
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, title FROM ' . MP_Install::table( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", $pid ) ) as $c ) {
			$out[] = array( 'id' => (int) $c->id, 'title' => $c->title );
		}
		return $out;
	}

	private static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) );
	}

	/** GET invoices?archived=&project_id= */
	public static function index( WP_REST_Request $r ) {
		global $wpdb;
		$where = array( $r['archived'] ? 'archived_at IS NOT NULL' : 'archived_at IS NULL' );
		if ( (int) $r['project_id'] ) {
			$where[] = $wpdb->prepare( 'project_id = %d', (int) $r['project_id'] );
		}
		if ( (int) $r['client_id'] ) {
			$where[] = $wpdb->prepare( 'client_id = %d', (int) $r['client_id'] );
		}
		$rows = $wpdb->get_results( 'SELECT * FROM ' . self::t() . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY id DESC LIMIT 500' ); // phpcs:ignore
		return array( 'items' => array_map( array( __CLASS__, 'payload' ), $rows ), 'settings' => self::settings() );
	}

	private static function next_number( $kind ) {
		$year = MP_Jalali::from_iso( MP_Util::today() )[0];
		$key  = 'mp_invoice_seq_' . $kind . '_' . $year;
		$n    = (int) get_option( $key, 0 ) + 1;
		update_option( $key, $n, false );
		return ( 'proforma' === $kind ? 'PF-' : 'INV-' ) . $year . '-' . str_pad( (string) $n, 3, '0', STR_PAD_LEFT );
	}

	/** POST invoices[/id] {kind, title, project_id, client_name, client_phone, client_info, items, discount, tax, issue_date, due_date, note, pay_url} */
	public static function save( WP_REST_Request $r ) {
		global $wpdb;
		$id  = (int) $r['id'];
		$old = $id ? self::get( $id ) : null;
		if ( $id && ! $old ) {
			return self::err( 'فاکتور پیدا نشد.', 404 );
		}
		$cust   = (int) $r['client_id'] ? MP_Client::customer( (int) $r['client_id'] ) : null;
		$client = $cust ? $cust->name : MP_Util::text( $r['client_name'], 160 );
		if ( '' === $client ) {
			return self::err( 'مشتری را انتخاب کنید یا نام مشتری جدید را بنویسید.' );
		}
		list( $items, , $discount, $tax ) = self::compute( $r['items'], $r['discount'], null === $r['tax'] ? self::settings()['tax'] : $r['tax'] );
		if ( ! $items ) {
			return self::err( 'حداقل یک ردیف با مبلغ وارد کنید.' );
		}
		$issue = MP_Util::valid_date( $r['issue_date'] ) ? $r['issue_date'] : MP_Util::today();
		$due   = MP_Util::valid_date( $r['due_date'] ) ? $r['due_date'] : null;
		$pay   = esc_url_raw( (string) $r['pay_url'] );
		$row   = array(
			'title'        => MP_Util::text( $r['title'], 200 ),
			'project_id'   => (int) $r['project_id'],
			// An existing customer, or a new one made from the typed name; the project joins its projects.
			'client_id'    => MP_Client::customer_id( $client, $cust ? $cust->id : 0, (int) $r['project_id'], (string) $r['client_phone'], (string) $r['client_info'] ),
			'client_name'  => $client,
			'client_phone' => MP_Util::text( $r['client_phone'], 40 ),
			'client_info'  => MP_Util::long_text( $r['client_info'], 1000 ),
			'items'        => wp_json_encode( $items ),
			'discount'     => $discount,
			'tax_percent'  => $tax,
			'issue_date'   => $issue,
			'due_date'     => $due,
			'note'         => MP_Util::long_text( $r['note'], 2000 ),
			'pay_url'      => $pay,
			'updated_at'   => MP_Util::now(),
		);
		if ( $old ) {
			$wpdb->update( self::t(), $row, array( 'id' => $id ) );
			if ( 'paid' === $old->status ) {
				self::sync_ledger( self::get( $id ) );
			}
			MP_Audit::log( 'update', 'invoice', $id, $old->number . ' · ' . $client );
		} else {
			$kind = 'proforma' === $r['kind'] ? 'proforma' : 'invoice';
			$wpdb->insert(
				self::t(),
				$row + array(
					'kind'       => $kind,
					'number'     => self::next_number( $kind ),
					'status'     => 'draft',
					'token'      => wp_generate_password( 32, false, false ),
					'created_by' => get_current_user_id(),
					'created_at' => MP_Util::now(),
				)
			);
			$id = (int) $wpdb->insert_id;
			MP_Audit::log( 'create', 'invoice', $id, ( 'proforma' === $kind ? 'پیش‌فاکتور ' : 'فاکتور ' ) . self::get( $id )->number . ' · ' . $client );
		}
		return self::payload( self::get( $id ) );
	}

	/** Income row in accounting for a paid invoice (created or kept in step with the invoice). */
	private static function sync_ledger( $x ) {
		global $wpdb;
		$p     = self::payload( $x );
		$lt    = MP_Install::table( 'ledger' );
		$title = 'فاکتور ' . $x->number . ' — ' . $x->client_name;
		$row   = array( 'amount' => max( 0, $p['total'] ), 'title' => MP_Util::text( $title, 200 ), 'project_id' => (int) $x->project_id );
		if ( $x->ledger_id && $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $lt WHERE id = %d", $x->ledger_id ) ) ) { // phpcs:ignore
			$wpdb->update( $lt, $row, array( 'id' => $x->ledger_id ) );
			return (int) $x->ledger_id;
		}
		$wpdb->insert(
			$lt,
			$row + array(
				'type'       => 'income',
				'note'       => $x->title,
				'category'   => 'فاکتور',
				'entry_date' => MP_Util::today(),
				'entry_time' => current_time( 'H:i' ),
				'user_id'    => get_current_user_id(),
				'created_at' => MP_Util::now(),
			)
		);
		$lid = (int) $wpdb->insert_id;
		$wpdb->update( self::t(), array( 'ledger_id' => $lid ), array( 'id' => $x->id ) );
		return $lid;
	}

	/** POST invoices/{id}/status {status} — «paid» books the income, leaving «paid» takes it back out. */
	public static function set_status( WP_REST_Request $r ) {
		global $wpdb;
		$x      = self::get( (int) $r['id'] );
		$status = MP_Util::pick( $r['status'], array_keys( self::STATUS ), '' );
		if ( ! $x || ! $status ) {
			return self::err( 'فاکتور یا وضعیت معتبر نیست.' );
		}
		if ( 'paid' === $status && 'proforma' === $x->kind ) {
			return self::err( 'پیش‌فاکتور پرداخت نمی‌شود؛ اول آن را به فاکتور تبدیل کنید.' );
		}
		$f = array( 'status' => $status, 'updated_at' => MP_Util::now() );
		if ( 'paid' === $status && 'paid' !== $x->status ) {
			self::mark_paid( $x );
		} else {
			if ( 'sent' === $status && 'draft' === $x->status ) {
				self::announce( $x );
			}
			if ( 'paid' !== $status && 'paid' === $x->status && $x->ledger_id ) {
				$wpdb->delete( MP_Install::table( 'ledger' ), array( 'id' => $x->ledger_id ) );
				$f['ledger_id'] = 0;
				$f['paid_at']   = null;
			}
			$wpdb->update( self::t(), $f, array( 'id' => $x->id ) );
		}
		MP_Audit::log( 'update', 'invoice', $x->id, $x->number . ' → ' . self::STATUS[ $status ] );
		return self::payload( self::get( $x->id ) );
	}

	/** Paid: status, income row in accounting, a card in the client chat. $ref: gateway reference. */
	private static function mark_paid( $x, $gateway = '', $ref = '' ) {
		global $wpdb;
		$f = array( 'status' => 'paid', 'paid_at' => MP_Util::now(), 'updated_at' => MP_Util::now() );
		if ( $gateway ) {
			$f['pay_gateway'] = $gateway;
			$f['pay_ref']     = substr( (string) $ref, 0, 80 );
		}
		$wpdb->update( self::t(), $f, array( 'id' => $x->id ) );
		self::sync_ledger( self::get( $x->id ) );
		MP_Client::system( 0, (int) $x->project_id, 'پرداخت فاکتور ' . MP_Jalali::digits( (string) $x->number ) . ' ثبت شد' . ( $ref ? ' (کد پیگیری ' . MP_Jalali::digits( (string) $ref ) . ')' : '' ) . '. سپاس از شما 🌱', array( 't' => 'invoice', 'k' => 'invoice', 'id' => (int) $x->id, 'url' => self::url( $x->token ) ) );
	}

	/* ------------------------------------------------------------------ Online payment (Zibal / ZarinPal) */

	const GATEWAYS = array( 'zibal' => 'زیبال', 'zarinpal' => 'زرین‌پال' );

	/** Gateway in use, or '' when online payment is off. */
	public static function gateway() {
		$s = self::settings();
		return $s['gateway'] && ( $s['merchant'] || $s['sandbox'] ) ? $s['gateway'] : '';
	}

	private static function post_json( $url, $body ) {
		$res = wp_remote_post( $url, array( 'timeout' => 25, 'headers' => array( 'Content-Type' => 'application/json', 'Accept' => 'application/json' ), 'body' => wp_json_encode( $body ) ) );
		if ( is_wp_error( $res ) ) {
			return null;
		}
		$d = json_decode( wp_remote_retrieve_body( $res ), true );
		return is_array( $d ) ? $d : null;
	}

	/** Sends the client to the gateway; returns an error message when it could not start. */
	private static function start_payment( $x ) {
		global $wpdb;
		$s      = self::settings();
		$gw     = self::gateway();
		$p      = self::payload( $x );
		$rial   = (int) $p['total'] * 10; // invoices are in toman, gateways take rial
		$cb     = add_query_arg( 'mp_cb', $gw, self::url( $x->token ) );
		$desc   = 'فاکتور ' . $x->number . ' — ' . $s['seller'];
		$mobile = MP_Auth::normalize( $x->client_phone );
		if ( $rial < 10000 ) {
			return 'مبلغ این فاکتور برای پرداخت آنلاین کم است.';
		}
		if ( 'zibal' === $gw ) {
			$d = self::post_json( 'https://gateway.zibal.ir/v1/request', array_filter( array( 'merchant' => $s['sandbox'] ? 'zibal' : $s['merchant'], 'amount' => $rial, 'callbackUrl' => $cb, 'description' => $desc, 'orderId' => $x->number . '-' . time(), 'mobile' => $mobile ) ) );
			if ( ! $d || 100 !== (int) ( isset( $d['result'] ) ? $d['result'] : 0 ) ) {
				return 'درگاه زیبال پاسخ نداد' . ( $d && isset( $d['message'] ) ? ': ' . $d['message'] : '' ) . '.';
			}
			$track = (string) $d['trackId'];
			$go    = 'https://gateway.zibal.ir/start/' . rawurlencode( $track );
		} else {
			$host = $s['sandbox'] ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
			$d    = self::post_json( $host . '/pg/v4/payment/request.json', array( 'merchant_id' => $s['sandbox'] && ! $s['merchant'] ? '00000000-0000-0000-0000-000000000000' : $s['merchant'], 'amount' => $rial, 'currency' => 'IRR', 'callback_url' => $cb, 'description' => $desc, 'metadata' => array_filter( array( 'mobile' => $mobile, 'order_id' => $x->number ) ) ) );
			if ( ! $d || empty( $d['data']['authority'] ) || 100 !== (int) $d['data']['code'] ) {
				return 'درگاه زرین‌پال پاسخ نداد' . ( $d && ! empty( $d['errors']['message'] ) ? ': ' . $d['errors']['message'] : '' ) . '.';
			}
			$track = (string) $d['data']['authority'];
			$go    = $host . '/pg/StartPay/' . rawurlencode( $track );
		}
		$wpdb->update( self::t(), array( 'pay_gateway' => $gw, 'pay_track' => $track ), array( 'id' => $x->id ) );
		wp_redirect( $go ); // phpcs:ignore WordPress.Security.SafeRedirect -- the gateway's own host
		exit;
	}

	/** Back from the gateway: verify with the gateway (never trust the query alone), then book it. */
	private static function verify_payment( $x, $gw ) {
		$s    = self::settings();
		$p    = self::payload( $x );
		$rial = (int) $p['total'] * 10;
		$ok   = false;
		$ref  = '';
		if ( 'zibal' === $gw ) {
			$track = isset( $_GET['trackId'] ) ? sanitize_text_field( wp_unslash( $_GET['trackId'] ) ) : ''; // phpcs:ignore
			if ( $track && hash_equals( (string) $x->pay_track, $track ) && ! empty( $_GET['success'] ) ) { // phpcs:ignore
				$d = self::post_json( 'https://gateway.zibal.ir/v1/verify', array( 'merchant' => $s['sandbox'] ? 'zibal' : $s['merchant'], 'trackId' => $track ) );
				// 100 = verified now, 201 = verified before.
				$ok  = $d && in_array( (int) $d['result'], array( 100, 201 ), true ) && ( ! isset( $d['amount'] ) || (int) $d['amount'] === $rial );
				$ref = $d && isset( $d['refNumber'] ) ? (string) $d['refNumber'] : $track;
			}
		} elseif ( 'zarinpal' === $gw ) {
			$auth = isset( $_GET['Authority'] ) ? sanitize_text_field( wp_unslash( $_GET['Authority'] ) ) : ''; // phpcs:ignore
			if ( $auth && hash_equals( (string) $x->pay_track, $auth ) && isset( $_GET['Status'] ) && 'OK' === $_GET['Status'] ) { // phpcs:ignore
				$host = $s['sandbox'] ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
				$d    = self::post_json( $host . '/pg/v4/payment/verify.json', array( 'merchant_id' => $s['sandbox'] && ! $s['merchant'] ? '00000000-0000-0000-0000-000000000000' : $s['merchant'], 'amount' => $rial, 'authority' => $auth ) );
				// 100 = verified now, 101 = verified before.
				$ok  = $d && isset( $d['data']['code'] ) && in_array( (int) $d['data']['code'], array( 100, 101 ), true );
				$ref = $ok && isset( $d['data']['ref_id'] ) ? (string) $d['data']['ref_id'] : '';
			}
		}
		if ( $ok && 'paid' !== $x->status ) {
			self::mark_paid( $x, $gw, $ref );
			foreach ( MP_Util::panel_users() as $m ) {
				if ( MP_Util::is_manager( $m ) ) {
					MP_Notify::send( $m, 'invoice', $x->client_name . ' فاکتور ' . $x->number . ' را آنلاین پرداخت کرد', MP_Jalali::digits( number_format( $p['total'] ) ) . ' تومان · ' . self::GATEWAYS[ $gw ] . ( $ref ? ' · کد پیگیری ' . $ref : '' ), 'invoices', $x->id, true );
				}
			}
			MP_Audit::log( 'update', 'invoice', $x->id, $x->number . ' پرداخت آنلاین ' . $gw . ' ' . $ref );
		}
		wp_safe_redirect( add_query_arg( $ok ? 'mp_paid' : 'mp_failed', 1, self::url( $x->token ) ) );
		exit;
	}

	/** POST invoices/{id}/convert — a new invoice from a pro-forma (the pro-forma stays, marked accepted). */
	public static function convert( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x || 'proforma' !== $x->kind ) {
			return self::err( 'فقط پیش‌فاکتور به فاکتور تبدیل می‌شود.' );
		}
		$row = (array) $x;
		unset( $row['id'], $row['ledger_id'], $row['paid_at'], $row['archived_at'] );
		$row = array_merge( $row, array( 'kind' => 'invoice', 'number' => self::next_number( 'invoice' ), 'status' => 'draft', 'issue_date' => MP_Util::today(), 'token' => wp_generate_password( 32, false, false ), 'created_by' => get_current_user_id(), 'created_at' => MP_Util::now(), 'updated_at' => MP_Util::now(), 'note' => trim( $x->note . "\nبر اساس پیش‌فاکتور " . $x->number ) ) );
		$wpdb->insert( self::t(), $row );
		$id = (int) $wpdb->insert_id;
		if ( 'draft' === $x->status || 'sent' === $x->status ) {
			$wpdb->update( self::t(), array( 'status' => 'accepted' ), array( 'id' => $x->id ) );
		}
		MP_Audit::log( 'create', 'invoice', $id, 'فاکتور ' . $row['number'] . ' از پیش‌فاکتور ' . $x->number );
		return self::payload( self::get( $id ) );
	}

	/** DELETE invoices/{id} — archive (or bring back with ?restore=1). */
	public static function archive( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x ) {
			return self::err( 'فاکتور پیدا نشد.', 404 );
		}
		$wpdb->update( self::t(), array( 'archived_at' => $r['restore'] ? null : MP_Util::now() ), array( 'id' => $x->id ) );
		MP_Audit::log( $r['restore'] ? 'restore' : 'archive', 'invoice', $x->id, $x->number );
		return self::payload( self::get( $x->id ) );
	}

	/**
	 * Issues an invoice from elsewhere (a contract's payment stage): created, marked sent and
	 * announced in the client chat. Returns the invoice id (0 on failure).
	 */
	public static function issue( $a ) {
		global $wpdb;
		$amount = (int) $a['amount'];
		if ( $amount <= 0 || '' === trim( (string) $a['client_name'] ) ) {
			return 0;
		}
		$items = array( array( 'title' => MP_Util::text( $a['item'], 200 ), 'qty' => 1, 'price' => $amount, 'total' => $amount ) );
		$wpdb->insert(
			self::t(),
			array(
				'kind'         => 'invoice',
				'number'       => self::next_number( 'invoice' ),
				'title'        => MP_Util::text( $a['title'], 200 ),
				'project_id'   => (int) $a['project_id'],
				'client_id'    => (int) $a['client_id'],
				'client_name'  => MP_Util::text( $a['client_name'], 160 ),
				'client_phone' => MP_Util::text( isset( $a['client_phone'] ) ? $a['client_phone'] : '', 40 ),
				'client_info'  => '',
				'items'        => wp_json_encode( $items ),
				'discount'     => 0,
				'tax_percent'  => 0,
				'status'       => 'draft',
				'issue_date'   => MP_Util::today(),
				'due_date'     => gmdate( 'Y-m-d', strtotime( MP_Util::today() . ' +7 days UTC' ) ),
				'note'         => MP_Util::long_text( isset( $a['note'] ) ? $a['note'] : '', 2000 ),
				'pay_url'      => '',
				'token'        => wp_generate_password( 32, false, false ),
				'created_by'   => get_current_user_id(),
				'created_at'   => MP_Util::now(),
				'updated_at'   => MP_Util::now(),
			)
		);
		$id = (int) $wpdb->insert_id;
		if ( ! $id ) {
			return 0;
		}
		$x = self::get( $id );
		self::announce( $x );
		$wpdb->update( self::t(), array( 'status' => 'sent' ), array( 'id' => $id ) );
		MP_Audit::log( 'create', 'invoice', $id, $x->number . ' · ' . $x->title );
		return $id;
	}

	public static function status_of( $id ) {
		$x = self::get( (int) $id );
		return $x ? array( 'id' => (int) $x->id, 'number' => $x->number, 'status' => $x->status, 'url' => self::url( $x->token ) ) : null;
	}

	/** System card in the client chat with the invoice link. */
	private static function announce( $x, $channel_id = 0 ) {
		$p = self::payload( $x );
		return MP_Client::system(
			$channel_id,
			$channel_id ? 0 : (int) $x->project_id,
			( 'proforma' === $x->kind ? 'پیش‌فاکتور ' : 'فاکتور ' ) . MP_Jalali::digits( (string) $x->number ) . ( $x->title ? ' — ' . $x->title : '' ) . ' صادر شد. مبلغ: ' . MP_Jalali::digits( number_format( $p['total'] ) ) . ' تومان',
			array( 't' => 'invoice', 'k' => $x->kind, 'id' => (int) $x->id, 'url' => $p['url'] )
		);
	}

	/** POST invoices/{id}/send {channel_id} — posts the link in a client group; a draft becomes «sent». */
	public static function send( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x ) {
			return self::err( 'فاکتور پیدا نشد.', 404 );
		}
		$cid = (int) $r['channel_id'];
		if ( $cid && ! MP_Rest::can_read_channel( $cid ) ) {
			return self::err( 'به این گروه دسترسی ندارید.', 403 );
		}
		// Chosen group: always. Otherwise the first time it is issued, in every client group of the project.
		if ( $cid || 'draft' === $x->status ) {
			self::announce( $x, $cid );
		}
		if ( 'draft' === $x->status ) {
			$wpdb->update( self::t(), array( 'status' => 'sent', 'updated_at' => MP_Util::now() ), array( 'id' => $x->id ) );
		}
		return self::payload( self::get( $x->id ) );
	}

	public static function save_settings( WP_REST_Request $r ) {
		$s = array(
			'seller'      => MP_Util::text( $r['seller'], 160 ),
			'seller_info' => MP_Util::long_text( $r['seller_info'], 1000 ),
			'pay_url'     => esc_url_raw( (string) $r['pay_url'] ),
			'card'        => preg_replace( '/[^\d\- ]/', '', MP_Util::text( strtr( (string) $r['card'], array( '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9' ) ), 40 ) ),
			'card_owner'  => MP_Util::text( $r['card_owner'], 120 ),
			'tax'         => max( 0, min( 100, (int) $r['tax'] ) ),
			'footer'      => MP_Util::text( $r['footer'], 300 ),
			'gateway'     => MP_Util::pick( $r['gateway'], array( '', 'zibal', 'zarinpal' ), '' ),
			'merchant'    => preg_replace( '/[^A-Za-z0-9\-]/', '', (string) $r['merchant'] ),
			'sandbox'     => ! empty( $r['sandbox'] ) && 'false' !== $r['sandbox'],
		);
		if ( $s['gateway'] && '' === $s['merchant'] && ! $s['sandbox'] ) {
			return self::err( 'کد مرچنت درگاه را وارد کنید (یا حالت آزمایشی را روشن کنید).' );
		}
		update_option( self::SETTINGS, $s, false );
		return self::settings();
	}

	/* ------------------------------------------------------------------ Public page for the client */

	public static function render_public( $token ) {
		global $wpdb;
		$x = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE token = %s AND archived_at IS NULL', $token ) );
		if ( ! $x ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		// A pro-forma accepted by the client.
		if ( 'POST' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) && ! empty( $_POST['mp_accept'] ) && 'proforma' === $x->kind && in_array( $x->status, array( 'draft', 'sent' ), true ) ) { // phpcs:ignore
			$wpdb->update( self::t(), array( 'status' => 'accepted', 'updated_at' => MP_Util::now() ), array( 'id' => $x->id ) );
			MP_Client::system( 0, (int) $x->project_id, 'پیش‌فاکتور ' . MP_Jalali::digits( (string) $x->number ) . ' توسط ' . $x->client_name . ' تأیید شد.', array( 't' => 'invoice', 'k' => 'proforma', 'id' => (int) $x->id, 'url' => self::url( $x->token ) ) );
			foreach ( MP_Util::panel_users() as $m ) {
				if ( MP_Util::is_manager( $m ) ) {
					MP_Notify::send( $m, 'invoice', $x->client_name . ' پیش‌فاکتور ' . $x->number . ' را تأیید کرد', $x->title, 'invoices', $x->id, true );
				}
			}
			wp_safe_redirect( self::url( $token ) );
			exit;
		}
		$payable = 'invoice' === $x->kind && ! in_array( $x->status, array( 'paid', 'cancelled' ), true );
		$gw      = self::gateway();
		$pay_err = '';
		if ( isset( $_GET['mp_cb'] ) && isset( self::GATEWAYS[ $_GET['mp_cb'] ] ) ) { // phpcs:ignore
			self::verify_payment( $x, sanitize_key( $_GET['mp_cb'] ) ); // phpcs:ignore
		}
		if ( $payable && $gw && 'POST' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) && ! empty( $_POST['mp_pay'] ) ) { // phpcs:ignore
			$pay_err = self::start_payment( $x );
		}
		$p   = self::payload( $x );
		$s   = self::settings();
		$pay = $p['pay_url'] ? $p['pay_url'] : $s['pay_url'];
		$fa  = function ( $n ) {
			return MP_Jalali::digits( number_format( (float) $n ) );
		};
		$kind = 'proforma' === $x->kind ? 'پیش‌فاکتور' : 'فاکتور';
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		?><!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title><?php echo esc_html( $kind . ' ' . $x->number . ' — ' . $s['seller'] ); ?></title>
<style>
@font-face{font-family:Dana;src:url(<?php echo esc_url( MP_URL . 'assets/fonts/dana.woff2' ); ?>) format('woff2');font-weight:10 990}
:root{--ink:#161616;--muted:#6b6b6b;--line:#ececec;--brand:#f28a24;--bg:#f6f5f3;--ok:#1f7a45}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:14px/1.9 Dana,Tahoma,sans-serif;color:var(--ink)}
.wrap{max-width:820px;margin:32px auto;padding:0 16px}
.sheet{background:#fff;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,.06);padding:36px 40px;position:relative;overflow:hidden}
.sheet:before{content:'';position:absolute;inset:0 0 auto 0;height:6px;background:var(--brand)}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:26px}
header img{height:36px}h1{margin:0;font-size:22px}.num{color:var(--muted);font-size:13px}
.badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:700;background:#fff3e6;color:#b45f0a;margin-top:6px}
.badge.paid{background:#e7f6ed;color:var(--ok)}.badge.accepted{background:#e8f0ff;color:#2f5bd3}.badge.cancelled{background:#fdecec;color:#b33}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.box{background:var(--bg);border-radius:16px;padding:14px 18px}.box small{color:var(--muted);display:block}.box strong{font-size:15px}.box p{margin:4px 0 0;white-space:pre-line;font-size:13px;color:#444}
table{width:100%;border-collapse:collapse;margin-bottom:18px}th{font-size:12px;color:var(--muted);font-weight:700;text-align:right;padding:8px 10px;border-bottom:2px solid var(--line)}
td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}td.n{white-space:nowrap;text-align:left;font-variant-numeric:tabular-nums}th.n{text-align:left}
.sum{margin-inline-start:auto;width:min(340px,100%)}.sum div{display:flex;justify-content:space-between;padding:5px 0;font-size:13px}.sum .total{border-top:2px solid var(--ink);margin-top:6px;padding-top:10px;font-size:18px;font-weight:800}
.note{margin-top:20px;font-size:13px;color:#444;white-space:pre-line}
.pay{margin-top:26px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:14px;padding:13px 26px;font:inherit;font-weight:800;font-size:15px;cursor:pointer;text-decoration:none}
.btn-pay{background:var(--brand);color:#fff}.btn-ghost{background:var(--bg);color:var(--ink)}.btn-ok{background:var(--ok);color:#fff}
.card{margin-top:16px;padding:14px 18px;border:1px dashed #d8d8d8;border-radius:16px;font-size:13px}.card b{direction:ltr;display:inline-block;letter-spacing:1px;font-size:16px}
footer{text-align:center;color:var(--muted);font-size:12px;margin-top:22px}
.alert{padding:14px 18px;border-radius:16px;margin-bottom:14px;font-weight:700}.alert.ok{background:#e7f6ed;color:var(--ok)}.alert.bad{background:#fdecec;color:#b33}
.btn-pay{flex-direction:column;align-items:flex-start;gap:0;line-height:1.5}.btn-pay .gw{font-size:11px;font-weight:600;opacity:.85}
@media (max-width:600px){.sheet{padding:26px 18px}.parties{grid-template-columns:1fr}th:nth-child(2),td:nth-child(2){display:none}}
@media print{body{background:#fff}.wrap{margin:0;max-width:none}.sheet{box-shadow:none;border-radius:0;padding:0}.pay,.noprint{display:none!important}}
</style></head><body><div class="wrap">
<?php if ( isset( $_GET['mp_paid'] ) && 'paid' === $x->status ) : // phpcs:ignore ?><div class="alert ok noprint">✓ پرداخت با موفقیت انجام شد<?php echo $x->pay_ref ? ' · کد پیگیری ' . esc_html( MP_Jalali::digits( $x->pay_ref ) ) : ''; ?>. سپاس از شما!</div><?php endif; ?>
<?php if ( isset( $_GET['mp_failed'] ) && 'paid' !== $x->status ) : // phpcs:ignore ?><div class="alert bad noprint">پرداخت انجام نشد یا لغو شد. اگر مبلغی کم شده، طی ۷۲ ساعت به حسابتان برمی‌گردد. می‌توانید دوباره تلاش کنید.</div><?php endif; ?>
<?php if ( $pay_err ) : ?><div class="alert bad noprint"><?php echo esc_html( $pay_err ); ?></div><?php endif; ?>
<div class="sheet">
<header><div><h1><?php echo esc_html( $kind ); ?><?php echo $x->title ? ' — ' . esc_html( $x->title ) : ''; ?></h1>
<div class="num"><?php echo esc_html( $x->number ); ?> · تاریخ <?php echo esc_html( MP_Jalali::format( $x->issue_date ) ); ?><?php echo $x->due_date ? ' · مهلت پرداخت ' . esc_html( MP_Jalali::format( $x->due_date ) ) : ''; ?></div>
<span class="badge <?php echo esc_attr( $x->status ); ?>"><?php echo esc_html( 'paid' === $x->status ? 'پرداخت شد' : self::STATUS[ $x->status ] ); ?></span></div>
<img src="<?php echo esc_url( MP_URL . 'assets/img/logo.png' ); ?>" alt="<?php echo esc_attr( $s['seller'] ); ?>"></header>
<div class="parties">
<div class="box"><small>فروشنده</small><strong><?php echo esc_html( $s['seller'] ); ?></strong><?php echo $s['seller_info'] ? '<p>' . esc_html( $s['seller_info'] ) . '</p>' : ''; ?></div>
<div class="box"><small>خریدار</small><strong><?php echo esc_html( $x->client_name ); ?></strong><?php echo ( $x->client_phone || $x->client_info ) ? '<p>' . esc_html( trim( MP_Jalali::digits( $x->client_phone ) . "\n" . $x->client_info ) ) . '</p>' : ''; ?><?php echo $p['project'] ? '<p>پروژه: ' . esc_html( $p['project'] ) . '</p>' : ''; ?></div>
</div>
<table><thead><tr><th>شرح</th><th class="n">تعداد</th><th class="n">مبلغ واحد</th><th class="n">مبلغ کل</th></tr></thead><tbody>
<?php foreach ( $p['items'] as $it ) : ?>
<tr><td><?php echo esc_html( $it['title'] ); ?></td><td class="n"><?php echo esc_html( MP_Jalali::digits( rtrim( rtrim( number_format( (float) $it['qty'], 2, '.', '' ), '0' ), '.' ) ) ); ?></td><td class="n"><?php echo esc_html( $fa( $it['price'] ) ); ?></td><td class="n"><?php echo esc_html( $fa( $it['total'] ) ); ?></td></tr>
<?php endforeach; ?>
</tbody></table>
<div class="sum">
<div><span>جمع</span><span><?php echo esc_html( $fa( $p['subtotal'] ) ); ?> تومان</span></div>
<?php if ( $p['discount'] ) : ?><div><span>تخفیف</span><span>− <?php echo esc_html( $fa( $p['discount'] ) ); ?> تومان</span></div><?php endif; ?>
<?php if ( $p['tax'] ) : ?><div><span>مالیات بر ارزش افزوده (<?php echo esc_html( MP_Jalali::digits( $p['tax'] ) ); ?>٪)</span><span><?php echo esc_html( $fa( $p['vat'] ) ); ?> تومان</span></div><?php endif; ?>
<div class="total"><span>مبلغ قابل پرداخت</span><span><?php echo esc_html( $fa( $p['total'] ) ); ?> تومان</span></div>
</div>
<?php if ( $x->note ) : ?><div class="note"><?php echo esc_html( $x->note ); ?></div><?php endif; ?>
<?php if ( 'paid' !== $x->status && 'cancelled' !== $x->status ) : ?>
<div class="pay">
<?php if ( 'proforma' === $x->kind && in_array( $x->status, array( 'draft', 'sent' ), true ) ) : ?>
<form method="post"><input type="hidden" name="mp_accept" value="1"><button class="btn btn-ok" type="submit">تأیید پیش‌فاکتور</button></form>
<?php elseif ( $payable && $gw ) : ?>
<form method="post"><input type="hidden" name="mp_pay" value="1"><button class="btn btn-pay" type="submit">پرداخت آنلاین <?php echo esc_html( $fa( $p['total'] ) ); ?> تومان<small class="gw">درگاه امن <?php echo esc_html( self::GATEWAYS[ $gw ] ); ?></small></button></form>
<?php elseif ( 'invoice' === $x->kind && $pay ) : ?>
<a class="btn btn-pay" href="<?php echo esc_url( $pay ); ?>" target="_blank" rel="noopener">پرداخت <?php echo esc_html( $fa( $p['total'] ) ); ?> تومان</a>
<?php endif; ?>
<button class="btn btn-ghost" type="button" onclick="window.print()">چاپ / PDF</button>
</div>
<?php if ( 'invoice' === $x->kind && $s['card'] ) : ?>
<div class="card noprint">پرداخت کارت به کارت: <b><?php echo esc_html( $s['card'] ); ?></b><?php echo $s['card_owner'] ? ' به نام ' . esc_html( $s['card_owner'] ) : ''; ?> — لطفاً پس از واریز رسید را در گروه پروژه بفرستید.</div>
<?php endif; ?>
<?php else : ?>
<div class="pay"><button class="btn btn-ghost" type="button" onclick="window.print()">چاپ / PDF</button></div>
<?php endif; ?>
<?php if ( $s['footer'] ) : ?><footer><?php echo esc_html( $s['footer'] ); ?></footer><?php endif; ?>
</div></div></body></html>
		<?php
		exit;
	}
}


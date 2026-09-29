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
			array( 'seller' => 'مربع استودیو', 'seller_info' => '', 'pay_url' => '', 'card' => '', 'card_owner' => '', 'tax' => 0, 'footer' => 'با سپاس از اعتماد شما' )
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
		$client = MP_Util::text( $r['client_name'], 160 );
		if ( '' === $client ) {
			return self::err( 'نام مشتری را وارد کنید.' );
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
			$f['paid_at'] = MP_Util::now();
			$wpdb->update( self::t(), $f, array( 'id' => $x->id ) );
			self::sync_ledger( self::get( $x->id ) );
		} else {
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

	/** POST invoices/{id}/send {channel_id} — posts the link in a client group; a draft becomes «sent». */
	public static function send( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x ) {
			return self::err( 'فاکتور پیدا نشد.', 404 );
		}
		$p = self::payload( $x );
		if ( (int) $r['channel_id'] ) {
			$msg = new WP_REST_Request( 'POST' );
			$msg->set_param( 'id', (int) $r['channel_id'] );
			$msg->set_param( 'body', ( 'proforma' === $x->kind ? 'پیش‌فاکتور ' : 'فاکتور ' ) . $x->number . ( $x->title ? ' — ' . $x->title : '' ) . "\nمبلغ: " . MP_Jalali::digits( number_format( $p['total'] ) ) . " تومان\n" . $p['url'] );
			$res = MP_Rest::send_message( $msg );
			if ( is_wp_error( $res ) ) {
				return $res;
			}
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
		);
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
			foreach ( MP_Util::panel_users() as $m ) {
				if ( MP_Util::is_manager( $m ) ) {
					MP_Notify::send( $m, 'invoice', $x->client_name . ' پیش‌فاکتور ' . $x->number . ' را تأیید کرد', $x->title, 'invoices', $x->id, true );
				}
			}
			wp_safe_redirect( self::url( $token ) );
			exit;
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
@media (max-width:600px){.sheet{padding:26px 18px}.parties{grid-template-columns:1fr}th:nth-child(2),td:nth-child(2){display:none}}
@media print{body{background:#fff}.wrap{margin:0;max-width:none}.sheet{box-shadow:none;border-radius:0;padding:0}.pay,.noprint{display:none!important}}
</style></head><body><div class="wrap"><div class="sheet">
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


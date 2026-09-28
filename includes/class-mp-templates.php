<?php
defined( 'ABSPATH' ) || exit;

/**
 * Task templates: a named list of steps («شروع پروژه جدید» → brief, moodboard, sketches, …).
 * Each step has a title, a day offset from the start date, optional time, priority, checklist and a
 * role (e.g. «طراح»). Applying a template maps roles to people and produces normal tasks through
 * tasks/bulk, so locking, notifications and history work as for hand-made tasks. Supervisors only.
 */
class MP_Templates {

	const MAX_ITEMS = 60;

	public static function register() {
		$m  = array( 'MP_Rest', 'can_manage' );
		$id = '(?P<id>\d+)';
		foreach ( array(
			array( 'templates', 'GET', 'index' ),
			array( 'templates', 'POST', 'create' ),
			array( "templates/$id", 'POST', 'update' ),
			array( "templates/$id", 'DELETE', 'remove' ),
		) as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $m ) );
		}
	}

	private static function t() {
		return MP_Install::table( 'templates' );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_template', $msg, array( 'status' => $status ) );
	}

	public static function payload( $row ) {
		$roles = json_decode( (string) $row->roles, true );
		$items = json_decode( (string) $row->items, true );
		$u     = $row->created_by ? get_userdata( $row->created_by ) : null;
		return array(
			'id'          => (int) $row->id,
			'name'        => $row->name,
			'description' => $row->description,
			'roles'       => is_array( $roles ) ? $roles : array(),
			'items'       => is_array( $items ) ? $items : array(),
			'author'      => $u ? $u->display_name : '',
			'updated_at'  => $row->updated_at,
		);
	}

	/** Validates and normalizes name/roles/items from a request. */
	private static function fields( WP_REST_Request $r ) {
		$name = MP_Util::text( $r['name'], 120 );
		if ( '' === $name ) {
			return self::err( 'نام قالب را وارد کنید.' );
		}
		$roles = array();
		foreach ( is_array( $r['roles'] ) ? $r['roles'] : array() as $role ) {
			$role = MP_Util::text( $role, 40 );
			if ( '' !== $role && ! in_array( $role, $roles, true ) ) {
				$roles[] = $role;
			}
		}
		if ( ! $roles ) {
			$roles = array( 'مسئول' );
		}
		$roles = array_slice( $roles, 0, 10 );
		$items = array();
		foreach ( is_array( $r['items'] ) ? array_slice( $r['items'], 0, self::MAX_ITEMS ) : array() as $it ) {
			$title = MP_Util::text( isset( $it['title'] ) ? $it['title'] : '', 200 );
			if ( '' === $title ) {
				continue;
			}
			$time = isset( $it['time'] ) && preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', (string) $it['time'] ) ? $it['time'] : '';
			$list = array();
			foreach ( isset( $it['checklist'] ) && is_array( $it['checklist'] ) ? $it['checklist'] : array() as $c ) {
				$c = MP_Util::text( $c, 200 );
				if ( '' !== $c ) {
					$list[] = $c;
				}
			}
			$items[] = array(
				'title'       => $title,
				'day'         => max( 0, min( 365, (int) ( isset( $it['day'] ) ? $it['day'] : 0 ) ) ),
				'time'        => $time,
				'priority'    => MP_Util::pick( isset( $it['priority'] ) ? $it['priority'] : '', array( 'high', 'medium', 'low' ), 'medium' ),
				'role'        => max( 0, min( count( $roles ) - 1, (int) ( isset( $it['role'] ) ? $it['role'] : 0 ) ) ),
				'checklist'   => array_slice( $list, 0, 30 ),
				'description' => MP_Util::long_text( isset( $it['description'] ) ? $it['description'] : '', 2000 ),
			);
		}
		if ( ! $items ) {
			return self::err( 'حداقل یک مرحله با عنوان لازم است.' );
		}
		usort(
			$items,
			function ( $a, $b ) {
				return $a['day'] - $b['day'];
			}
		);
		return array(
			'name'        => $name,
			'description' => MP_Util::text( $r['description'], 500 ),
			'roles'       => wp_json_encode( $roles, JSON_UNESCAPED_UNICODE ),
			'items'       => wp_json_encode( $items, JSON_UNESCAPED_UNICODE ),
		);
	}

	public static function index() {
		global $wpdb;
		return array_map( array( __CLASS__, 'payload' ), $wpdb->get_results( 'SELECT * FROM ' . self::t() . ' ORDER BY name' ) ); // phpcs:ignore
	}

	public static function create( WP_REST_Request $r ) {
		global $wpdb;
		$f = self::fields( $r );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		$wpdb->insert( self::t(), $f + array( 'created_by' => get_current_user_id(), 'created_at' => MP_Util::now(), 'updated_at' => MP_Util::now() ) );
		$id = (int) $wpdb->insert_id;
		MP_Audit::log( 'create', 'template', $id, 'قالب «' . $f['name'] . '»' );
		return self::payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) ) );
	}

	public static function update( WP_REST_Request $r ) {
		global $wpdb;
		$id = (int) $r['id'];
		if ( ! $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t() . ' WHERE id = %d', $id ) ) ) {
			return self::err( 'قالب پیدا نشد.', 404 );
		}
		$f = self::fields( $r );
		if ( is_wp_error( $f ) ) {
			return $f;
		}
		$wpdb->update( self::t(), $f + array( 'updated_at' => MP_Util::now() ), array( 'id' => $id ) );
		MP_Audit::log( 'update', 'template', $id, 'قالب «' . $f['name'] . '»' );
		return self::payload( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', $id ) ) );
	}

	public static function remove( WP_REST_Request $r ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t() . ' WHERE id = %d', (int) $r['id'] ) );
		if ( ! $row ) {
			return self::err( 'قالب پیدا نشد.', 404 );
		}
		$wpdb->delete( self::t(), array( 'id' => $row->id ) );
		MP_Audit::log( 'delete', 'template', $row->id, 'قالب «' . $row->name . '»' );
		return array( 'deleted' => true );
	}

	/** A studio starter template, added once on install/upgrade when there are no templates yet. */
	public static function seed() {
		global $wpdb;
		if ( get_option( 'mp_templates_seeded' ) || (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::t() ) ) { // phpcs:ignore
			return;
		}
		$roles = array( 'مدیر پروژه', 'طراح' );
		$items = array(
			array( 'title' => 'جلسه شروع و دریافت بریف از مشتری', 'day' => 0, 'time' => '10:00', 'priority' => 'high', 'role' => 0, 'checklist' => array( 'اهداف و مخاطب', 'بودجه و زمان‌بندی', 'نمونه‌های مورد علاقه مشتری' ) ),
			array( 'title' => 'تنظیم قرارداد و دریافت پیش‌پرداخت', 'day' => 1, 'time' => '', 'priority' => 'high', 'role' => 0, 'checklist' => array() ),
			array( 'title' => 'تحقیق و مودبورد', 'day' => 2, 'time' => '', 'priority' => 'medium', 'role' => 1, 'checklist' => array( 'بررسی رقبا', 'جمع‌آوری رفرنس', 'پالت رنگ اولیه' ) ),
			array( 'title' => 'اسکچ و ایده‌های اولیه', 'day' => 4, 'time' => '', 'priority' => 'medium', 'role' => 1, 'checklist' => array() ),
			array( 'title' => 'ارائه ایده‌ها به مشتری', 'day' => 6, 'time' => '11:00', 'priority' => 'high', 'role' => 0, 'checklist' => array() ),
			array( 'title' => 'اجرای طرح نهایی', 'day' => 8, 'time' => '', 'priority' => 'medium', 'role' => 1, 'checklist' => array() ),
			array( 'title' => 'اعمال اصلاحات مشتری', 'day' => 11, 'time' => '', 'priority' => 'medium', 'role' => 1, 'checklist' => array() ),
			array( 'title' => 'آماده‌سازی فایل‌های تحویل', 'day' => 13, 'time' => '', 'priority' => 'medium', 'role' => 1, 'checklist' => array( 'فایل‌های لایه‌باز', 'خروجی چاپ و وب', 'راهنمای استفاده' ) ),
			array( 'title' => 'تحویل و تسویه حساب', 'day' => 14, 'time' => '', 'priority' => 'high', 'role' => 0, 'checklist' => array() ),
		);
		$wpdb->insert(
			self::t(),
			array(
				'name'        => 'شروع پروژه جدید',
				'description' => 'از بریف تا تحویل؛ دو هفته کاری.',
				'roles'       => wp_json_encode( $roles, JSON_UNESCAPED_UNICODE ),
				'items'       => wp_json_encode( $items, JSON_UNESCAPED_UNICODE ),
				'created_by'  => 0,
				'created_at'  => MP_Util::now(),
				'updated_at'  => MP_Util::now(),
			)
		);
		update_option( 'mp_templates_seeded', 1, false );
	}
}

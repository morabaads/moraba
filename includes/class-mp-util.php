<?php
defined( 'ABSPATH' ) || exit;

/** Persian/Arabic digits → Latin. */
function J_latin( $s ) {
	return strtr( (string) $s, array( '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9', '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9' ) );
}

class MP_Util {

	public static function now() {
		return current_time( 'mysql' );
	}

	public static function today() {
		return current_time( 'Y-m-d' );
	}

	public static function is_manager( $user_id = 0 ) {
		return $user_id ? user_can( $user_id, 'mp_manage_panel' ) : current_user_can( 'mp_manage_panel' );
	}

	/** Has the employee role (a person can be employee and supervisor at once). */
	public static function is_employee( $user_id = 0 ) {
		$u = $user_id ? get_userdata( $user_id ) : wp_get_current_user();
		return $u && in_array( 'moraba_employee', (array) $u->roles, true );
	}

	public static function role_label( $user_id ) {
		$sup = self::is_manager( $user_id );
		$emp = self::is_employee( $user_id );
		return $sup && $emp ? 'ناظر و کارمند' : ( $sup ? 'ناظر' : 'کارمند' );
	}

	/** 'Y-m-d H:i:s' */
	public static function valid_datetime( $value ) {
		return is_string( $value ) && preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value ) && self::valid_date( substr( $value, 0, 10 ) );
	}

	public static function valid_date( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m ) ) {
			return false;
		}
		// Dates are Gregorian; a Jalali year (e.g. 1405) sent by mistake is rejected.
		return (int) $m[1] >= 1900 && (int) $m[1] <= 2200 && checkdate( (int) $m[2], (int) $m[3], (int) $m[1] );
	}

	public static function valid_time( $value ) {
		return is_string( $value ) && ( '' === $value || preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $value ) );
	}

	public static function text( $value, $max = 200 ) {
		$value = sanitize_text_field( (string) $value );
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $max ) : substr( $value, 0, $max );
	}

	public static function long_text( $value, $max = 5000 ) {
		$value = sanitize_textarea_field( (string) $value );
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $max ) : substr( $value, 0, $max );
	}

	public static function pick( $value, array $allowed, $default ) {
		return in_array( $value, $allowed, true ) ? $value : $default;
	}

	/** Every user who can open the panel. */
	public static function panel_users() {
		static $users = null;
		if ( null === $users ) {
			$users = get_users(
				array(
					'capability' => 'mp_access_panel',
					'orderby'    => 'display_name',
					'fields'     => array( 'ID' ),
				)
			);
			$users = array_map( 'intval', wp_list_pluck( $users, 'ID' ) );
		}
		return $users;
	}

	public static function is_panel_user( $user_id ) {
		return in_array( (int) $user_id, self::panel_users(), true );
	}

	public static function user_payload( $user_id ) {
		$u = get_userdata( $user_id );
		if ( ! $u ) {
			return null;
		}
		$last = (int) get_user_meta( $user_id, 'mp_last_seen', true );
		$age  = time() - $last;
		return array(
			'id'      => (int) $u->ID,
			'name'    => $u->display_name,
			'title'   => (string) get_user_meta( $user_id, 'mp_job_title', true ),
			'phone'   => (string) get_user_meta( $user_id, 'mp_phone', true ),
			'avatar'  => self::avatar_url( $u->ID ),
			'manager' => self::is_manager( $u->ID ),
			'employee'=> self::is_employee( $u->ID ),
			'role'    => self::role_label( $u->ID ),
			'status'  => $last && $age < 300 ? 'online' : ( $last && $age < 3600 ? 'away' : 'busy' ),
		);
	}

	/** Uploaded profile photo, or '' (the panel then shows initials; Gravatar is not used). */
	public static function avatar_dir() {
		$dir = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'moraba-avatars';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			file_put_contents( $dir . '/index.php', "<?php\n// Silence.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
		return $dir;
	}

	public static function avatar_url( $user_id ) {
		$pub = basename( (string) get_user_meta( $user_id, 'mp_avatar_public', true ) );
		if ( $pub ) {
			return set_url_scheme( trailingslashit( wp_upload_dir( null, false )['baseurl'] ) . 'moraba-avatars/' . rawurlencode( $pub ) );
		}
		$file = (int) get_user_meta( $user_id, 'mp_avatar_file', true );
		return $file ? MP_Files::url( $file ) . '&v=' . $file : '';
	}

	public static function project_ids_for( $user_id ) {
		global $wpdb;
		if ( self::is_manager( $user_id ) ) {
			return array_map( 'intval', $wpdb->get_col( 'SELECT id FROM ' . MP_Install::table( 'projects' ) ) );
		}
		return array_map(
			'intval',
			$wpdb->get_col( $wpdb->prepare( 'SELECT project_id FROM ' . MP_Install::table( 'project_members' ) . ' WHERE user_id = %d', $user_id ) )
		);
	}

	public static function can_see_project( $project_id, $user_id = 0 ) {
		$user_id = $user_id ? $user_id : get_current_user_id();
		return in_array( (int) $project_id, self::project_ids_for( $user_id ), true );
	}

	public static function project_members( $project_id ) {
		global $wpdb;
		return array_map(
			'intval',
			$wpdb->get_col( $wpdb->prepare( 'SELECT user_id FROM ' . MP_Install::table( 'project_members' ) . ' WHERE project_id = %d', $project_id ) )
		);
	}

	/** Saturday of the week containing $date (Iranian week). */
	public static function week_start( $date ) {
		$ts  = strtotime( $date . ' 00:00:00 UTC' );
		$dow = (int) gmdate( 'w', $ts ); // 0 = Sunday … 6 = Saturday.
		$off = ( $dow + 1 ) % 7;
		return gmdate( 'Y-m-d', $ts - $off * DAY_IN_SECONDS );
	}

	public static function add_days( $date, $days ) {
		return gmdate( 'Y-m-d', strtotime( $date . ' 00:00:00 UTC' ) + $days * DAY_IN_SECONDS );
	}
}

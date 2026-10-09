<?php
defined( 'ABSPATH' ) || exit;

/**
 * Export / import of everything the panel owns, and a factory reset.
 *
 * A backup is a .zip with data.json (tables, settings, staff and their panel meta) plus the uploaded
 * files and profile photos. Users are matched on import by login, then email, then mobile, so a
 * backup can move to another site; people who don't exist there are created. Before every import
 * or reset an automatic backup is written to a protected folder so the step can be undone.
 */
class MP_Backup {

	const FORMAT  = 'moraba-panel-backup';
	const KEEP    = 10;
	const TABLES  = array( 'folders', 'projects', 'project_members', 'sections', 'milestones', 'tasks', 'goals', 'notes', 'channels', 'messages', 'reads', 'reactions', 'meetings', 'meeting_people', 'meeting_peers', 'meeting_invites', 'meeting_chat', 'reminders', 'notifications', 'ledger', 'task_items', 'task_comments', 'files', 'attendance', 'leaves', 'templates', 'timelog', 'audit', 'channel_members', 'daily_reports', 'invoices', 'client_items', 'design_pins', 'client_contacts', 'clients', 'client_projects', 'contracts', 'contract_templates', 'shortlinks', 'poll_votes', 'msg_edits', 'msg_hidden', 'chat_topics', 'topic_reads', 'chat_roles', 'chat_scheduled', 'stickers' );
	const OPTIONS = array( 'mp_slug', 'mp_page_id', 'mp_support', 'mp_email_notifications', 'mp_telegram_token', 'mp_bale_token', 'mp_sms_provider', 'mp_sms_key', 'mp_sms_sender', 'mp_smsir_key', 'mp_smsir_line', 'mp_smsir_template', 'mp_smsir_param', 'mp_vapid_private', 'mp_vapid_public', 'mp_speech_key', 'mp_speech_url', 'mp_speech_stt_model', 'mp_speech_tts_model', 'mp_speech_voice', 'mp_payroll', 'mp_payroll_holidays', 'mp_payroll_adj', 'mp_daily_report', 'mp_invoice_settings', 'mp_digest', 'mp_ai_url', 'mp_ai_model', 'mp_contract_settings', 'mp_meet_settings', 'mp_messages', 'mp_presence_on', 'mp_presence_idle', 'mp_chat_slug' );
	const META    = array( 'mp_pins', 'mp_prefs', 'mp_job_title', 'mp_phone', 'mp_avatar_public', 'mp_avatar_file', 'mp_telegram_chat', 'mp_bale_chat', 'mp_push_subs', 'mp_last_seen', 'mp_hourly_rate', 'mp_pay', 'mp_mutes', 'mp_chat_arch', 'mp_chat_look', 'mp_unread_mark', 'mp_chat_folders', 'mp_drafts', 'mp_presence_paused' );
	/**
	 * Sections that can be exported, imported or wiped on their own: key => [label, tables].
	 * «settings» and «staff» are not tables: panel options, and staff roles/meta.
	 */
	const GROUPS = array(
		'projects'  => array( 'پروژه‌ها (فولدر، بخش، مرحله، هدف، یادداشت)', array( 'folders', 'projects', 'project_members', 'sections', 'milestones', 'goals', 'notes' ) ),
		'tasks'     => array( 'تسک‌ها (چک‌لیست، نظر، زمان‌سنج، قالب، گزارش روزانه)', array( 'tasks', 'task_items', 'task_comments', 'timelog', 'templates', 'daily_reports' ) ),
		'groups'    => array( 'گروه‌ها و گفت‌وگوها (تیم، خصوصی، مشتری)', array( 'channels', 'channel_members', 'chat_topics', 'chat_roles' ) ),
		'messages'  => array( 'پیام‌ها', array( 'messages', 'reads', 'reactions', 'poll_votes', 'msg_edits', 'msg_hidden', 'topic_reads', 'chat_scheduled', 'stickers' ) ),
		'clients'   => array( 'مشتریان (افراد، پرتال، طرح‌ها و نظرها)', array( 'clients', 'client_projects', 'client_contacts', 'client_items', 'design_pins' ) ),
		'invoices'  => array( 'فاکتورها و پیش‌فاکتورها', array( 'invoices' ) ),
		'contracts' => array( 'قراردادها و قالب‌ها', array( 'contracts', 'contract_templates' ) ),
		'ledger'    => array( 'حسابداری (دخل و خرج)', array( 'ledger' ) ),
		'attendance'=> array( 'حضور و مرخصی', array( 'attendance', 'leaves' ) ),
		'calendar'  => array( 'جلسات و یادآوری‌ها', array( 'meetings', 'meeting_people', 'meeting_peers', 'meeting_invites', 'meeting_chat', 'reminders' ) ),
		'activity'  => array( 'اعلان‌ها، لینک‌های کوتاه پیامک و گزارش فعالیت', array( 'notifications', 'audit', 'shortlinks' ) ),
		'files'     => array( 'فایل‌ها و پیوست‌ها', array( 'files' ) ),
		'settings'  => array( 'تنظیمات پنل (پیامک، ربات‌ها، حقوق، فاکتور…)', array() ),
		'staff'     => array( 'کارمندان (نقش، شماره، عکس، تنظیمات شخصی)', array() ),
	);

	/**
	 * What can be wiped on its own, in detail: key => [heading, label, tables emptied, rows only (table => SQL condition), follow-up].
	 * Follow-ups keep the rest consistent (e.g. tasks of a deleted project lose the project instead of pointing nowhere).
	 */
	const RESET_ITEMS = array(
		'projects'     => array( 'پروژه‌ها', 'پروژه‌ها (با بخش‌ها، مراحل و اعضا)', array( 'projects', 'project_members', 'sections', 'milestones' ), array(), 'unlink_projects' ),
		'folders'      => array( 'پروژه‌ها', 'فولدرهای پروژه (خود پروژه‌ها می‌مانند)', array( 'folders' ), array(), 'unlink_folders' ),
		'notes'        => array( 'پروژه‌ها', 'یادداشت‌های پروژه', array( 'notes' ), array(), '' ),
		'goals'        => array( 'پروژه‌ها', 'اهداف هفتگی', array( 'goals' ), array(), '' ),
		'tasks'        => array( 'تسک‌ها', 'تسک‌ها (با چک‌لیست و نظرها)', array( 'tasks', 'task_items', 'task_comments', 'timelog' ), array(), '' ),
		'timelog'      => array( 'تسک‌ها', 'ریز زمان‌های کار (تسک‌ها می‌مانند)', array( 'timelog' ), array(), '' ),
		'templates'    => array( 'تسک‌ها', 'قالب‌های تسک', array( 'templates' ), array(), 'reseed_templates' ),
		'daily'        => array( 'تسک‌ها', 'گزارش‌های روزانه', array( 'daily_reports' ), array(), '' ),
		'messages'     => array( 'گفت‌وگوها', 'پیام‌ها (گروه‌ها می‌مانند)', array( 'messages', 'reads', 'reactions', 'poll_votes', 'msg_edits', 'msg_hidden', 'topic_reads', 'chat_scheduled' ), array(), '' ),
		'stickers'     => array( 'گفت‌وگوها', 'استیکرها و GIFهای استودیو', array( 'stickers' ), array(), '' ),
		'team_groups'  => array( 'گفت‌وگوها', 'گروه‌های تیم و گفت‌وگوهای خصوصی (با پیام‌ها)', array(), array( 'messages' => "channel_id IN (SELECT id FROM {channels} WHERE type IN ('group','direct','saved'))", 'channel_members' => "channel_id IN (SELECT id FROM {channels} WHERE type = 'group')", 'channels' => "type IN ('group','direct','saved')" ), '' ),
		'client_groups'=> array( 'گفت‌وگوها', 'گروه‌های مشتری و لینک پرتال (با پیام‌ها)', array(), array( 'messages' => "channel_id IN (SELECT id FROM {channels} WHERE type = 'client')", 'client_contacts' => '1=1', 'channels' => "type = 'client'" ), '' ),
		'clients'      => array( 'مشتریان', 'مشتریان (پرونده مشتری، پروژه‌ها و شماره‌های ورود به پرتال)', array( 'clients', 'client_projects', 'client_contacts' ), array(), '' ),
		'designs'      => array( 'مشتریان', 'طرح‌ها و فایل‌های تحویلی پرتال (با نظرها)', array( 'client_items', 'design_pins' ), array(), '' ),
		'pins'         => array( 'مشتریان', 'فقط نظرهای روی طرح‌ها', array( 'design_pins' ), array(), '' ),
		'invoices'     => array( 'مالی', 'فاکتورها', array(), array( 'invoices' => "kind = 'invoice'" ), '' ),
		'proformas'    => array( 'مالی', 'پیش‌فاکتورها', array(), array( 'invoices' => "kind = 'proforma'" ), '' ),
		'ledger'       => array( 'مالی', 'حسابداری (دخل و خرج)', array( 'ledger' ), array(), '' ),
		'contracts'    => array( 'قراردادها', 'قراردادها', array( 'contracts' ), array(), '' ),
		'ctemplates'   => array( 'قراردادها', 'قالب‌های قرارداد (قالب پیش‌فرض همیشه می‌ماند)', array( 'contract_templates' ), array(), '' ),
		'attendance'   => array( 'حضور و مرخصی', 'ورود و خروج‌ها (حضور و غیاب)', array( 'attendance' ), array(), '' ),
		'leaves'       => array( 'حضور و مرخصی', 'مرخصی‌ها', array( 'leaves' ), array(), '' ),
		'meetings'     => array( 'جلسات و یادآوری', 'جلسات (با حضور، گفت‌وگو، دعوت‌ها و ضبط‌ها)', array( 'meetings', 'meeting_people', 'meeting_peers', 'meeting_invites', 'meeting_chat', 'meeting_signals' ), array(), 'wipe_meeting_files' ),
		'reminders'    => array( 'جلسات و یادآوری', 'یادآوری‌ها', array( 'reminders' ), array(), '' ),
		'notifications'=> array( 'سایر', 'اعلان‌ها', array( 'notifications' ), array(), '' ),
		'audit'        => array( 'سایر', 'تاریخچه تغییرات', array( 'audit' ), array(), '' ),
		'files'        => array( 'سایر', 'همه فایل‌ها و پیوست‌ها', array( 'files' ), array(), 'wipe_files' ),
		'settings'     => array( 'سایر', 'تنظیمات پنل (پیامک، ربات‌ها، حقوق، فاکتور…)', array(), array(), 'wipe_settings' ),
		'staff'        => array( 'سایر', 'اطلاعات کارمندان (شماره، سمت، عکس، تنظیمات شخصی)', array(), array(), 'wipe_staff' ),
	);

	/** Rows that each reset item would remove right now. */
	public static function reset_counts() {
		global $wpdb;
		$out = array();
		foreach ( self::RESET_ITEMS as $k => $it ) {
			$n = 0;
			if ( $it[2] ) { // the main thing of the item is its first table
				$n = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . MP_Install::table( $it[2][0] ) ); // phpcs:ignore
			}
			foreach ( $it[3] as $t => $where ) {
				if ( in_array( $t, array( 'channels', 'invoices' ), true ) ) {
					$n = max( $n, (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . MP_Install::table( $t ) . ' WHERE ' . self::where( $where ) ) ); // phpcs:ignore
				}
			}
			$out[ $k ] = '' === $it[4] || $it[2] || $it[3] ? $n : null;
		}
		return $out;
	}

	private static function where( $sql ) {
		return str_replace( '{channels}', MP_Install::table( 'channels' ), $sql );
	}

	/** Empties the chosen items (a safety backup first). */
	public static function reset_items( $keys ) {
		global $wpdb;
		$keys = array_values( array_intersect( array_keys( self::RESET_ITEMS ), (array) $keys ) );
		if ( ! $keys ) {
			return new WP_Error( 'mp_reset', 'چیزی انتخاب نشده است.' );
		}
		$safety = self::write( 'before-reset' );
		if ( is_wp_error( $safety ) ) {
			return $safety;
		}
		foreach ( $keys as $k ) {
			$it = self::RESET_ITEMS[ $k ];
			// Rows first (their conditions may look at tables emptied below), then whole tables.
			foreach ( $it[3] as $t => $where ) {
				$wpdb->query( 'DELETE FROM ' . MP_Install::table( $t ) . ' WHERE ' . self::where( $where ) ); // phpcs:ignore
			}
			foreach ( $it[2] as $t ) {
				$wpdb->query( 'DELETE FROM ' . MP_Install::table( $t ) ); // phpcs:ignore
			}
			if ( $it[4] ) {
				call_user_func( array( __CLASS__, $it[4] ) );
			}
		}
		MP_Audit::log( 'reset', 'panel', 0, 'پاک کردن: ' . implode( '، ', array_map( function ( $k ) { return self::RESET_ITEMS[ $k ][1]; }, $keys ) ) );
		return $safety;
	}

	private static function unlink_projects() {
		global $wpdb;
		$wpdb->query( 'UPDATE ' . MP_Install::table( 'tasks' ) . ' SET project_id = 0, section_id = 0' ); // phpcs:ignore
		$wpdb->query( 'DELETE FROM ' . MP_Install::table( 'channels' ) . " WHERE type = 'project'" ); // phpcs:ignore
		$wpdb->query( 'UPDATE ' . MP_Install::table( 'channels' ) . ' SET project_id = 0' ); // phpcs:ignore
		$wpdb->query( 'DELETE FROM ' . MP_Install::table( 'client_projects' ) ); // phpcs:ignore
	}

	private static function unlink_folders() {
		global $wpdb;
		$wpdb->query( 'UPDATE ' . MP_Install::table( 'projects' ) . ' SET folder_id = 0' ); // phpcs:ignore
	}

	private static function reseed_templates() {
		delete_option( 'mp_templates_seeded' );
		MP_Templates::seed();
	}

	private static function wipe_meeting_files() {
		global $wpdb;
		foreach ( $wpdb->get_col( 'SELECT id FROM ' . MP_Install::table( 'files' ) . " WHERE context IN ('meeting','meeting_rec','meeting_audio')" ) as $id ) { // phpcs:ignore
			MP_Files::delete( (int) $id );
		}
		self::empty_dir( MP_Relay::base_wp(), array( 'index.php', '.htaccess', 'key.php' ) );
	}

	private static function wipe_files() {
		self::empty_dir( MP_Files::dir(), array( 'index.php', '.htaccess' ) );
	}

	private static function wipe_settings() {
		foreach ( array_diff( self::OPTIONS, self::STAFF_OPTIONS ) as $o ) {
			delete_option( $o );
		}
	}

	private static function wipe_staff() {
		foreach ( self::META as $k ) {
			delete_metadata( 'user', 0, $k, '', true );
		}
		self::empty_dir( MP_Util::avatar_dir(), array( 'index.php' ) );
	}

	/** Selected sections from a request (all when none is given). */
	public static function pick_groups( $in ) {
		$keys = array_keys( self::GROUPS );
		$in   = is_array( $in ) ? array_values( array_intersect( array_map( 'sanitize_key', $in ), $keys ) ) : array();
		return $in ? $in : $keys;
	}

	private static function tables_of( $groups ) {
		$t = array();
		foreach ( $groups as $g ) {
			$t = array_merge( $t, self::GROUPS[ $g ][1] );
		}
		return array_values( array_intersect( self::TABLES, $t ) );
	}

	/** Columns holding WordPress user IDs, remapped when users get different IDs on import. */
	const USER_COLUMNS = array( 'user_id', 'created_by', 'assigned_by', 'reviewed_by', 'user_a', 'user_b' );

	/* ------------------------------------------------------------------ Paths */

	public static function dir() {
		$dir = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'moraba-backups';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			file_put_contents( $dir . '/index.php', "<?php\n// Silence.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			file_put_contents( $dir . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
		return $dir;
	}

	/** @return array<int,array{name:string,size:int,time:int}> newest first */
	public static function saved() {
		$out = array();
		foreach ( (array) glob( self::dir() . '/*.{zip,json}', GLOB_BRACE ) as $f ) {
			$out[] = array( 'name' => basename( $f ), 'size' => filesize( $f ), 'time' => filemtime( $f ) );
		}
		usort(
			$out,
			function ( $a, $b ) {
				return $b['time'] - $a['time'];
			}
		);
		return $out;
	}

	/* ------------------------------------------------------------------ Export */

	public static function data( $groups = null ) {
		global $wpdb;
		$groups = $groups ? $groups : array_keys( self::GROUPS );
		$data = array(
			'format'  => self::FORMAT,
			'version' => MP_VERSION,
			'db'      => MP_DB_VERSION,
			'site'    => home_url( '/' ),
			'created' => gmdate( 'c' ),
			'options' => array(),
			'users'   => array(),
			'tables'  => array(),
			'groups'  => $groups,
		);
		foreach ( in_array( 'settings', $groups, true ) ? self::OPTIONS : array() as $o ) {
			$v = get_option( $o, null );
			if ( null !== $v ) {
				$data['options'][ $o ] = $v;
			}
		}
		$ids = array_unique( array_merge( MP_Util::panel_users(), array_map( 'intval', $wpdb->get_col( "SELECT DISTINCT user_id FROM {$wpdb->usermeta} WHERE meta_key IN ('" . implode( "','", self::META ) . "')" ) ) ) ); // phpcs:ignore
		foreach ( $ids as $id ) {
			$u = get_userdata( $id );
			if ( ! $u ) {
				continue;
			}
			$meta = array();
			foreach ( self::META as $k ) {
				$v = get_user_meta( $id, $k, true );
				if ( '' !== $v && null !== $v ) {
					$meta[ $k ] = $v;
				}
			}
			$data['users'][] = array(
				'id'    => (int) $id,
				'login' => $u->user_login,
				'email' => $u->user_email,
				'name'  => $u->display_name,
				'roles' => array_values( array_intersect( (array) $u->roles, array( 'moraba_employee', 'moraba_manager' ) ) ),
				'meta'  => $meta,
			);
		}
		foreach ( self::tables_of( $groups ) as $t ) {
			$data['tables'][ $t ] = $wpdb->get_results( 'SELECT * FROM ' . MP_Install::table( $t ), ARRAY_A ); // phpcs:ignore
		}
		return $data;
	}

	/** Writes a backup into the protected folder and returns its path (or WP_Error). */
	public static function write( $label = 'backup', $protect = '', $groups = null ) {
		$data = self::data( $groups );
		$all  = ! $groups || count( $groups ) === count( self::GROUPS );
		$base = self::dir() . '/' . gmdate( 'Y-m-d-His' ) . '-' . sanitize_file_name( $label ) . '-' . strtolower( wp_generate_password( 6, false ) );
		$json = wp_json_encode( $data, JSON_UNESCAPED_UNICODE );
		if ( ! class_exists( 'ZipArchive' ) ) {
			file_put_contents( $base . '.json', $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			$path = $base . '.json';
		} else {
			$zip = new ZipArchive();
			if ( true !== $zip->open( $base . '.zip', ZipArchive::CREATE ) ) {
				return new WP_Error( 'mp_backup', 'ساخت فایل پشتیبان انجام نشد.' );
			}
			$zip->addFromString( 'data.json', $json );
			if ( $all || in_array( 'files', $groups, true ) ) {
				self::zip_dir( $zip, MP_Files::dir(), 'files', array( 'index.php', '.htaccess' ) );
			}
			if ( $all || in_array( 'staff', $groups, true ) ) {
				self::zip_dir( $zip, MP_Util::avatar_dir(), 'avatars', array( 'index.php' ) );
			}
			$zip->close();
			$path = $base . '.zip';
		}
		// Keep the newest few automatic/manual copies.
		foreach ( array_slice( self::saved(), self::KEEP ) as $old ) {
			if ( $protect && realpath( self::dir() . '/' . $old['name'] ) === realpath( $protect ) ) {
				continue; // never prune the backup that is being restored right now
			}
			wp_delete_file( self::dir() . '/' . $old['name'] );
		}
		return $path;
	}

	private static function zip_dir( ZipArchive $zip, $dir, $prefix, $skip ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
		foreach ( $it as $f ) {
			$rel = ltrim( str_replace( '\\', '/', substr( $f->getPathname(), strlen( $dir ) ) ), '/' );
			if ( $f->isFile() && ! in_array( $rel, $skip, true ) ) {
				$zip->addFile( $f->getPathname(), $prefix . '/' . $rel );
			}
		}
	}

	/* ------------------------------------------------------------------ Import */

	/** @return array{users:int,created:int,rows:int}|WP_Error */
	public static function import( $path, $groups = null ) {
		global $wpdb;
		$zip  = null;
		$json = '';
		if ( class_exists( 'ZipArchive' ) ) {
			$z = new ZipArchive();
			if ( true === $z->open( $path ) ) {
				$zip  = $z;
				$json = (string) $zip->getFromName( 'data.json' );
			}
		}
		if ( ! $zip ) {
			$json = (string) file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
		$data = json_decode( $json, true );
		if ( ! is_array( $data ) || self::FORMAT !== ( isset( $data['format'] ) ? $data['format'] : '' ) || ! isset( $data['tables'] ) ) {
			return new WP_Error( 'mp_backup', 'این فایل، پشتیبان پنل مربع نیست یا خراب است.' );
		}

		// Only sections both chosen and present in the file (older/partial backups have fewer).
		$has    = isset( $data['groups'] ) && is_array( $data['groups'] ) ? $data['groups'] : array_keys( self::GROUPS );
		$groups = array_values( array_intersect( $groups ? $groups : array_keys( self::GROUPS ), $has ) );
		if ( ! $groups ) {
			return new WP_Error( 'mp_backup', 'بخش‌های انتخاب‌شده در این فایل نیست.' );
		}
		$staff  = in_array( 'staff', $groups, true );
		$safety = self::write( 'before-import', $path );
		if ( is_wp_error( $safety ) ) {
			return $safety;
		}

		// 1. People: find or create, then restore roles and panel meta.
		$map     = array();
		$created = 0;
		foreach ( (array) $data['users'] as $u ) {
			$new = self::match_user( $u );
			if ( ! $new ) {
				$login = sanitize_user( $u['login'], true );
				$login = $login && ! username_exists( $login ) ? $login : 'mp' . wp_generate_password( 8, false, false );
				$new   = wp_insert_user(
					array(
						'user_login'   => $login,
						'user_pass'    => wp_generate_password( 24 ),
						'user_email'   => is_email( $u['email'] ) && ! email_exists( $u['email'] ) ? $u['email'] : '',
						'display_name' => $u['name'],
						'role'         => '',
					)
				);
				if ( is_wp_error( $new ) ) {
					continue;
				}
				++$created;
			}
			$map[ (int) $u['id'] ] = (int) $new;
			if ( ! $staff ) {
				continue; // only matched, so rows keep pointing at the right people
			}
			$user                  = new WP_User( $new );
			foreach ( array( 'moraba_employee', 'moraba_manager' ) as $r ) {
				if ( in_array( $r, (array) $u['roles'], true ) ) {
					$user->add_role( $r );
				} elseif ( ! user_can( $user, 'manage_options' ) ) {
					$user->remove_role( $r );
				}
			}
			foreach ( self::META as $k ) {
				if ( isset( $u['meta'][ $k ] ) ) {
					update_user_meta( $new, $k, $u['meta'][ $k ] );
				} else {
					delete_user_meta( $new, $k );
				}
			}
		}

		// 2. Tables: replace everything, keeping row IDs so links between tables stay intact.
		$tables = self::tables_of( $groups );
		self::wipe_tables( $tables );
		$rows = 0;
		foreach ( $tables as $t ) {
			foreach ( isset( $data['tables'][ $t ] ) ? (array) $data['tables'][ $t ] : array() as $row ) {
				foreach ( self::USER_COLUMNS as $c ) {
					if ( isset( $row[ $c ] ) && (int) $row[ $c ] && isset( $map[ (int) $row[ $c ] ] ) ) {
						$row[ $c ] = $map[ (int) $row[ $c ] ];
					}
				}
				if ( false !== $wpdb->insert( MP_Install::table( $t ), $row ) ) {
					++$rows;
				}
			}
		}

		// 3. Settings (the slug may change, so rewrite rules are rebuilt).
		foreach ( in_array( 'settings', $groups, true ) ? self::OPTIONS : array() as $o ) {
			if ( array_key_exists( $o, (array) $data['options'] ) ) {
				update_option( $o, $data['options'][ $o ], false );
			} else {
				delete_option( $o );
			}
		}

		// 4. Files.
		$files = in_array( 'files', $groups, true );
		if ( $zip && ( $files || $staff ) ) {
			if ( $files ) {
				self::empty_dir( MP_Files::dir(), array( 'index.php', '.htaccess' ) );
			}
			if ( $staff ) {
				self::empty_dir( MP_Util::avatar_dir(), array( 'index.php' ) );
			}
			for ( $i = 0; $i < $zip->numFiles; $i++ ) {
				$name = $zip->getNameIndex( $i );
				if ( false !== strpos( $name, '..' ) || ! preg_match( '#^(files|avatars)/(.+)$#', $name, $m ) || ( 'files' === $m[1] && ! $files ) || ( 'avatars' === $m[1] && ! $staff ) ) {
					continue;
				}
				$target = ( 'files' === $m[1] ? MP_Files::dir() : MP_Util::avatar_dir() ) . '/' . $m[2];
				if ( 'avatars' === $m[1] && ! preg_match( '/\.(jpe?g|png|webp|gif)$/i', $target ) ) {
					continue; // avatars folder is public: never write anything executable there
				}
				wp_mkdir_p( dirname( $target ) );
				file_put_contents( $target, $zip->getFromIndex( $i ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			}
			$zip->close();
		}

		MP_Install::add_roles();
		MP_Frontend::add_rewrite();
		flush_rewrite_rules();
		MP_Audit::log( 'import', 'panel', 0, 'بازگردانی پشتیبان (' . count( $map ) . ' نفر، ' . $rows . ' ردیف)' );
		return array( 'users' => count( $map ), 'created' => $created, 'rows' => $rows, 'groups' => $groups );
	}

	private static function match_user( $u ) {
		$by = get_user_by( 'login', $u['login'] );
		if ( ! $by && ! empty( $u['email'] ) ) {
			$by = get_user_by( 'email', $u['email'] );
		}
		if ( $by ) {
			return (int) $by->ID;
		}
		$phone = isset( $u['meta']['mp_phone'] ) ? MP_Auth::normalize( $u['meta']['mp_phone'] ) : '';
		return $phone ? MP_Auth::user_by_mobile( $phone ) : null;
	}

	/* ------------------------------------------------------------------ Reset */

	/** What «keep staff» preserves: roles, number, title, photo, messenger IDs, preferences and devices. */
	const STAFF_META    = array( 'mp_phone', 'mp_job_title', 'mp_avatar_public', 'mp_telegram_chat', 'mp_bale_chat', 'mp_prefs', 'mp_push_subs', 'mp_hourly_rate', 'mp_pay' );
	const STAFF_OPTIONS = array( 'mp_vapid_private', 'mp_vapid_public' ); // keeps phones' push subscriptions valid

	/**
	 * Back to a fresh install. Staff are kept (so they can still log in) unless $people is true.
	 */
	public static function reset( $people = false ) {
		global $wpdb;
		$safety = self::write( 'before-reset' );
		if ( is_wp_error( $safety ) ) {
			return $safety;
		}
		self::wipe_tables();
		delete_option( 'mp_templates_seeded' );
		update_option( 'mp_timelog_migrated', 1, false ); // an empty log after reset needs no migration // the starter template comes back with the fresh install
		foreach ( array_diff( self::OPTIONS, $people ? array() : self::STAFF_OPTIONS ) as $o ) {
			delete_option( $o );
		}
		$meta = array_diff( self::META, $people ? array() : self::STAFF_META );
		foreach ( $meta as $k ) {
			delete_metadata( 'user', 0, $k, '', true );
		}
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_%mp\_%' OR option_name LIKE '\_transient\_timeout\_%mp\_%'" ); // phpcs:ignore
		self::empty_dir( MP_Files::dir(), array( 'index.php', '.htaccess' ) );
		if ( $people ) {
			self::empty_dir( MP_Util::avatar_dir(), array( 'index.php' ) );
			foreach ( get_users( array( 'role__in' => array( 'moraba_employee', 'moraba_manager' ) ) ) as $u ) {
				$u->remove_role( 'moraba_employee' );
				$u->remove_role( 'moraba_manager' );
			}
		}
		MP_Install::activate();
		return $safety;
	}

	/** Empties only the chosen sections (a safety backup first). Everything chosen = full reset. */
	public static function reset_groups( $groups, $people = false ) {
		if ( count( $groups ) === count( self::GROUPS ) ) {
			return self::reset( $people );
		}
		$safety = self::write( 'before-reset' );
		if ( is_wp_error( $safety ) ) {
			return $safety;
		}
		self::wipe_tables( self::tables_of( $groups ) );
		if ( in_array( 'files', $groups, true ) ) {
			self::empty_dir( MP_Files::dir(), array( 'index.php', '.htaccess' ) );
		}
		if ( in_array( 'settings', $groups, true ) ) {
			foreach ( array_diff( self::OPTIONS, self::STAFF_OPTIONS ) as $o ) {
				delete_option( $o );
			}
		}
		if ( in_array( 'staff', $groups, true ) ) {
			foreach ( self::META as $k ) {
				delete_metadata( 'user', 0, $k, '', true );
			}
			self::empty_dir( MP_Util::avatar_dir(), array( 'index.php' ) );
		}
		if ( in_array( 'tasks', $groups, true ) ) {
			delete_option( 'mp_templates_seeded' );
			MP_Templates::seed();
		}
		MP_Audit::log( 'reset', 'panel', 0, 'پاک کردن: ' . implode( '، ', array_map( function ( $g ) { return self::GROUPS[ $g ][0]; }, $groups ) ) );
		return $safety;
	}

	private static function wipe_tables( $tables = null ) {
		global $wpdb;
		foreach ( $tables ? $tables : self::TABLES as $t ) {
			$wpdb->query( 'DELETE FROM ' . MP_Install::table( $t ) ); // phpcs:ignore
		}
	}

	private static function empty_dir( $dir, $keep ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST );
		foreach ( $it as $f ) {
			$rel = ltrim( str_replace( '\\', '/', substr( $f->getPathname(), strlen( $dir ) ) ), '/' );
			if ( in_array( $rel, $keep, true ) ) {
				continue;
			}
			$f->isDir() ? @rmdir( $f->getPathname() ) : wp_delete_file( $f->getPathname() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
	}

	/* ------------------------------------------------------------------ Admin actions */

	public static function init() {
		add_action( 'admin_post_mp_backup_export', array( __CLASS__, 'handle_export' ) );
		add_action( 'admin_post_mp_backup_download', array( __CLASS__, 'handle_download' ) );
		add_action( 'admin_post_mp_backup_import', array( __CLASS__, 'handle_import' ) );
		add_action( 'admin_post_mp_backup_restore', array( __CLASS__, 'handle_restore' ) );
		add_action( 'admin_post_mp_backup_reset', array( __CLASS__, 'handle_reset' ) );
	}

	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( $action );
		@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	private static function back( $type, $text ) {
		set_transient( 'mp_admin_notice_' . get_current_user_id(), array( $type, $text ), 120 );
		wp_safe_redirect( admin_url( 'admin.php?page=moraba-panel#mp-backup' ) );
		exit;
	}

	private static function send( $path ) {
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		nocache_headers();
		header( 'Content-Type: ' . ( '.zip' === substr( $path, -4 ) ? 'application/zip' : 'application/json' ) );
		header( 'Content-Disposition: attachment; filename="moraba-panel-' . basename( $path ) . '"' );
		header( 'Content-Length: ' . filesize( $path ) );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}

	public static function handle_export() {
		self::guard( 'mp_backup_export' );
		$path = self::write( 'export', '', self::pick_groups( isset( $_POST['groups'] ) ? wp_unslash( $_POST['groups'] ) : null ) ); // phpcs:ignore
		if ( is_wp_error( $path ) ) {
			self::back( 'error', $path->get_error_message() );
		}
		self::send( $path );
	}

	public static function handle_download() {
		self::guard( 'mp_backup_download' );
		$name = isset( $_POST['file'] ) ? basename( sanitize_file_name( wp_unslash( $_POST['file'] ) ) ) : '';
		$path = self::dir() . '/' . $name;
		if ( ! $name || ! preg_match( '/\.(zip|json)$/', $name ) || ! is_file( $path ) ) {
			self::back( 'error', 'فایل پشتیبان پیدا نشد.' );
		}
		self::send( $path );
	}

	public static function handle_import() {
		self::guard( 'mp_backup_import' );
		if ( empty( $_POST['confirm'] ) ) {
			self::back( 'error', 'برای بازگردانی، تیک تأیید را بزنید.' );
		}
		if ( empty( $_FILES['backup']['tmp_name'] ) || ! is_uploaded_file( $_FILES['backup']['tmp_name'] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			self::back( 'error', 'فایل پشتیبان انتخاب نشده است.' );
		}
		self::finish_import( self::import( $_FILES['backup']['tmp_name'], self::pick_groups( isset( $_POST['groups'] ) ? wp_unslash( $_POST['groups'] ) : null ) ) ); // phpcs:ignore
	}

	public static function handle_restore() {
		self::guard( 'mp_backup_restore' );
		$name = isset( $_POST['file'] ) ? basename( sanitize_file_name( wp_unslash( $_POST['file'] ) ) ) : '';
		$path = self::dir() . '/' . $name;
		if ( ! $name || ! is_file( $path ) ) {
			self::back( 'error', 'فایل پشتیبان پیدا نشد.' );
		}
		self::finish_import( self::import( $path, self::pick_groups( isset( $_POST['groups'] ) ? wp_unslash( $_POST['groups'] ) : null ) ) ); // phpcs:ignore
	}

	private static function finish_import( $r ) {
		if ( is_wp_error( $r ) ) {
			self::back( 'error', $r->get_error_message() );
		}
		self::back( 'success', 'بازگردانی شد (' . implode( '، ', array_map( function ( $g ) { return self::GROUPS[ $g ][0]; }, $r['groups'] ) ) . '): ' . $r['users'] . ' نفر (' . $r['created'] . ' حساب جدید ساخته شد)، ' . $r['rows'] . ' ردیف اطلاعات. نسخه قبلی هم در فهرست پشتیبان‌ها ذخیره شد.' );
	}

	public static function handle_reset() {
		self::guard( 'mp_backup_reset' );
		$word = isset( $_POST['confirm_word'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['confirm_word'] ) ) ) : '';
		if ( 'ریست' !== $word && 'RESET' !== strtoupper( $word ) ) {
			self::back( 'error', 'برای پاک کردن، کلمه «ریست» را در کادر بنویسید.' );
		}
		if ( ! empty( $_POST['factory'] ) ) {
			$r = self::reset( ! empty( $_POST['people'] ) );
			if ( is_wp_error( $r ) ) {
				self::back( 'error', $r->get_error_message() );
			}
			self::back( 'success', 'پنل به حالت روز اول برگشت. یک پشتیبان از وضعیت قبل در فهرست پشتیبان‌ها ذخیره شد.' );
		}
		$items = isset( $_POST['items'] ) && is_array( $_POST['items'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['items'] ) ) : array(); // phpcs:ignore
		if ( ! $items ) {
			self::back( 'error', 'مواردی را که باید پاک شوند تیک بزنید.' );
		}
		$r = self::reset_items( $items );
		if ( is_wp_error( $r ) ) {
			self::back( 'error', $r->get_error_message() );
		}
		self::back( 'success', 'پاک شد: ' . implode( '، ', array_map( function ( $k ) { return isset( self::RESET_ITEMS[ $k ] ) ? self::RESET_ITEMS[ $k ][1] : $k; }, $items ) ) . '. یک پشتیبان از وضعیت قبل در فهرست پشتیبان‌ها ذخیره شد و با «بازگردانی» برمی‌گردد.' );
	}

	/** Checkboxes for the sections, with «همه». $checked: tick all by default. */
	private static function boxes( $checked, $danger = false ) {
		$id = 'mpg' . wp_rand( 1000, 9999 );
		echo '<fieldset class="mp-groups" id="' . esc_attr( $id ) . '" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px 16px;max-width:760px;margin:8px 0;padding:10px 14px;border:1px solid ' . ( $danger ? '#d63638' : '#c3c4c7' ) . ';border-radius:6px;background:#fff">';
		echo '<label style="grid-column:1/-1;font-weight:700"><input type="checkbox" onclick="var c=this.checked;this.closest(\'fieldset\').querySelectorAll(\'input[name^=groups]\').forEach(function(i){i.checked=c})"' . ( $checked ? ' checked' : '' ) . '> همه بخش‌ها</label>';
		foreach ( self::GROUPS as $k => $g ) {
			echo '<label><input type="checkbox" name="groups[]" value="' . esc_attr( $k ) . '"' . ( $checked ? ' checked' : '' ) . '> ' . esc_html( $g[0] ) . '</label>';
		}
		echo '</fieldset>';
	}

	/** Settings page section. */
	public static function section() {
		$post = esc_url( admin_url( 'admin-post.php' ) );
		?>
		<h2 id="mp-backup">پشتیبان‌گیری، بازگردانی و بازنشانی</h2>
		<p>پشتیبان شامل همه اطلاعات پنل (تسک‌ها، پروژه‌ها، پیام‌ها، حسابداری، حضور و مرخصی، …)، تنظیمات، نقش و شماره موبایل کارمندان و فایل‌ها و عکس‌هاست.
		<strong>فایل پشتیبان کلیدهای پیامک و ربات‌ها را هم دارد؛ آن را جای امن نگه دارید.</strong></p>

		<h3>خروجی گرفتن</h3>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>">
			<?php wp_nonce_field( 'mp_backup_export' ); ?>
			<input type="hidden" name="action" value="mp_backup_export">
			<p class="description">تیک بزنید از چه بخش‌هایی خروجی گرفته شود.</p>
			<?php self::boxes( true ); ?>
			<?php submit_button( 'دانلود فایل پشتیبان', 'primary', 'submit', false ); ?>
		</form>

		<h3>بازگردانی از فایل</h3>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>" enctype="multipart/form-data">
			<?php wp_nonce_field( 'mp_backup_import' ); ?>
			<input type="hidden" name="action" value="mp_backup_import">
			<p><input type="file" name="backup" accept=".zip,.json" required></p>
			<p class="description">فقط بخش‌های تیک‌خورده جایگزین می‌شوند؛ بقیه دست نمی‌خورند.</p>
			<?php self::boxes( true ); ?>
			<p><label><input type="checkbox" name="confirm" value="1" required> می‌دانم اطلاعات فعلی پنل با این فایل جایگزین می‌شود (قبلش خودکار پشتیبان گرفته می‌شود).</label></p>
			<p class="description">کارمندان با نام کاربری، ایمیل یا شماره موبایل پیدا می‌شوند؛ اگر در این سایت نباشند، حسابشان ساخته می‌شود. پس می‌توانید پنل را به سایت دیگری منتقل کنید.</p>
			<?php submit_button( 'بازگردانی', 'secondary', 'submit', false ); ?>
		</form>

		<?php $list = self::saved(); ?>
		<?php if ( $list ) : ?>
			<h3>پشتیبان‌های ذخیره‌شده روی سایت</h3>
			<p class="description">قبل از هر بازگردانی و بازنشانی یک نسخه خودکار ساخته می‌شود (<?php echo (int) self::KEEP; ?> نسخه آخر نگه داشته می‌شود).</p>
			<table class="widefat striped" style="max-width:760px">
				<thead><tr><th>زمان</th><th>نوع</th><th>حجم</th><th></th></tr></thead>
				<tbody>
				<?php foreach ( $list as $b ) : ?>
					<?php $kind = false !== strpos( $b['name'], 'before-reset' ) ? 'قبل از بازنشانی' : ( false !== strpos( $b['name'], 'before-import' ) ? 'قبل از بازگردانی' : 'خروجی دستی' ); ?>
					<tr>
						<td><?php echo esc_html( MP_Jalali::format( wp_date( 'Y-m-d', $b['time'] ) ) . ' ' . MP_Jalali::digits( wp_date( 'H:i', $b['time'] ) ) ); ?></td>
						<td><?php echo esc_html( $kind ); ?></td>
						<td dir="ltr"><?php echo esc_html( size_format( $b['size'] ) ); ?></td>
						<td>
							<form method="post" action="<?php echo $post; // phpcs:ignore ?>" style="display:inline">
								<?php wp_nonce_field( 'mp_backup_download' ); ?>
								<input type="hidden" name="action" value="mp_backup_download"><input type="hidden" name="file" value="<?php echo esc_attr( $b['name'] ); ?>">
								<button class="button button-small">دانلود</button>
							</form>
							<form method="post" action="<?php echo $post; // phpcs:ignore ?>" style="display:inline" onsubmit="return confirm('اطلاعات فعلی پنل با این نسخه جایگزین شود؟ (همه بخش‌های موجود در فایل)');">
								<?php wp_nonce_field( 'mp_backup_restore' ); ?>
								<input type="hidden" name="action" value="mp_backup_restore"><input type="hidden" name="file" value="<?php echo esc_attr( $b['name'] ); ?>">
								<button class="button button-small">بازگردانی</button>
							</form>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>

		<h3 style="color:#b32d2e">پاک کردن اطلاعات</h3>
		<?php $mp_counts = self::reset_counts(); $mp_heads = array(); foreach ( self::RESET_ITEMS as $k => $it ) { $mp_heads[ $it[0] ][ $k ] = $it[1]; } ?>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>" id="mp-reset" onsubmit="var n=[].slice.call(this.querySelectorAll('input[name^=items]:checked')).map(function(i){return '• '+i.dataset.label});if(!n.length){alert('چیزی انتخاب نشده');return false;}return confirm('این موارد کلاً پاک شوند؟\n\n'+n.join('\n')+'\n\n(قبلش یک پشتیبان خودکار گرفته می‌شود)');" style="border:1px solid #d63638;border-radius:8px;padding:14px 18px;max-width:820px;background:#fcf0f1">
			<?php wp_nonce_field( 'mp_backup_reset' ); ?>
			<input type="hidden" name="action" value="mp_backup_reset">
			<p style="margin-top:0">هر مورد جدا پاک می‌شود و بقیه دست نمی‌خورند؛ مثلاً فقط «قراردادها» بدون قالب‌های قرارداد، یا فقط «پیش‌فاکتورها». عدد کنار هر مورد، تعداد فعلی آن است. قبل از پاک کردن خودکار پشتیبان گرفته می‌شود.</p>
			<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">
			<?php foreach ( $mp_heads as $mp_h => $mp_list ) : ?>
				<fieldset style="border:1px solid #e0b4b4;border-radius:8px;padding:8px 12px;background:#fff;margin:0">
					<legend style="font-weight:700;padding:0 6px"><?php echo esc_html( $mp_h ); ?></legend>
					<?php foreach ( $mp_list as $k => $label ) : ?>
						<label style="display:flex;gap:6px;align-items:flex-start;margin:4px 0;line-height:1.6"><input type="checkbox" name="items[]" value="<?php echo esc_attr( $k ); ?>" data-label="<?php echo esc_attr( $label ); ?>" style="margin-top:4px">
							<span><?php echo esc_html( $label ); ?><?php if ( null !== $mp_counts[ $k ] ) : ?> <span style="color:<?php echo $mp_counts[ $k ] ? '#b32d2e' : '#8c8f94'; ?>;font-size:12px">(<?php echo esc_html( MP_Jalali::digits( (string) $mp_counts[ $k ] ) ); ?>)</span><?php endif; ?></span></label>
					<?php endforeach; ?>
				</fieldset>
			<?php endforeach; ?>
			</div>
			<p><label>برای تأیید بنویسید «ریست»: <input name="confirm_word" autocomplete="off" required style="width:90px"></label>
			<?php submit_button( 'پاک کردن موارد انتخاب‌شده', 'delete', 'submit', false ); ?></p>
		</form>

		<h3 style="color:#b32d2e">بازنشانی کارخانه</h3>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>" onsubmit="return confirm('همه اطلاعات پنل پاک شود و افزونه مثل روز اول شود؟\n(قبلش یک پشتیبان خودکار گرفته می‌شود)');" style="border:1px solid #d63638;border-radius:8px;padding:12px 18px;max-width:820px;background:#fcf0f1">
			<?php wp_nonce_field( 'mp_backup_reset' ); ?>
			<input type="hidden" name="action" value="mp_backup_reset"><input type="hidden" name="factory" value="1">
			<p style="margin-top:0">همه چیز پاک می‌شود و افزونه مثل روز اول نصب می‌شود.</p>
			<p><label><input type="radio" name="people" value="" checked> کارمندان بمانند — نقش، شماره موبایل، سمت، عکس و تنظیمات شخصی‌شان می‌ماند و بلافاصله می‌توانند وارد شوند</label><br>
			<label><input type="radio" name="people" value="1"> کارمندان هم ریست شوند — نقش‌های پنل، شماره‌ها و عکس‌ها پاک می‌شود (حساب‌های کاربری وردپرس حذف نمی‌شوند)</label></p>
			<p><label>برای تأیید بنویسید «ریست»: <input name="confirm_word" autocomplete="off" required style="width:90px"></label>
			<?php submit_button( 'بازنشانی کامل', 'delete', 'submit', false ); ?></p>
		</form>
		<?php
	}
}

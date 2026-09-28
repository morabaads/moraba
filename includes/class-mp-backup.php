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
	const TABLES  = array( 'folders', 'projects', 'project_members', 'sections', 'milestones', 'tasks', 'goals', 'notes', 'channels', 'messages', 'reads', 'meetings', 'meeting_people', 'reminders', 'notifications', 'ledger', 'task_items', 'task_comments', 'files', 'attendance', 'leaves', 'templates', 'timelog', 'audit', 'channel_members', 'daily_reports', 'invoices', 'client_items', 'design_pins' );
	const OPTIONS = array( 'mp_slug', 'mp_page_id', 'mp_support', 'mp_email_notifications', 'mp_telegram_token', 'mp_bale_token', 'mp_sms_provider', 'mp_sms_key', 'mp_sms_sender', 'mp_smsir_key', 'mp_smsir_line', 'mp_smsir_template', 'mp_smsir_param', 'mp_vapid_private', 'mp_vapid_public', 'mp_speech_key', 'mp_speech_url', 'mp_speech_stt_model', 'mp_speech_tts_model', 'mp_speech_voice', 'mp_payroll', 'mp_payroll_holidays', 'mp_payroll_adj', 'mp_daily_report', 'mp_invoice_settings', 'mp_digest' );
	const META    = array( 'mp_prefs', 'mp_job_title', 'mp_phone', 'mp_avatar_public', 'mp_avatar_file', 'mp_telegram_chat', 'mp_bale_chat', 'mp_push_subs', 'mp_last_seen', 'mp_hourly_rate', 'mp_pay' );
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

	public static function data() {
		global $wpdb;
		$data = array(
			'format'  => self::FORMAT,
			'version' => MP_VERSION,
			'db'      => MP_DB_VERSION,
			'site'    => home_url( '/' ),
			'created' => gmdate( 'c' ),
			'options' => array(),
			'users'   => array(),
			'tables'  => array(),
		);
		foreach ( self::OPTIONS as $o ) {
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
		foreach ( self::TABLES as $t ) {
			$data['tables'][ $t ] = $wpdb->get_results( 'SELECT * FROM ' . MP_Install::table( $t ), ARRAY_A ); // phpcs:ignore
		}
		return $data;
	}

	/** Writes a backup into the protected folder and returns its path (or WP_Error). */
	public static function write( $label = 'backup', $protect = '' ) {
		$data = self::data();
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
			self::zip_dir( $zip, MP_Files::dir(), 'files', array( 'index.php', '.htaccess' ) );
			self::zip_dir( $zip, MP_Util::avatar_dir(), 'avatars', array( 'index.php' ) );
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
	public static function import( $path ) {
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
		self::wipe_tables();
		$rows = 0;
		foreach ( self::TABLES as $t ) {
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
		foreach ( self::OPTIONS as $o ) {
			if ( array_key_exists( $o, (array) $data['options'] ) ) {
				update_option( $o, $data['options'][ $o ], false );
			} else {
				delete_option( $o );
			}
		}

		// 4. Files.
		if ( $zip ) {
			self::empty_dir( MP_Files::dir(), array( 'index.php', '.htaccess' ) );
			self::empty_dir( MP_Util::avatar_dir(), array( 'index.php' ) );
			for ( $i = 0; $i < $zip->numFiles; $i++ ) {
				$name = $zip->getNameIndex( $i );
				if ( false !== strpos( $name, '..' ) || ! preg_match( '#^(files|avatars)/(.+)$#', $name, $m ) ) {
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
		return array( 'users' => count( $map ), 'created' => $created, 'rows' => $rows );
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

	private static function wipe_tables() {
		global $wpdb;
		foreach ( self::TABLES as $t ) {
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
		$path = self::write( 'export' );
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
		self::finish_import( self::import( $_FILES['backup']['tmp_name'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	}

	public static function handle_restore() {
		self::guard( 'mp_backup_restore' );
		$name = isset( $_POST['file'] ) ? basename( sanitize_file_name( wp_unslash( $_POST['file'] ) ) ) : '';
		$path = self::dir() . '/' . $name;
		if ( ! $name || ! is_file( $path ) ) {
			self::back( 'error', 'فایل پشتیبان پیدا نشد.' );
		}
		self::finish_import( self::import( $path ) );
	}

	private static function finish_import( $r ) {
		if ( is_wp_error( $r ) ) {
			self::back( 'error', $r->get_error_message() );
		}
		self::back( 'success', 'پشتیبان بازگردانی شد: ' . $r['users'] . ' نفر (' . $r['created'] . ' حساب جدید ساخته شد)، ' . $r['rows'] . ' ردیف اطلاعات. نسخه قبلی هم در فهرست پشتیبان‌ها ذخیره شد.' );
	}

	public static function handle_reset() {
		self::guard( 'mp_backup_reset' );
		$word = isset( $_POST['confirm_word'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['confirm_word'] ) ) ) : '';
		if ( 'ریست' !== $word && 'RESET' !== strtoupper( $word ) ) {
			self::back( 'error', 'برای بازنشانی، کلمه «ریست» را در کادر بنویسید.' );
		}
		$r = self::reset( ! empty( $_POST['people'] ) );
		if ( is_wp_error( $r ) ) {
			self::back( 'error', $r->get_error_message() );
		}
		self::back( 'success', 'پنل به حالت اولیه برگشت. یک پشتیبان از وضعیت قبل در فهرست زیر ذخیره شد و با «بازگردانی» برمی‌گردد.' );
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
			<?php submit_button( 'دانلود فایل پشتیبان', 'primary', 'submit', false ); ?>
		</form>

		<h3>بازگردانی از فایل</h3>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>" enctype="multipart/form-data">
			<?php wp_nonce_field( 'mp_backup_import' ); ?>
			<input type="hidden" name="action" value="mp_backup_import">
			<p><input type="file" name="backup" accept=".zip,.json" required></p>
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
							<form method="post" action="<?php echo $post; // phpcs:ignore ?>" style="display:inline" onsubmit="return confirm('اطلاعات فعلی پنل با این نسخه جایگزین شود؟');">
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

		<h3 style="color:#b32d2e">بازنشانی کارخانه (ریست)</h3>
		<form method="post" action="<?php echo $post; // phpcs:ignore ?>" onsubmit="return confirm('همه اطلاعات و تنظیمات پنل پاک شود؟ (یک پشتیبان خودکار گرفته می‌شود)');" style="border:1px solid #d63638;border-radius:6px;padding:12px 16px;max-width:760px;background:#fcf0f1">
			<?php wp_nonce_field( 'mp_backup_reset' ); ?>
			<input type="hidden" name="action" value="mp_backup_reset">
			<p>همه تسک‌ها، پروژه‌ها، پیام‌ها، حسابداری، حضور، مرخصی، یادآوری‌ها، پیوست‌ها و تنظیمات پنل پاک می‌شود و افزونه مثل روز اول نصب می‌شود.</p>
			<p><strong>کارمندان:</strong><br>
			<label><input type="radio" name="people" value="" checked> کارمندان شامل ریست نشوند — نقش، شماره موبایل، سمت، عکس پروفایل و تنظیمات شخصی‌شان می‌ماند و بلافاصله می‌توانند وارد شوند</label><br>
			<label><input type="radio" name="people" value="1"> کارمندان هم ریست شوند — نقش‌های پنل، شماره‌ها و عکس‌ها پاک می‌شود (خود حساب‌های کاربری وردپرس حذف نمی‌شوند)</label></p>
			<p><label>برای تأیید بنویسید «ریست»: <input name="confirm_word" autocomplete="off" required style="width:90px"></label>
			<?php submit_button( 'بازنشانی کامل پنل', 'delete', 'submit', false ); ?></p>
		</form>
		<?php
	}
}

<?php
defined( 'ABSPATH' ) || exit;

/**
 * Tables, roles and capabilities.
 *
 * mp_access_panel  → can open the panel (employees and managers).
 * mp_manage_panel  → can assign locked tasks, manage projects, members and folders.
 */
class MP_Install {

	public static function activate() {
		self::create_tables();
		MP_Templates::seed();
		self::add_roles();
		MP_Frontend::add_rewrite();
		flush_rewrite_rules();
		MP_Cron::schedule();
		update_option( 'mp_db_version', MP_DB_VERSION );
	}

	public static function deactivate() {
		MP_Cron::unschedule();
		flush_rewrite_rules();
	}

	public static function maybe_upgrade() {
		// Roles also go missing when the plugin files are replaced without reactivation.
		if ( ! self::roles_ok() ) {
			self::add_roles();
		}
		if ( get_option( 'mp_db_version' ) !== MP_DB_VERSION ) {
			self::create_tables();
			self::add_roles();
			MP_Templates::seed();
			MP_Costs::migrate();
			MP_Client::migrate_customers();
			// $wp_rewrite does not exist yet on plugins_loaded; flush on init instead.
			update_option( 'mp_flush_rewrite', 1 );
			update_option( 'mp_db_version', MP_DB_VERSION );
		}
	}

	const ROLE_CAPS = array(
		'moraba_employee' => array( 'read', 'mp_access_panel' ),
		'moraba_manager'  => array( 'read', 'mp_access_panel', 'mp_manage_panel', 'list_users' ),
	);

	/** Roles exist, carry their panel caps and the current names (a role editor or old version may have changed them). */
	private static function roles_ok() {
		foreach ( self::ROLE_CAPS as $slug => $caps ) {
			$role = get_role( $slug );
			if ( ! $role ) {
				return false;
			}
			foreach ( $caps as $cap ) {
				if ( ! $role->has_cap( $cap ) ) {
					return false;
				}
			}
		}
		return 'ناظر مربع' === wp_roles()->role_names['moraba_manager'];
	}

	public static function add_roles() {
		// Remove + re-add keeps users' role assignments (stored by slug) and refreshes names/caps.
		foreach ( array( 'moraba_employee', 'moraba_manager' ) as $slug ) {
			$role = get_role( $slug );
			if ( $role && wp_roles()->role_names[ $slug ] !== ( 'moraba_employee' === $slug ? 'کارمند مربع' : 'ناظر مربع' ) ) {
				remove_role( $slug );
			}
		}
		add_role( 'moraba_employee', 'کارمند مربع', array( 'read' => true, 'mp_access_panel' => true ) );
		add_role( 'moraba_manager', 'ناظر مربع', array( 'read' => true, 'mp_access_panel' => true, 'mp_manage_panel' => true, 'list_users' => true ) );
		// add_role() never touches an existing role, so grant any missing caps explicitly.
		foreach ( self::ROLE_CAPS as $slug => $caps ) {
			$role = get_role( $slug );
			foreach ( $role ? $caps : array() as $cap ) {
				if ( ! $role->has_cap( $cap ) ) {
					$role->add_cap( $cap );
				}
			}
		}
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			$admin->add_cap( 'mp_access_panel' );
			$admin->add_cap( 'mp_manage_panel' );
		}
	}

	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'mp_' . $name;
	}

	public static function create_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();
		$t = array();

		$t[] = 'CREATE TABLE ' . self::table( 'folders' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			name varchar(120) NOT NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'projects' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			name varchar(160) NOT NULL,
			icon varchar(20) NOT NULL DEFAULT 'grid',
			folder_id bigint(20) unsigned NOT NULL DEFAULT 0,
			status varchar(20) NOT NULL DEFAULT 'doing',
			start_date date DEFAULT NULL,
			end_date date DEFAULT NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'project_members' ) . " (
			project_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (project_id,user_id),
			KEY user_id (user_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'sections' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			title varchar(160) NOT NULL,
			priority varchar(20) NOT NULL DEFAULT 'medium',
			status varchar(20) NOT NULL DEFAULT 'doing',
			sort int(11) NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'milestones' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			title varchar(160) NOT NULL,
			start_date date NOT NULL,
			end_date date NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'waiting',
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;";

		// source: manager = assigned by a manager, locked for the employee; self = the employee's own task.
		$t[] = 'CREATE TABLE ' . self::table( 'tasks' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			title varchar(200) NOT NULL,
			description text NULL,
			task_date date NOT NULL,
			task_time varchar(5) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			section_id bigint(20) unsigned NOT NULL DEFAULT 0,
			priority varchar(20) NOT NULL DEFAULT 'medium',
			status varchar(20) NOT NULL DEFAULT 'todo',
			source varchar(10) NOT NULL DEFAULT 'self',
			assigned_by bigint(20) unsigned NOT NULL DEFAULT 0,
			done_at datetime DEFAULT NULL,
			recurrence varchar(10) NOT NULL DEFAULT 'none',
			recur_parent bigint(20) unsigned NOT NULL DEFAULT 0,
			seen_at datetime DEFAULT NULL,
			time_spent int(11) unsigned NOT NULL DEFAULT 0,
			timer_started datetime DEFAULT NULL,
			archived_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_date (user_id,task_date),
			KEY recur_parent (recur_parent),
			KEY project_id (project_id),
			KEY section_id (section_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'goals' ) . " (
			user_id bigint(20) unsigned NOT NULL,
			week_start date NOT NULL,
			text varchar(200) NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (user_id,week_start)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'notes' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			title varchar(160) NOT NULL,
			body text NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;";

		// type: project | direct | client.
		$t[] = 'CREATE TABLE ' . self::table( 'channels' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			type varchar(10) NOT NULL,
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			title varchar(160) NOT NULL DEFAULT '',
			client_name varchar(120) NOT NULL DEFAULT '',
			token varchar(64) NOT NULL DEFAULT '',
			user_a bigint(20) unsigned NOT NULL DEFAULT 0,
			user_b bigint(20) unsigned NOT NULL DEFAULT 0,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			archived_at datetime DEFAULT NULL,
			logo_file_id bigint(20) unsigned NOT NULL DEFAULT 0,
			auth_required tinyint(1) NOT NULL DEFAULT 0,
			client_id bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY project_id (project_id),
			KEY token (token),
			KEY client_id (client_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'contracts' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			number varchar(30) NOT NULL DEFAULT '',
			title varchar(200) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			client_id bigint(20) unsigned NOT NULL DEFAULT 0,
			client_name varchar(160) NOT NULL DEFAULT '',
			template_id bigint(20) unsigned NOT NULL DEFAULT 0,
			body longtext NOT NULL,
			vars longtext NULL,
			status varchar(12) NOT NULL DEFAULT 'draft',
			token varchar(40) NOT NULL DEFAULT '',
			studio_signer bigint(20) unsigned NOT NULL DEFAULT 0,
			sent_at datetime DEFAULT NULL,
			signed_at datetime DEFAULT NULL,
			signer_name varchar(120) NOT NULL DEFAULT '',
			signer_mobile varchar(20) NOT NULL DEFAULT '',
			signer_ip varchar(64) NOT NULL DEFAULT '',
			signer_ua varchar(255) NOT NULL DEFAULT '',
			sign_method varchar(10) NOT NULL DEFAULT '',
			client_sig longtext NULL,
			doc_hash varchar(64) NOT NULL DEFAULT '',
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			archived_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY token (token),
			KEY project_id (project_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'contract_templates' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			title varchar(160) NOT NULL DEFAULT '',
			body longtext NOT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id)
		) $c;";

		// Customers: one record per client company/person, linked to any number of projects.
		$t[] = 'CREATE TABLE ' . self::table( 'clients' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			name varchar(160) NOT NULL DEFAULT '',
			phone varchar(40) NOT NULL DEFAULT '',
			info text NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			archived_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY name (name)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'client_projects' ) . " (
			client_id bigint(20) unsigned NOT NULL,
			project_id bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (client_id,project_id),
			KEY project_id (project_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'client_contacts' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			channel_id bigint(20) unsigned NOT NULL,
			name varchar(80) NOT NULL DEFAULT '',
			mobile varchar(20) NOT NULL DEFAULT '',
			last_login datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY channel_mobile (channel_id,mobile)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'channel_members' ) . " (
			channel_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (channel_id,user_id),
			KEY user_id (user_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'invoices' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			kind varchar(10) NOT NULL DEFAULT 'invoice',
			number varchar(30) NOT NULL DEFAULT '',
			title varchar(200) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			client_id bigint(20) unsigned NOT NULL DEFAULT 0,
			client_name varchar(160) NOT NULL DEFAULT '',
			client_phone varchar(40) NOT NULL DEFAULT '',
			client_info text NULL,
			items longtext NOT NULL,
			discount bigint(20) unsigned NOT NULL DEFAULT 0,
			tax_percent tinyint(3) unsigned NOT NULL DEFAULT 0,
			status varchar(12) NOT NULL DEFAULT 'draft',
			issue_date date NOT NULL,
			due_date date DEFAULT NULL,
			note text NULL,
			pay_url varchar(500) NOT NULL DEFAULT '',
			pay_gateway varchar(12) NOT NULL DEFAULT '',
			pay_track varchar(80) NOT NULL DEFAULT '',
			pay_ref varchar(80) NOT NULL DEFAULT '',
			token varchar(40) NOT NULL DEFAULT '',
			ledger_id bigint(20) unsigned NOT NULL DEFAULT 0,
			paid_at datetime DEFAULT NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			archived_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY token (token),
			KEY project_id (project_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'client_items' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			project_id bigint(20) unsigned NOT NULL,
			kind varchar(10) NOT NULL DEFAULT 'file',
			title varchar(200) NOT NULL DEFAULT '',
			note text NULL,
			file_id bigint(20) unsigned NOT NULL DEFAULT 0,
			version int(11) unsigned NOT NULL DEFAULT 1,
			parent_id bigint(20) unsigned NOT NULL DEFAULT 0,
			status varchar(12) NOT NULL DEFAULT 'pending',
			decision_note text NULL,
			decided_by varchar(80) NOT NULL DEFAULT '',
			decided_at datetime DEFAULT NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			archived_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY project_id (project_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'design_pins' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			item_id bigint(20) unsigned NOT NULL,
			parent_id bigint(20) unsigned NOT NULL DEFAULT 0,
			x decimal(6,3) NOT NULL DEFAULT 0,
			y decimal(6,3) NOT NULL DEFAULT 0,
			body text NOT NULL,
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			author_name varchar(80) NOT NULL DEFAULT '',
			resolved tinyint(1) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY item_id (item_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'daily_reports' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			report_date date NOT NULL,
			done_text text NOT NULL,
			progress tinyint(3) unsigned NOT NULL DEFAULT 0,
			problems text NULL,
			decisions text NULL,
			tomorrow text NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY user_date (user_id,report_date),
			KEY report_date (report_date)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'messages' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			channel_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			guest_name varchar(80) NOT NULL DEFAULT '',
			body text NOT NULL,
			file_id bigint(20) unsigned NOT NULL DEFAULT 0,
			transcript text NULL,
			kind varchar(20) NOT NULL DEFAULT '',
			meta varchar(255) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			deleted_at datetime NULL,
			deleted_by bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY channel_id (channel_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'reads' ) . " (
			channel_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			last_id bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (channel_id,user_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'meetings' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			title varchar(160) NOT NULL,
			meeting_date date NOT NULL,
			meeting_time varchar(5) NOT NULL,
			url varchar(500) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			created_by bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY meeting_date (meeting_date)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'meeting_people' ) . " (
			meeting_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (meeting_id,user_id),
			KEY user_id (user_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'reminders' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			title varchar(160) NOT NULL,
			note text NULL,
			remind_date date NOT NULL,
			remind_time varchar(5) NOT NULL,
			repeat_every varchar(10) NOT NULL DEFAULT 'none',
			fired_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_id (user_id),
			KEY due (remind_date,remind_time)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'notifications' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			type varchar(20) NOT NULL,
			title varchar(200) NOT NULL,
			detail varchar(255) NOT NULL DEFAULT '',
			target varchar(40) NOT NULL DEFAULT '',
			ref_id bigint(20) unsigned NOT NULL DEFAULT 0,
			is_read tinyint(1) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_read (user_id,is_read)
		) $c;";

		// Accounting: every income or expense with its date and time; amounts in toman.
		$t[] = 'CREATE TABLE ' . self::table( 'ledger' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			type varchar(10) NOT NULL,
			amount bigint(20) unsigned NOT NULL,
			title varchar(200) NOT NULL,
			note text NULL,
			entry_date date NOT NULL,
			entry_time varchar(5) NOT NULL DEFAULT '',
			category varchar(60) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			file_id bigint(20) unsigned NOT NULL DEFAULT 0,
			user_id bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY entry (entry_date,entry_time)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'task_items' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			task_id bigint(20) unsigned NOT NULL,
			text varchar(200) NOT NULL,
			done tinyint(1) NOT NULL DEFAULT 0,
			sort int(11) NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY task_id (task_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'task_comments' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			task_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			body text NOT NULL,
			file_id bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY task_id (task_id)
		) $c;";

		// Uploaded files live outside the media library with random names; served only through MP_Files.
		$t[] = 'CREATE TABLE ' . self::table( 'files' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			context varchar(10) NOT NULL,
			context_id bigint(20) unsigned NOT NULL DEFAULT 0,
			name varchar(200) NOT NULL,
			mime varchar(100) NOT NULL,
			size bigint(20) unsigned NOT NULL DEFAULT 0,
			path varchar(255) NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY ctx (context,context_id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'attendance' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			work_date date NOT NULL,
			check_in datetime NOT NULL,
			check_out datetime DEFAULT NULL,
			note varchar(200) NOT NULL DEFAULT '',
			PRIMARY KEY  (id),
			KEY user_date (user_id,work_date)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'leaves' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			kind varchar(10) NOT NULL DEFAULT 'daily',
			start_date date NOT NULL,
			end_date date NOT NULL,
			from_time varchar(5) NOT NULL DEFAULT '',
			to_time varchar(5) NOT NULL DEFAULT '',
			reason varchar(500) NOT NULL DEFAULT '',
			status varchar(10) NOT NULL DEFAULT 'pending',
			reviewed_by bigint(20) unsigned NOT NULL DEFAULT 0,
			review_note varchar(300) NOT NULL DEFAULT '',
			reviewed_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_id (user_id),
			KEY dates (start_date,end_date)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'templates' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			name varchar(120) NOT NULL,
			description varchar(500) NOT NULL DEFAULT '',
			roles text NOT NULL,
			items longtext NOT NULL,
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'timelog' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			task_id bigint(20) unsigned NOT NULL,
			task_title varchar(200) NOT NULL DEFAULT '',
			project_id bigint(20) unsigned NOT NULL DEFAULT 0,
			user_id bigint(20) unsigned NOT NULL,
			work_date date NOT NULL,
			seconds int(11) unsigned NOT NULL DEFAULT 0,
			rate bigint(20) unsigned NOT NULL DEFAULT 0,
			source varchar(10) NOT NULL DEFAULT 'timer',
			note varchar(200) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY task (task_id),
			KEY project (project_id,work_date),
			KEY person (user_id,work_date)
		) $c;";

		$t[] = 'CREATE TABLE ' . self::table( 'audit' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			action varchar(20) NOT NULL,
			object_type varchar(20) NOT NULL,
			object_id bigint(20) unsigned NOT NULL DEFAULT 0,
			summary varchar(300) NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY object (object_type,object_id),
			KEY created_at (created_at)
		) $c;";

		foreach ( $t as $sql ) {
			dbDelta( $sql );
		}
	}
}

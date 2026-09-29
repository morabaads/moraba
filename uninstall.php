<?php
/**
 * Removes the panel's tables, roles and options when the plugin is deleted from WordPress.
 */
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;
$tables = array( 'folders', 'projects', 'project_members', 'sections', 'milestones', 'tasks', 'goals', 'notes', 'channels', 'messages', 'reads', 'meetings', 'meeting_people', 'reminders', 'notifications', 'ledger', 'task_items', 'task_comments', 'files', 'attendance', 'leaves', 'templates', 'timelog', 'audit', 'channel_members', 'daily_reports', 'invoices', 'client_items', 'design_pins', 'client_contacts' );
foreach ( $tables as $name ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'mp_' . $name ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
}
foreach ( array( 'mp_db_version', 'mp_slug', 'mp_support', 'mp_templates_seeded', 'mp_timelog_migrated', 'mp_payroll', 'mp_payroll_holidays', 'mp_payroll_adj', 'mp_page_id', 'mp_email_notifications', 'mp_telegram_token', 'mp_bale_token', 'mp_sms_provider', 'mp_sms_key', 'mp_sms_sender', 'mp_smsir_key', 'mp_smsir_line', 'mp_smsir_template', 'mp_smsir_param', 'mp_vapid_private', 'mp_vapid_public', 'mp_speech_key', 'mp_speech_url', 'mp_speech_stt_model', 'mp_speech_tts_model', 'mp_speech_voice', 'mp_ai_key', 'mp_ai_url', 'mp_ai_model', 'mp_digest', 'mp_daily_report', 'mp_invoice_settings' ) as $option ) {
	delete_option( $option );
}
delete_metadata( 'user', 0, 'mp_prefs', '', true );
delete_metadata( 'user', 0, 'mp_last_seen', '', true );
delete_metadata( 'user', 0, 'mp_job_title', '', true );
delete_metadata( 'user', 0, 'mp_phone', '', true );
foreach ( array( 'mp_avatar_file', 'mp_avatar_public', 'mp_telegram_chat', 'mp_bale_chat', 'mp_push_subs' ) as $meta ) {
	delete_metadata( 'user', 0, $meta, '', true );
}
remove_role( 'moraba_employee' );
remove_role( 'moraba_manager' );
$admin = get_role( 'administrator' );
if ( $admin ) {
	$admin->remove_cap( 'mp_access_panel' );
	$admin->remove_cap( 'mp_manage_panel' );
}
wp_clear_scheduled_hook( 'mp_tick' );
$up = wp_upload_dir( null, false );
foreach ( array( 'moraba-panel', 'moraba-avatars' ) as $sub ) {
	$dir = trailingslashit( $up['basedir'] ) . $sub;
	if ( is_dir( $dir ) ) {
		$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST );
		foreach ( $it as $f ) {
			$f->isDir() ? rmdir( $f->getPathname() ) : unlink( $f->getPathname() ); // phpcs:ignore
		}
		rmdir( $dir ); // phpcs:ignore
	}
}

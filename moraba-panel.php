<?php
/**
 * Plugin Name:       پنل کارمندان مربع
 * Description:       پنل کاری کارمندان مربع استودیو: میز کار، پروژه‌ها، تسک‌ها، تقویم شمسی با تسک‌های تعیین‌شده توسط ناظر، پیام‌ها، جلسات و یادآوری‌ها. نمایش با آدرس /panel یا شورت‌کد [moraba_panel].
 * Version:           3.8.3
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Moraba Studio
 * License:           GPLv2 or later
 * Text Domain:       moraba-panel
 */

defined( 'ABSPATH' ) || exit;

define( 'MP_VERSION', '3.8.3' );
define( 'MP_DB_VERSION', '11' );
define( 'MP_FILE', __FILE__ );
define( 'MP_DIR', plugin_dir_path( __FILE__ ) );
define( 'MP_URL', plugin_dir_url( __FILE__ ) );

require_once MP_DIR . 'includes/class-mp-install.php';
require_once MP_DIR . 'includes/class-mp-util.php';
require_once MP_DIR . 'includes/class-mp-jalali.php';
require_once MP_DIR . 'includes/class-mp-audit.php';
require_once MP_DIR . 'includes/class-mp-files.php';
require_once MP_DIR . 'includes/class-mp-export.php';
require_once MP_DIR . 'includes/class-mp-auth.php';
require_once MP_DIR . 'includes/class-mp-notify.php';
require_once MP_DIR . 'includes/class-mp-push.php';
require_once MP_DIR . 'includes/class-mp-speech.php';
require_once MP_DIR . 'includes/class-mp-rest.php';
require_once MP_DIR . 'includes/class-mp-rest-work.php';
require_once MP_DIR . 'includes/class-mp-templates.php';
require_once MP_DIR . 'includes/class-mp-task-io.php';
require_once MP_DIR . 'includes/class-mp-daily.php';
require_once MP_DIR . 'includes/class-mp-invoices.php';
require_once MP_DIR . 'includes/class-mp-portal.php';
require_once MP_DIR . 'includes/class-mp-digest.php';
require_once MP_DIR . 'includes/class-mp-ai.php';
require_once MP_DIR . 'includes/class-mp-brain.php';
require_once MP_DIR . 'includes/class-mp-client.php';
require_once MP_DIR . 'includes/class-mp-costs.php';
require_once MP_DIR . 'includes/class-mp-payroll.php';
require_once MP_DIR . 'includes/class-mp-frontend.php';
require_once MP_DIR . 'includes/class-mp-cron.php';
require_once MP_DIR . 'includes/class-mp-admin.php';
require_once MP_DIR . 'includes/class-mp-backup.php';

register_activation_hook( __FILE__, array( 'MP_Install', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'MP_Install', 'deactivate' ) );

add_action( 'plugins_loaded', array( 'MP_Install', 'maybe_upgrade' ) );
add_action( 'rest_api_init', array( 'MP_Rest', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Rest_Work', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Templates', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Task_IO', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Daily', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Invoices', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Portal', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Digest', 'register' ) );
add_action( 'rest_api_init', array( 'MP_AI', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Client', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Costs', 'register' ) );
add_action( 'rest_api_init', array( 'MP_Payroll', 'register' ) );
MP_Auth::init();
MP_Frontend::init();
MP_Cron::init();
MP_Admin::init();
MP_Backup::init();

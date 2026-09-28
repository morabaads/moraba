<?php
/** PWA / home-screen tags shared by the panel and the login page (iPhone users often install from the login screen). */
defined( 'ABSPATH' ) || exit;
?>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="مربع">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="mobile-web-app-capable" content="yes">
<meta name="application-name" content="پنل مربع">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="<?php echo esc_url( add_query_arg( 'mp_manifest', 1, home_url( '/' ) ) ); ?>">
<link rel="apple-touch-icon" sizes="180x180" href="<?php echo MP_Frontend::asset( 'img/icon-180.png' ); // phpcs:ignore ?>">
<link rel="apple-touch-icon" sizes="192x192" href="<?php echo MP_Frontend::asset( 'img/icon-192.png' ); // phpcs:ignore ?>">

<?php
defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>MORABA | پرتال پروژه</title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/app.css' ); // phpcs:ignore ?>">
</head>
<body class="mp-gate mp-client">
<main class="client-shell portal">
	<header class="client-head card">
		<img src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="MORABA" class="gate-logo">
		<div><strong id="client-title">در حال بارگذاری…</strong><small id="client-sub"></small></div>
	</header>
	<nav class="portal-tabs" id="portal-tabs" role="tablist" hidden></nav>
	<section class="portal-pane" id="pane-progress" hidden></section>
	<section class="portal-pane" id="pane-designs" hidden></section>
	<section class="portal-pane" id="pane-files" hidden></section>
	<section class="portal-pane" id="pane-invoices" hidden></section>
	<section class="card client-pane portal-pane" id="pane-chat">
		<div id="chat-messages" class="chat-messages"></div>
		<form id="client-form" class="client-form">
			<input name="name" class="input" placeholder="نام شما" maxlength="80" autocomplete="name">
			<input name="message" class="input" placeholder="پیام خود را بنویسید…" autocomplete="off" required maxlength="2000">
			<button class="btn btn-primary" type="submit">ارسال</button>
		</form>
	</section>
</main>
<script>window.MP_CLIENT = <?php echo wp_json_encode( array( 'url' => esc_url_raw( rest_url( MP_Rest::NS . '/client/' . $token ) ) ) ); ?>;</script>
<script src="<?php echo MP_Frontend::asset( 'js/pins.js' ); // phpcs:ignore ?>"></script>
<script src="<?php echo MP_Frontend::asset( 'js/client.js' ); // phpcs:ignore ?>"></script>
</body>
</html>

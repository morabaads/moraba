<?php
defined( 'ABSPATH' ) || exit;
$mp_ch = MP_Client::channel( $token );
$mp_t  = $mp_ch ? $mp_ch->title : 'پرتال پروژه';
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#f6f5f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111213" media="(prefers-color-scheme: dark)">
<title><?php echo esc_html( $mp_t ); ?> | مربع استودیو</title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/app.css' ); // phpcs:ignore ?>">
<script>try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}</script>
</head>
<body class="cp-body">
<?php include MP_DIR . 'templates/sprite.svg'; ?>

<!-- Login -->
<main class="cp-login" id="cp-login" hidden>
	<div class="cp-login-card">
		<div class="cp-logos">
			<img src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="مربع استودیو" class="cp-studio-logo">
			<span class="cp-x" id="cp-login-x" hidden>×</span>
			<img id="cp-login-client" alt="" hidden>
		</div>
		<h1 id="cp-login-title">ورود به پرتال پروژه</h1>
		<p id="cp-login-sub">شماره موبایلی را که به تیم مربع داده‌اید وارد کنید تا کد ورود پیامک شود.</p>
		<form id="cp-step-mobile" class="cp-form">
			<label class="cp-field"><span>شماره موبایل</span><input name="mobile" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="0912 123 4567" required></label>
			<button class="btn btn-primary btn-block" type="submit">دریافت کد ورود</button>
		</form>
		<form id="cp-step-code" class="cp-form" hidden>
			<label class="cp-field"><span id="cp-code-label">کد ۵ رقمی</span><input name="code" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="5" class="cp-code" placeholder="•••••" required></label>
			<button class="btn btn-primary btn-block" type="submit">ورود</button>
			<div class="cp-code-foot"><button type="button" class="cp-link" id="cp-change">تغییر شماره</button><button type="button" class="cp-link" id="cp-resend" disabled>ارسال دوباره</button></div>
		</form>
		<p class="cp-error" id="cp-login-error" role="alert"></p>
	</div>
</main>

<!-- Portal -->
<div class="cp-app" id="cp-app" hidden>
	<aside class="cp-side">
		<div class="cp-brand"><img src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="مربع استودیو" class="cp-studio-logo"></div>
		<div class="cp-client">
			<span class="cp-client-logo" id="cp-client-logo"></span>
			<div><strong id="cp-client-name"></strong><small id="cp-project-name"></small></div>
		</div>
		<nav class="cp-nav" id="cp-nav" aria-label="بخش‌ها"></nav>
		<div class="cp-me" id="cp-me" hidden><span class="cp-avatar" id="cp-me-avatar"></span><div><strong id="cp-me-name"></strong><button type="button" class="cp-link" id="cp-logout">خروج</button></div></div>
		<p class="cp-powered">پرتال اختصاصی مشتریان مربع استودیو</p>
	</aside>
	<main class="cp-main">
		<header class="cp-top">
			<div class="cp-top-mobile"><img src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="مربع" class="cp-studio-logo sm"><span class="cp-client-logo sm" id="cp-client-logo-m"></span></div>
			<div><h1 id="cp-page-title"></h1><p id="cp-page-sub"></p></div>
		</header>
		<section class="cp-pane" id="pane-progress" hidden></section>
		<section class="cp-pane" id="pane-designs" hidden></section>
		<section class="cp-pane" id="pane-files" hidden></section>
		<section class="cp-pane" id="pane-invoices" hidden></section>
		<section class="cp-pane cp-chat" id="pane-chat" hidden>
			<div class="cp-chat-card">
				<div id="chat-messages" class="chat-messages cp-messages"></div>
				<form id="client-form" class="cp-composer">
					<input name="name" class="cp-name" placeholder="نام شما" maxlength="80" autocomplete="name" hidden>
					<div class="cp-compose-row">
						<textarea name="message" rows="1" placeholder="پیام خود را بنویسید…" required maxlength="2000"></textarea>
						<button class="cp-send" type="submit" aria-label="ارسال"><svg class="icon" aria-hidden="true"><use href="#send"></use></svg></button>
					</div>
				</form>
			</div>
		</section>
	</main>
	<nav class="cp-tabbar" id="cp-tabbar" aria-label="بخش‌ها"></nav>
</div>
<div class="cp-toast" id="cp-toast" role="status"></div>

<script>window.MP_CLIENT = <?php echo wp_json_encode( array( 'url' => esc_url_raw( rest_url( MP_Rest::NS . '/client/' . $token ) ) ) ); ?>;</script>
<script src="<?php echo MP_Frontend::asset( 'js/pins.js' ); // phpcs:ignore ?>"></script>
<script src="<?php echo MP_Frontend::asset( 'js/client.js' ); // phpcs:ignore ?>"></script>
</body>
</html>

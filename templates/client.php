<?php
defined( 'ABSPATH' ) || exit;
$mp_ch = MP_Client::channel( $token );
$mp_b  = MP_Client::brand();
$mp_lc = $mp_b['custom_logo'] ? ' custom' : '';
$mp_t  = $mp_ch ? $mp_ch->title : 'پرتال پروژه';
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">

<meta name="theme-color" content="#111213">
<title><?php echo esc_html( $mp_t ); ?> | مربع استودیو</title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<?php MP_Frontend::client_head( $token, $mp_ch && $mp_ch->client_name ? $mp_ch->client_name : $mp_t ); ?>
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/app.css' ); // phpcs:ignore ?>">
<?php echo MP_Frontend::font_style(); // phpcs:ignore ?>
<script>document.documentElement.classList.add('dark')</script>
</head>
<body class="cp-body">
<?php include MP_DIR . 'templates/sprite.svg'; ?>

<!-- Login -->
<main class="cp-login" id="cp-login" hidden>
	<div class="cp-login-card">
		<div class="cp-logos">
			<img src="<?php echo esc_url( $mp_b['logo'] ); ?>" alt="<?php echo esc_attr( $mp_b['name'] ); ?>" class="cp-studio-logo<?php echo esc_attr( $mp_lc ); ?>">
			<span class="cp-x" id="cp-login-x" hidden>×</span>
			<img id="cp-login-client" alt="" hidden>
		</div>
		<h1 id="cp-login-title">ورود به پرتال پروژه</h1>
		<p id="cp-login-sub">شماره موبایلی را که به تیم مربع داده‌اید وارد کنید تا کد ورود پیامک شود.</p>
		<form id="cp-step-mobile" class="cp-form">
			<label class="cp-field"><span>شماره موبایل</span><input name="mobile" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷" required></label>
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
<div class="app cp-app" id="cp-app" hidden>
	<aside class="sidebar cp-side" aria-label="منوی پرتال">
		<div class="brand"><img src="<?php echo esc_url( $mp_b['logo'] ); ?>" alt="<?php echo esc_attr( $mp_b['name'] ); ?>" class="brand-logo<?php echo esc_attr( $mp_lc ); ?>"></div>
		<div class="cp-client">
			<span class="cp-client-logo" id="cp-client-logo"></span>
			<div><strong id="cp-client-name"></strong><small id="cp-project-name"></small></div>
		</div>
		<nav class="nav" id="cp-nav" aria-label="بخش‌ها"></nav>
		<nav class="nav nav-bottom" aria-label="حساب">
			<button type="button" class="nav-item" id="cp-logout" hidden><svg class="icon" aria-hidden="true"><use href="#logout"></use></svg><span class="nav-label">خروج</span></button>
		</nav>
	</aside>
	<main class="main cp-main" id="main">
		<div class="cp-preview" id="cp-preview" hidden role="status"><span class="cp-preview-dot"></span><div><strong id="cp-preview-who"></strong><small>هر پیام، فایل، نظر، تأیید یا کاری که اینجا ثبت کنید به نام مشتری ثبت می‌شود (و در گزارش فعالیت به نام شما).</small></div><button type="button" class="cp-preview-end" id="cp-preview-end">پایان</button></div>
		<header class="topbar cp-topbar">
			<div class="cp-top-mobile"><img src="<?php echo esc_url( $mp_b['logo'] ); ?>" alt="<?php echo esc_attr( $mp_b['name'] ); ?>" class="cp-studio-logo sm<?php echo esc_attr( $mp_lc ); ?>"></div>
			<div class="hello"><strong id="cp-hello"></strong><span id="cp-hello-sub"></span></div>
			<div class="topbar-tools"><time class="today-label" id="cp-today"></time><button type="button" class="cp-me-btn" id="cp-me-btn" aria-haspopup="menu" aria-expanded="false" aria-label="حساب کاربری"><span class="cp-client-logo sm" id="cp-client-logo-m"></span><span class="cp-avatar" id="cp-me-avatar" hidden></span></button></div>
		</header>
		<div class="page-head cp-top"><div><h1 id="cp-page-title"></h1><p id="cp-page-sub"></p></div></div>
		<section class="cp-pane" id="pane-progress" hidden></section>
		<section class="cp-pane" id="pane-designs" hidden></section>
		<section class="cp-pane" id="pane-files" hidden></section>
		<section class="cp-pane" id="pane-invoices" hidden></section>
		<section class="cp-pane" id="pane-contracts" hidden></section>
		<section class="cp-pane" id="pane-meetings" hidden></section>
		<section class="cp-pane cp-chat" id="pane-chat" hidden>
			<div class="cp-chat-card">
				<header class="cp-chat-head">
					<button type="button" class="icon-btn cp-chat-back" id="cp-chat-back" aria-label="بازگشت"><svg class="icon" aria-hidden="true"><use href="#right"></use></svg></button>
					<span class="cp-chat-avatar"><img src="<?php echo esc_url( $mp_b['icon'] ); ?>" alt=""></span>
					<div class="cp-chat-title"><strong><?php echo esc_html( $mp_b['name'] ); ?></strong><small id="cp-chat-sub">گفت‌وگوی پروژه</small></div>
					<span class="cp-client-logo sm" id="cp-chat-client"></span>
				</header>
				<div id="chat-messages" class="chat-messages cp-messages"></div>
				<button type="button" class="chat-down" id="cp-down" hidden aria-label="رفتن به آخرین پیام"><svg class="icon" aria-hidden="true"><use href="#down"></use></svg></button>
				<form id="client-form" class="composer cp-composer2">
					<input name="name" class="cp-name" placeholder="نام شما" maxlength="80" autocomplete="name" hidden>
					<div class="compose-ctx" id="cp-ctx" hidden><span class="cc-ico" id="cp-cc-ico"></span><span class="cc-copy"><b id="cp-cc-title"></b><small id="cp-cc-text"></small></span><button type="button" class="icon-btn sm" id="cp-cc-x" aria-label="لغو"><svg class="icon" aria-hidden="true"><use href="#close"></use></svg></button></div>
					<div class="emoji-pop" id="cp-emoji-pop" hidden></div>
					<div class="composer-row">
						<button type="button" class="icon-btn composer-clip" id="cp-clip" title="پیوست عکس یا فایل" aria-label="پیوست عکس یا فایل"><svg class="icon" aria-hidden="true"><use href="#clip"></use></svg></button>
						<input type="file" id="cp-file" class="visually-hidden" multiple tabindex="-1" aria-hidden="true">
						<div class="composer-input"><textarea name="message" rows="1" placeholder="پیام…" maxlength="4000" aria-label="متن پیام"></textarea><button type="button" class="composer-emoji" id="cp-emoji" aria-label="ایموجی"><svg class="icon" aria-hidden="true"><use href="#smile"></use></svg></button></div>
						<button type="button" class="icon-btn lg composer-mic" id="cp-mic" aria-label="ضبط پیام صوتی" title="پیام صوتی"><svg class="icon" aria-hidden="true"><use href="#mic"></use></svg></button>
						<button type="submit" class="icon-btn accent lg composer-send" aria-label="ارسال"><svg class="icon" aria-hidden="true"><use href="#send"></use></svg></button>
					</div>
					<div class="rec-bar" id="cp-rec-bar" hidden>
						<button type="button" class="icon-btn danger" id="cp-rec-cancel" aria-label="لغو ضبط"><svg class="icon" aria-hidden="true"><use href="#trash"></use></svg></button>
						<span class="rec-dot" aria-hidden="true"></span><span class="rec-time" id="cp-rec-time">۰:۰۰</span>
						<span class="rec-wave" id="cp-rec-wave" aria-hidden="true"></span>
						<button type="button" class="icon-btn accent lg" id="cp-rec-send" aria-label="ارسال پیام صوتی"><svg class="icon" aria-hidden="true"><use href="#send"></use></svg></button>
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
<script src="<?php echo MP_Frontend::asset( 'js/viewer.js' ); // phpcs:ignore ?>"></script>
<script src="<?php echo MP_Frontend::asset( 'js/emoji-map.js' ); // phpcs:ignore ?>"></script>
<script src="<?php echo MP_Frontend::asset( 'js/client-chat.js' ); // phpcs:ignore ?>"></script>
<script src="<?php echo MP_Frontend::asset( 'js/client.js' ); // phpcs:ignore ?>"></script>
<?php echo MP_Frontend::client_pwa_script( $token, $mp_ch && $mp_ch->client_name ? $mp_ch->client_name : $mp_t ); // phpcs:ignore ?>
</body>
</html>

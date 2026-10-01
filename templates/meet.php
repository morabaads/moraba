<?php
/**
 * Video meeting room (/m/{token}/): join screen, waiting room, the call itself and its end.
 * Variables: $m (meeting row), $nonce (REST nonce when someone is logged in).
 */
defined( 'ABSPATH' ) || exit;
$mp_req = new WP_REST_Request( 'GET' );
$mp_req->set_param( 'token', $m->token );
$mp_info = MP_Meet::room_info( $mp_req );
$mp_cfg  = array(
	'api'   => esc_url_raw( rest_url( MP_Rest::NS . '/room/' . $m->token ) ),
	'nonce' => $nonce,
	'info'  => $mp_info,
	'link'  => MP_Meet::link( $m->token ),
	'panel' => MP_Frontend::panel_url(),
	'when'  => MP_Jalali::format( $m->meeting_date ) . ' · ساعت ' . MP_Jalali::digits( $m->meeting_time ),
);
$mp_i = function ( $n ) {
	return '<svg class="i" aria-hidden="true"><use href="#' . esc_attr( $n ) . '"></use></svg>';
};
?><!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0f0f10">
<title><?php echo esc_html( 'جلسه: ' . $m->title ); ?></title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/meet.css' ); // phpcs:ignore ?>">
<style>@font-face{font-family:Dana;src:url(<?php echo esc_url( MP_URL . 'assets/fonts/dana.woff2' ); ?>) format('woff2');font-weight:10 990;font-display:swap}</style>
</head>
<body>
<?php include MP_DIR . 'templates/sprite.svg'; ?>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="mic-off" viewBox="0 0 24 24"><path d="M9 5a3 3 0 0 1 6 0v5M15 13.5A3 3 0 0 1 9 11V9M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"></path></symbol>
<symbol id="cam" viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="3"></rect><path d="m16 10 6-3v10l-6-3"></path></symbol>
<symbol id="cam-off" viewBox="0 0 24 24"><path d="M16 16v1a1 1 0 0 1-1 1H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M10 6h5a1 1 0 0 1 1 1v3l6-3v10M3 3l18 18"></path></symbol>
<symbol id="screen" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"></rect><path d="M8 21h8M12 17v4M12 13V8M9.5 10.5 12 8l2.5 2.5"></path></symbol>
<symbol id="hand" viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 16a1.6 1.6 0 0 1 2.4-2l2 2"></path></symbol>
<symbol id="people" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"></path></symbol>
<symbol id="hangup" viewBox="0 0 24 24"><path d="M3 14.5c4.9-4.7 13.1-4.7 18 0l-2.2 2.6-3.6-1.4v-2.6a12 12 0 0 0-6.4 0v2.6L5.2 17.1Z"></path></symbol>
<symbol id="link" viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"></path></symbol>
</defs></svg>

<div class="mt" id="app">
	<!-- Join screen -->
	<section class="scr pre" id="pre">
		<div class="pre-card">
			<div class="pre-media">
				<div class="tile me-preview" id="preview">
					<video id="pv" autoplay muted playsinline webkit-playsinline></video>
					<div class="ph" id="pv-ph"><span>دوربین خاموش است</span></div>
					<div class="pre-tools">
						<button type="button" class="rb" id="pv-mic" aria-label="میکروفون"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?></button>
						<button type="button" class="rb" id="pv-cam" aria-label="دوربین"><?php echo $mp_i( 'cam' ); // phpcs:ignore ?></button>
					</div>
				</div>
				<p class="hint" id="pv-hint"></p>
				<button type="button" class="btn ghost sm retry" id="pv-retry" hidden>اجازه دوربین و میکروفون</button>
			</div>
			<form class="pre-form" id="join-form" autocomplete="off">
				<img class="logo" src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="MORABA">
				<span class="kicker"><?php echo $mp_i( 'video' ); // phpcs:ignore ?>جلسه آنلاین</span>
				<h1><?php echo esc_html( $m->title ); ?></h1>
				<p class="meta"><?php echo esc_html( $mp_cfg['when'] ); ?><?php echo $mp_info['host'] ? ' · میزبان: ' . esc_html( $mp_info['host'] ) : ''; ?><?php echo $m->duration ? ' · ' . esc_html( MP_Jalali::digits( (string) $m->duration ) ) . ' دقیقه' : ''; ?></p>
				<div id="pre-fields"></div>
				<button type="submit" class="btn primary big" id="join-btn">ورود به جلسه</button>
				<p class="err" id="join-err" role="alert"></p>
			</form>
		</div>
	</section>

	<!-- Waiting room -->
	<section class="scr wait" id="wait" hidden>
		<div class="wait-card">
			<div class="pulse"><?php echo $mp_i( 'video' ); // phpcs:ignore ?></div>
			<h2 id="wait-title">در اتاق انتظار هستید</h2>
			<p id="wait-text">میزبان به‌زودی ورود شما را تأیید می‌کند. این صفحه را نبندید.</p>
			<button type="button" class="btn ghost" id="wait-leave">انصراف</button>
		</div>
	</section>

	<!-- The call -->
	<section class="scr room" id="room" hidden>
		<header class="top">
			<div class="t-title"><span class="live-dot"></span><b><?php echo esc_html( $m->title ); ?></b></div>
			<span class="clock" id="mt-clock">۰۰:۰۰</span>
		</header>
		<div class="stage">
			<div class="grid" id="mt-grid"></div>
			<aside class="side" id="side" hidden>
				<div class="side-head"><b>شرکت‌کنندگان</b><button type="button" class="rb sm" id="side-close" aria-label="بستن"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button></div>
				<div id="waiting-box"></div>
				<div id="mt-people"></div>
				<div class="invite">
					<small>لینک دعوت</small>
					<div class="copy"><input id="invite-link" readonly dir="ltr" value="<?php echo esc_attr( $mp_cfg['link'] ); ?>"><button type="button" class="btn sm" id="copy-link"><?php echo $mp_i( 'link' ); // phpcs:ignore ?>کپی</button></div>
					<?php if ( $m->password ) : ?><small class="pw">رمز جلسه را جداگانه برای مهمان بفرستید.</small><?php endif; ?>
				</div>
			</aside>
		</div>
		<div class="toast" id="toast" role="status" hidden></div>
		<button type="button" class="tap-play" id="tap-play" hidden><?php echo $mp_i( 'speaker' ); // phpcs:ignore ?>برای پخش صدا و تصویر بزنید</button>
		<footer class="bar">
			<button type="button" class="rb" id="b-mic" aria-label="میکروفون"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-cam" aria-label="دوربین"><?php echo $mp_i( 'cam' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-screen" aria-label="اشتراک صفحه"><?php echo $mp_i( 'screen' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-hand" aria-label="بالا بردن دست"><?php echo $mp_i( 'hand' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-people" aria-label="شرکت‌کنندگان"><?php echo $mp_i( 'people' ); // phpcs:ignore ?><i class="cnt" id="b-count"></i><i class="dot" id="b-wait" hidden></i></button>
			<button type="button" class="rb red" id="b-leave" aria-label="خروج از جلسه"><?php echo $mp_i( 'hangup' ); // phpcs:ignore ?></button>
			<button type="button" class="btn danger sm" id="b-end" hidden>پایان برای همه</button>
		</footer>
	</section>

	<!-- After -->
	<section class="scr bye" id="bye" hidden>
		<div class="wait-card">
			<div class="pulse off"><?php echo $mp_i( 'hangup' ); // phpcs:ignore ?></div>
			<h2 id="bye-title">از جلسه خارج شدید</h2>
			<p id="bye-text"></p>
			<div class="row">
				<button type="button" class="btn primary" id="rejoin">ورود دوباره</button>
				<?php if ( $mp_info['user'] ) : ?><a class="btn ghost" href="<?php echo esc_url( $mp_cfg['panel'] ); ?>#meetings">بازگشت به پنل</a><?php endif; ?>
			</div>
		</div>
	</section>
</div>
<script>window.MEET = <?php echo wp_json_encode( $mp_cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); ?>;</script>
<script src="<?php echo MP_Frontend::asset( 'js/meet.js' ); // phpcs:ignore ?>"></script>
</body></html>

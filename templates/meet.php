<?php
/**
 * Video meeting room (/m/{token}/): join screen, waiting room, the call itself and its end.
 * Variables: $m (meeting row), $nonce (REST nonce when someone is logged in).
 */
defined( 'ABSPATH' ) || exit;
$mp_req = new WP_REST_Request( 'GET' );
foreach ( array( 'i', 'c', 'cs' ) as $mp_k ) {
	if ( isset( $_GET[ $mp_k ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		$mp_req->set_param( $mp_k, sanitize_text_field( wp_unslash( $_GET[ $mp_k ] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification
	}
}
$mp_req->set_param( 'token', $m->token );
$mp_info = MP_Meet::room_info( $mp_req );
$mp_cfg  = array(
	'api'    => esc_url_raw( rest_url( MP_Rest::NS . '/room/' . $m->token ) ),
	'rest'   => esc_url_raw( rest_url( MP_Rest::NS . '/' ) ),
	'id'     => $mp_info['user'] ? (int) $m->id : 0,
	'token'  => $m->token,
	'nonce'  => $nonce,
	'info'   => $mp_info,
	'link'   => MP_Meet::link( $m->token ),
	'panel'  => MP_Frontend::panel_url(),
	'pass'   => array( 'i' => $mp_req['i'], 'c' => $mp_req['c'], 'cs' => $mp_req['cs'] ),
	'when'   => $m->permanent ? 'اتاق همیشگی تیم' : MP_Jalali::format( $m->meeting_date ) . ' · ساعت ' . MP_Jalali::digits( $m->meeting_time ),
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
<symbol id="flip" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path><path d="M9.5 13.5a2.5 2.5 0 0 1 4.3-1.7M14.5 13.5a2.5 2.5 0 0 1-4.3 1.7M13 11h1.2V9.8M11 16H9.8v1.2"></path></symbol>
<symbol id="rec" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4" fill="currentColor"></circle></symbol>
<symbol id="pip" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"></rect><rect x="12" y="11" width="8" height="7" rx="1"></rect></symbol>
<symbol id="grid4" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="3" width="8" height="8" rx="2"></rect><rect x="3" y="13" width="8" height="8" rx="2"></rect><rect x="13" y="13" width="8" height="8" rx="2"></rect></symbol>
<symbol id="speaker-view" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="13" rx="2"></rect><rect x="3" y="18" width="5" height="3" rx="1"></rect><rect x="9.5" y="18" width="5" height="3" rx="1"></rect><rect x="16" y="18" width="5" height="3" rx="1"></rect></symbol>
<symbol id="data" viewBox="0 0 24 24"><path d="M4 20V14M9 20V10M14 20V6M19 20V3"></path></symbol>
<symbol id="headset" viewBox="0 0 24 24"><path d="M3 14v-2a9 9 0 0 1 18 0v2M3 14h3v6H4a1 1 0 0 1-1-1v-5ZM21 14h-3v6h2a1 1 0 0 0 1-1v-5Z"></path></symbol>
<symbol id="star" viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"></path></symbol>
</defs></svg>

<div class="mt" id="app">
	<!-- Join screen -->
	<section class="scr pre" id="pre">
		<div class="pre-card">
			<div class="pre-media">
				<div class="tile me-preview" id="preview">
					<video id="pv" autoplay muted playsinline webkit-playsinline></video>
					<div class="ph" id="pv-ph"><span>دوربین خاموش است</span></div>
					<div class="meter" id="pv-meter" aria-hidden="true"><i></i></div>
					<div class="pre-tools">
						<button type="button" class="rb" id="pv-mic" aria-label="میکروفون"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?></button>
						<button type="button" class="rb" id="pv-cam" aria-label="دوربین"><?php echo $mp_i( 'cam' ); // phpcs:ignore ?></button>
						<button type="button" class="rb" id="pv-flip" aria-label="دوربین جلو و عقب" hidden><?php echo $mp_i( 'flip' ); // phpcs:ignore ?></button>
						<button type="button" class="rb" id="pv-dev" aria-label="انتخاب دستگاه"><?php echo $mp_i( 'settings' ); // phpcs:ignore ?></button>
					</div>
				</div>
				<p class="hint" id="pv-hint"></p>
				<div class="pre-row">
					<button type="button" class="btn ghost sm" id="pv-retry" hidden>اجازه دوربین و میکروفون</button>
					<button type="button" class="btn ghost sm" id="pv-test"><?php echo $mp_i( 'speaker' ); // phpcs:ignore ?>تست میکروفون و بلندگو</button>
				</div>
				<p class="tip"><?php echo $mp_i( 'headset' ); // phpcs:ignore ?>برای بهترین صدا و بدون اکو، هدفون بزنید.</p>
			</div>
			<form class="pre-form" id="join-form" autocomplete="off">
				<img class="logo" src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="MORABA">
				<span class="kicker"><?php echo $mp_i( 'video' ); // phpcs:ignore ?><?php echo $m->permanent ? 'اتاق جلسه تیم' : 'جلسه آنلاین'; ?></span>
				<h1><?php echo esc_html( $m->title ); ?></h1>
				<p class="meta"><?php echo esc_html( $mp_cfg['when'] ); ?><?php echo $mp_info['host'] && ! $m->permanent ? ' · میزبان: ' . esc_html( $mp_info['host'] ) : ''; ?><?php echo $m->duration && ! $m->permanent ? ' · ' . esc_html( MP_Jalali::digits( (string) $m->duration ) ) . ' دقیقه' : ''; ?></p>
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
			<div class="t-tools">
				<span class="chip-rec" id="rec-chip" hidden><i></i>در حال ضبط</span>
				<span class="chip-lock" id="lock-chip" hidden><?php echo $mp_i( 'lock' ); // phpcs:ignore ?>قفل</span>
				<span class="bars" id="my-bars" title="کیفیت اتصال شما"><i></i><i></i><i></i><i></i></span>
				<span class="clock" id="mt-clock">۰۰:۰۰</span>
			</div>
		</header>
		<div class="net-banner" id="net-banner" hidden><span class="spin"></span>اتصال قطع شد؛ در حال اتصال دوباره…</div>
		<div class="stage">
			<div class="main-area">
				<div class="design" id="design" hidden>
					<div class="design-head"><b id="design-title"></b><small>برای نظر دادن روی نقطه‌ای از طرح بزنید</small><button type="button" class="btn sm ghost" id="design-close" hidden>پایان نمایش</button></div>
					<div class="design-box" id="design-box"><img id="design-img" alt=""><div id="design-pins"></div></div>
				</div>
				<div class="grid" id="mt-grid"></div>
			</div>
			<aside class="side" id="side" hidden>
				<div class="side-head">
					<div class="side-tabs" role="tablist">
						<button type="button" class="on" data-tab="people">شرکت‌کنندگان</button>
						<button type="button" data-tab="chat">گفت‌وگو<i class="cnt" id="chat-badge" hidden></i></button>
					</div>
					<button type="button" class="rb sm" id="side-close" aria-label="بستن"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button>
				</div>
				<div class="pane" id="pane-people">
					<div id="host-tools"></div>
					<div id="waiting-box"></div>
					<div id="mt-people"></div>
					<div class="invite">
						<small>لینک دعوت</small>
						<div class="copy"><input id="invite-link" readonly dir="ltr" value="<?php echo esc_attr( $mp_cfg['link'] ); ?>"><button type="button" class="btn sm" id="copy-link"><?php echo $mp_i( 'link' ); // phpcs:ignore ?>کپی</button></div>
						<?php if ( $m->password ) : ?><small class="pw">رمز جلسه را جداگانه برای مهمان بفرستید.</small><?php endif; ?>
					</div>
				</div>
				<div class="pane" id="pane-chat" hidden>
					<div class="chat-list" id="chat-list"></div>
					<form class="chat-form" id="chat-form">
						<label class="rb sm attach" title="فرستادن فایل"><?php echo $mp_i( 'clip' ); // phpcs:ignore ?><input type="file" id="chat-file" hidden></label>
						<input id="chat-input" maxlength="2000" placeholder="پیام…" autocomplete="off">
						<button type="submit" class="rb sm send" aria-label="ارسال"><?php echo $mp_i( 'send' ); // phpcs:ignore ?></button>
					</form>
				</div>
			</aside>
		</div>
		<div class="toast" id="toast" role="status" hidden></div>
		<div class="reacts" id="reacts" hidden></div>
		<button type="button" class="tap-play" id="tap-play" hidden><?php echo $mp_i( 'speaker' ); // phpcs:ignore ?>برای پخش صدا و تصویر بزنید</button>
		<footer class="bar">
			<button type="button" class="rb" id="b-mic" aria-label="میکروفون"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-cam" aria-label="دوربین"><?php echo $mp_i( 'cam' ); // phpcs:ignore ?></button>
			<button type="button" class="rb hide-sm" id="b-screen" aria-label="اشتراک صفحه"><?php echo $mp_i( 'screen' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-react" aria-label="واکنش"><?php echo $mp_i( 'smile' ); // phpcs:ignore ?></button>
			<button type="button" class="rb hide-sm" id="b-hand" aria-label="بالا بردن دست"><?php echo $mp_i( 'hand' ); // phpcs:ignore ?></button>
			<button type="button" class="rb" id="b-chat" aria-label="گفت‌وگو"><?php echo $mp_i( 'chat' ); // phpcs:ignore ?><i class="dot" id="b-chat-dot" hidden></i></button>
			<button type="button" class="rb" id="b-people" aria-label="شرکت‌کنندگان"><?php echo $mp_i( 'people' ); // phpcs:ignore ?><i class="cnt" id="b-count"></i><i class="dot" id="b-wait" hidden></i></button>
			<button type="button" class="rb" id="b-more" aria-label="امکانات بیشتر"><?php echo $mp_i( 'more' ); // phpcs:ignore ?></button>
			<button type="button" class="rb red" id="b-leave" aria-label="خروج از جلسه"><?php echo $mp_i( 'hangup' ); // phpcs:ignore ?></button>
		</footer>
		<div class="sheet" id="more-menu" hidden></div>
		<div class="sheet react-sheet" id="react-sheet" hidden></div>
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
<div class="modal" id="modal" hidden><div class="modal-card"><div class="modal-head"><b id="modal-title"></b><button type="button" class="rb sm" id="modal-close" aria-label="بستن"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button></div><div id="modal-body"></div></div></div>
<video id="pip-video" muted playsinline hidden></video>
<audio id="out-audio" autoplay playsinline hidden></audio>
<script>window.MEET = <?php echo wp_json_encode( $mp_cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); ?>;</script>
<script src="<?php echo MP_Frontend::asset( 'js/meet.js' ); // phpcs:ignore ?>"></script>
</body></html>

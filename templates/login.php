<?php
defined( 'ABSPATH' ) || exit;
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e0e10">
<?php include MP_DIR . 'templates/pwa-head.php'; ?>
<meta name="robots" content="noindex,nofollow">
<title><?php echo ! empty( $mp_chat_app ) ? 'مربع چت | ورود' : 'MORABA | ' . ( empty( $mp_app ) ? 'ورود به پنل' : 'ورود' ); ?></title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/app.css' ); // phpcs:ignore ?>">
</head>
<body class="mp-gate mp-login">
<?php
$mp_ic = function ( $d ) {
	return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' . $d . '</svg>';
};
$mp_support = trim( (string) get_option( 'mp_support', '' ) );
if ( $mp_support && ! preg_match( '#^(https?://|mailto:|tel:)#', $mp_support ) ) {
	$mp_support = is_email( $mp_support ) ? 'mailto:' . $mp_support : 'tel:' . preg_replace( '/[^0-9+]/', '', J_latin( $mp_support ) );
}
?>
<main class="login-card">
	<img src="<?php echo MP_Frontend::asset( 'img/logo-light.png' ); // phpcs:ignore ?>" alt="MORABA" class="login-logo">
	<?php if ( isset( $message ) ) : ?>
		<h1>دسترسی ندارید</h1>
		<p class="login-sub"><?php echo esc_html( $message ); ?></p>
		<a class="login-btn" href="<?php echo esc_url( wp_logout_url( MP_Frontend::panel_url() ) ); ?>"><span>ورود با حساب دیگر</span><i class="login-btn-arrow"><?php echo $mp_ic( '<path d="M5 12h14m-6-6 6 6-6 6"/>' ); // phpcs:ignore ?></i></a>
	<?php else : ?>
		<?php
		$mp_otp  = MP_Auth::otp_enabled();
		$mp_app  = ! empty( $mp_app );
		$mp_chat = ! empty( $mp_chat_app );
		$mp_back = $mp_app ? MP_App::url() : ( $mp_chat ? MP_Frontend::chat_url() : MP_Frontend::panel_url() );
		?>
		<h1><?php echo $mp_app ? 'ورود به مربع' : ( $mp_chat ? 'ورود به مربع چت' : 'ورود به پنل کارمندان' ); ?></h1>

		<section id="login-mobile"<?php echo $mp_otp ? '' : ' hidden'; ?>>
			<div id="otp" data-root="<?php echo esc_url( rest_url( 'moraba-panel/v1/' ) ); ?>"<?php echo $mp_app ? ' data-mode="app"' : ''; ?><?php echo $mp_chat ? ' data-back="' . esc_url( $mp_back ) . '"' : ''; ?>>
				<form id="otp-mobile" class="otp-step" novalidate>
					<p class="login-sub"><?php echo $mp_app ? 'کارمند استودیو باشید یا مشتری، فرقی ندارد: شماره موبایل خود را وارد کنید؛ بعد از ورود، پنل یا پرتال پروژه شما خودش باز می‌شود.' : 'شماره موبایل خود را وارد کنید تا کد ورود برایتان پیامک شود.'; ?></p>
					<label class="login-label" for="otp-m">شماره موبایل</label>
					<div class="login-field">
						<span class="login-field-ico"><?php echo $mp_ic( '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>' ); // phpcs:ignore ?></span>
						<input id="otp-m" name="mobile" type="tel" inputmode="numeric" autocomplete="tel" dir="ltr" placeholder="۰۹۱۲۱۲۳۴۵۶۷" maxlength="14" required autofocus>
					</div>
					<button type="submit" class="login-btn"><span>دریافت کد</span><i class="login-btn-arrow"><?php echo $mp_ic( '<path d="M5 12h14m-6-6 6 6-6 6"/>' ); // phpcs:ignore ?></i></button>
				</form>
				<form id="otp-code" class="otp-step" hidden novalidate>
					<p class="login-sub">کد ۵ رقمی پیامک‌شده به <b id="otp-to" dir="ltr"></b> را وارد کنید.</p>
					<label class="login-label" for="otp-c">کد ورود</label>
					<?php // One real input (keeps SMS autofill and paste working) laid over five boxes. ?>
					<div class="otp-boxes" dir="ltr">
						<input id="otp-c" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="5" class="otp-input" aria-label="کد ۵ رقمی" required>
						<span class="otp-box"></span><span class="otp-box"></span><span class="otp-box"></span><span class="otp-box"></span><span class="otp-box"></span>
					</div>
					<label class="login-check"><input type="checkbox" id="otp-r" checked> مرا به خاطر بسپار</label>
					<button type="submit" class="login-btn"><span>ورود</span><i class="login-btn-arrow"><?php echo $mp_ic( '<path d="M5 12h14m-6-6 6 6-6 6"/>' ); // phpcs:ignore ?></i></button>
					<div class="otp-links"><button type="button" id="otp-edit" class="login-link">ویرایش شماره</button><button type="button" id="otp-resend" class="login-link" disabled>ارسال دوباره</button></div>
				</form>
				<p id="otp-msg" class="otp-msg" role="alert" hidden></p>
			</div>
			<div class="login-or"><span>یا</span></div>
			<button type="button" class="login-alt" id="to-password">
				<span class="login-field-ico"><?php echo $mp_ic( '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' ); // phpcs:ignore ?></span>
				<span>ورود با نام کاربری و رمز عبور</span>
				<i class="login-alt-chev"><?php echo $mp_ic( '<path d="m15 6-6 6 6 6"/>' ); // phpcs:ignore ?></i>
			</button>
		</section>

		<section id="login-password"<?php echo $mp_otp ? ' hidden' : ''; ?>>
			<?php if ( ! $mp_otp ) : ?>
				<p class="login-sub">با نام کاربری و رمز عبور خود وارد شوید.</p>
			<?php else : ?>
				<p class="login-sub">نام کاربری (یا ایمیل) و رمز عبور خود را وارد کنید.</p>
			<?php endif; ?>
			<?php
			wp_login_form(
				array(
					'redirect'       => $mp_back,
					'label_username' => 'نام کاربری یا ایمیل',
					'label_password' => 'رمز عبور',
					'label_remember' => 'مرا به خاطر بسپار',
					'label_log_in'   => 'ورود',
				)
			);
			?>
			<a class="login-link" href="<?php echo esc_url( wp_lostpassword_url( $mp_back ) ); ?>">رمز عبور را فراموش کرده‌اید؟</a>
			<?php if ( $mp_app ) : ?>
				<form class="app-portal" onsubmit="var v=this.l.value.trim();if(/\/c\/[A-Za-z0-9]{32}|mp_client=[A-Za-z0-9]{32}/.test(v)){location.href=v;}else{this.querySelector('small').hidden=false;}return false;">
					<p class="login-sub">مشتری هستید؟ لینک پرتالی را که تیم مربع برایتان فرستاده اینجا بچسبانید.</p>
					<div class="login-field"><input name="l" type="url" dir="ltr" placeholder="https://…/c/…" autocomplete="off"></div>
					<small class="otp-msg" hidden>این لینک پرتال مشتری نیست.</small>
					<button type="submit" class="login-alt"><span>باز کردن پرتال</span></button>
				</form>
			<?php endif; ?>
			<?php if ( $mp_otp ) : ?>
				<div class="login-or"><span>یا</span></div>
				<button type="button" class="login-alt" id="to-mobile">
					<span class="login-field-ico"><?php echo $mp_ic( '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>' ); // phpcs:ignore ?></span>
					<span>ورود با شماره موبایل و کد پیامکی</span>
					<i class="login-alt-chev"><?php echo $mp_ic( '<path d="m15 6-6 6 6 6"/>' ); // phpcs:ignore ?></i>
				</button>
			<?php endif; ?>
		</section>

		<?php if ( $mp_support ) : ?>
			<p class="login-help"><?php echo $mp_ic( '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a3 3 0 0 1-3 2h-2"/>' ); // phpcs:ignore ?> مشکلی در ورود دارید؟ <a href="<?php echo esc_url( $mp_support ); ?>">پشتیبانی</a></p>
		<?php endif; ?>
		<script>
		(function () {
			var m = document.getElementById('login-mobile'), p = document.getElementById('login-password');
			function show(a, b, focus) { a.hidden = false; b.hidden = true; var f = a.querySelector(focus); if (f) f.focus(); }
			var tp = document.getElementById('to-password'), tm = document.getElementById('to-mobile');
			if (tp) tp.onclick = function () { show(p, m, '#user_login'); };
			if (tm) tm.onclick = function () { show(m, p, '#otp-m'); };
			var u = document.getElementById('user_login'), w = document.getElementById('user_pass');
			if (u) u.setAttribute('dir', 'ltr'); if (w) w.setAttribute('dir', 'ltr');
		})();
		</script>
		<script src="<?php echo MP_Frontend::asset( 'js/login.js' ); // phpcs:ignore ?>"></script>
	<?php endif; ?>
</main>
<?php echo MP_Frontend::pwa_script( true ); // phpcs:ignore ?>
</body>
</html>

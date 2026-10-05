<?php
defined( 'ABSPATH' ) || exit;
$mp_i   = function ( $name ) {
	return '<svg class="icon" aria-hidden="true"><use href="#' . esc_attr( $name ) . '"></use></svg>';
};
$mp_nav = array(
	'dashboard'  => array( 'grid', 'میز کار', '' ),
	'calendar'   => array( 'calendar', 'تقویم', '' ),
	'mytasks'    => array( 'tasks', 'تسک‌های من', 'tasks' ),
	'projects'   => array( 'folder', 'پروژه‌ها', '' ),
	'messages'   => array( 'chat', 'پیام‌ها', 'messages' ),
	'meetings'   => array( 'video', 'جلسات', '' ),
	'clients'    => array( 'user', 'مشتریان', '' ),
	'contracts'  => array( 'edit', 'قراردادها', '', true ),
	'attendance' => array( 'clock', 'حضور و مرخصی', 'leaves' ),
	'reminders'  => array( 'alarm', 'یادآوری', 'reminders' ),
	'accounting' => array( 'wallet', 'حسابداری', '' ),
	'reports'    => array( 'pie', 'گزارش‌ها', '' ),
);
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#161616">
<?php include MP_DIR . 'templates/pwa-head.php'; ?>
<title>MORABA | پنل کاربری</title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<link rel="preload" href="<?php echo esc_url( MP_URL . 'assets/fonts/dana.woff2' ); // same URL as app.css uses, so it's fetched once ?>" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="<?php echo MP_Frontend::asset( 'css/app.css' ); // phpcs:ignore ?>">
<script>try{var p=JSON.parse(localStorage.getItem('mp-prefs')||'{}');if(p.dark!==false)document.documentElement.classList.add('dark');if(p.motion)document.documentElement.classList.add('reduced-motion');}catch(e){}</script>
</head>
<body class="is-loading">
<?php include MP_DIR . 'templates/sprite.svg'; ?>
<div class="splash" aria-hidden="true"><img src="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>" alt=""><span class="splash-bar"><i></i></span></div>
<div class="offline-bar" id="offline-bar" role="status" hidden><?php echo $mp_i( 'alarm' ); // phpcs:ignore ?>اتصال اینترنت قطع است؛ تغییرات پس از اتصال ذخیره نمی‌شوند.</div>
<div class="ptr" id="ptr" aria-hidden="true"><?php echo $mp_i( 'repeat' ); // phpcs:ignore ?></div>
<a class="skip-link" href="#main">پرش به محتوا</a>
<div class="app">
	<aside class="sidebar" aria-label="منوی اصلی">
		<div class="brand">
			<img src="<?php echo MP_Frontend::asset( 'img/logo.png' ); // phpcs:ignore ?>" alt="MORABA" class="brand-logo">
			<img src="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>" alt="" class="brand-symbol">
		</div>
		<nav class="nav" aria-label="بخش‌ها">
			<?php foreach ( $mp_nav as $view => $item ) : ?>
				<button type="button" class="nav-item<?php echo ! empty( $item[3] ) ? ' manager-only' : ''; ?>" data-view="<?php echo esc_attr( $view ); ?>">
					<?php echo $mp_i( $item[0] ); // phpcs:ignore ?><span class="nav-label"><?php echo esc_html( $item[1] ); ?></span>
					<?php if ( $item[2] ) : ?><span class="badge" data-count="<?php echo esc_attr( $item[2] ); ?>" hidden></span><?php endif; ?>
				</button>
			<?php endforeach; ?>
		</nav>
		<nav class="nav nav-bottom" aria-label="تنظیمات">
			<button type="button" class="nav-item" data-action="settings"><?php echo $mp_i( 'settings' ); // phpcs:ignore ?><span class="nav-label">تنظیمات</span></button>
			<button type="button" class="nav-item" data-action="help"><?php echo $mp_i( 'help' ); // phpcs:ignore ?><span class="nav-label">راهنما</span></button>
			<button type="button" class="nav-item" data-action="logout"><?php echo $mp_i( 'logout' ); // phpcs:ignore ?><span class="nav-label">خروج</span></button>
		</nav>
		<button type="button" class="collapse" aria-label="جمع کردن منو" aria-expanded="true"><?php echo $mp_i( 'right' ); // phpcs:ignore ?></button>
	</aside>

	<main class="main" id="main" tabindex="-1">
		<header class="topbar">
			<strong class="page-title" id="page-title"></strong>
			<div class="hello"><strong id="hello-name"><span class="sk sk-text" style="width:140px"></span></strong><span id="hello-role"></span></div>
			<div class="topbar-tools">
				<button type="button" class="punch-chip" id="punch-chip" hidden><span class="punch-dot"></span><span class="punch-text">ثبت ورود</span><span class="punch-time num" hidden></span></button>
				<button type="button" class="icon-btn search-btn" aria-label="جستجو"><?php echo $mp_i( 'search' ); // phpcs:ignore ?></button>
				<div class="search-anchor">
					<label class="search"><?php echo $mp_i( 'search' ); // phpcs:ignore ?><input type="search" placeholder="جستجو در تسک، پروژه، افراد…" aria-label="جستجو" aria-expanded="false" aria-controls="search-popover" autocomplete="off"><kbd>Ctrl K</kbd></label><button type="button" class="search-cancel">لغو</button>
					<section id="search-popover" class="popover popover-search" hidden aria-label="نتایج جستجو">
						<div class="popover-head"><strong>نتایج جستجو</strong><span id="search-status" role="status" aria-live="polite"></span></div>
						<div id="search-results" class="popover-body"></div>
					</section>
				</div>
				<time class="today-label" id="today-label"></time>
				<div class="popover-anchor">
					<button type="button" class="icon-btn notif-btn" aria-label="اعلان‌ها" aria-expanded="false" aria-controls="notifications-popover"><?php echo $mp_i( 'bell' ); // phpcs:ignore ?><i class="notif-dot" hidden></i></button>
					<section id="notifications-popover" class="popover popover-notifications" hidden aria-label="اعلان‌ها">
						<div class="popover-head"><strong>اعلان‌ها</strong><button type="button" class="link" id="mark-all-read">خواندن همه</button></div>
						<div id="notification-list" class="popover-body"></div>
					</section>
				</div>
				<div class="popover-anchor">
					<button type="button" class="profile-btn" aria-label="منوی کاربری" aria-expanded="false" aria-controls="profile-popover"><span id="me-avatar" class="avatar-slot"></span><i class="presence online"></i><i class="badge dot" data-count="more" hidden></i></button>
					<section id="profile-popover" class="popover popover-profile" hidden aria-label="منوی کاربری">
						<div class="popover-head profile-head"><span id="profile-avatar" class="avatar-slot lg"></span><div><strong id="profile-name"></strong><small id="profile-role"></small></div></div>
						<div class="menu">
							<button type="button" data-user-action="profile"><?php echo $mp_i( 'user' ); // phpcs:ignore ?>پروفایل من</button>
							<button type="button" data-user-action="account"><?php echo $mp_i( 'edit' ); // phpcs:ignore ?>حساب کاربری و اعلان‌ها</button>
							<button type="button" data-user-action="appearance"><?php echo $mp_i( 'settings' ); // phpcs:ignore ?>ظاهر پنل</button>
							<button type="button" data-user-action="widgets"><?php echo $mp_i( 'grid' ); // phpcs:ignore ?>ویجت‌ها روی صفحه اصلی</button>
							<button type="button" data-user-action="install" hidden><?php echo $mp_i( 'download' ); // phpcs:ignore ?>نصب روی گوشی</button>
							<button type="button" data-user-action="logout" class="danger"><?php echo $mp_i( 'logout' ); // phpcs:ignore ?>خروج از حساب</button>
						</div>
					</section>
				</div>
			</div>
		</header>

		<!-- ================= Dashboard ================= -->
		<section class="view" id="view-dashboard" data-view="dashboard" aria-label="میز کار">
			<section class="hero" id="hero" aria-live="polite"></section>
			<div id="prompts"></div>
			<div class="kpis">
				<article class="card kpi" data-kpi="week" tabindex="0" role="button">
					<div class="kpi-icon"><?php echo $mp_i( 'checks' ); // phpcs:ignore ?></div>
					<div class="kpi-copy"><small>خلاصه هفته</small><strong id="kpi-week"><span class="sk sk-text"></span></strong><span id="kpi-week-sub"></span></div>
				</article>
				<article class="card kpi" data-kpi="review" tabindex="0" role="button">
					<div class="kpi-icon warn"><?php echo $mp_i( 'alarm' ); // phpcs:ignore ?></div>
					<div class="kpi-copy"><small>نیاز به بررسی</small><strong id="kpi-review"><span class="sk sk-text"></span></strong><span id="kpi-review-sub"></span></div>
				</article>
				<article class="card kpi" data-kpi="messages" tabindex="0" role="button">
					<div class="kpi-icon info" id="kpi-msg-avatar"><?php echo $mp_i( 'chat' ); // phpcs:ignore ?></div>
					<div class="kpi-copy"><small>پیام اخیر</small><strong id="kpi-msg"><span class="sk sk-text"></span></strong><span id="kpi-msg-sub"></span></div>
				</article>
				<article class="card kpi" data-kpi="attendance" tabindex="0" role="button">
					<div class="kpi-icon ok"><?php echo $mp_i( 'clock' ); // phpcs:ignore ?></div>
					<div class="kpi-copy"><small>حضور امروز</small><strong id="kpi-att"><span class="sk sk-text"></span></strong><span id="kpi-att-sub"></span></div>
				</article>
			</div>

			<div class="dash-grid">
				<section class="card timeline-card">
					<div class="card-head">
						<h2>تایم‌لاین پروژه‌ها</h2>
						<div class="card-tools">
							<select class="select sm" id="timeline-picker" aria-label="انتخاب پروژه"><option value="all">همه پروژه‌ها</option></select>
							<button type="button" class="icon-btn sm manager-only" id="timeline-add" aria-label="افزودن مرحله" title="افزودن مرحله"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?></button>
							<div class="zoom" role="group" aria-label="بزرگ‌نمایی">
								<button type="button" data-tl="out" aria-label="بازه کوتاه‌تر" title="بازه کوتاه‌تر">−</button>
								<span id="timeline-zoom">۱۰۰٪</span>
								<button type="button" data-tl="in" aria-label="بازه بلندتر" title="بازه بلندتر">+</button>
								<button type="button" data-tl="reset" aria-label="برگشت به امروز" title="برگشت به امروز"><?php echo $mp_i( 'target' ); // phpcs:ignore ?></button>
							</div>
						</div>
					</div>
					<div class="timeline" id="timeline" tabindex="0" aria-label="تایم‌لاین؛ فضای خالی را بکشید یا از کلیدهای جهت‌دار استفاده کنید">
						<div class="tl-world" id="tl-world"></div>
					</div>
					<p class="card-hint" id="timeline-hint"></p>
				</section>

				<section class="card progress-card">
					<div class="card-head"><h2>پیشرفت تسک‌ها</h2></div>
					<div id="dash-progress"></div>
				</section>

				<section class="card mini-cal-card">
					<div class="card-head"><h2>تقویم</h2><button type="button" class="link" data-go="calendar">باز کردن</button></div>
					<div id="mini-cal"></div>
				</section>

				<section class="card tasks-card">
					<div class="card-head">
						<h2>تسک‌ها</h2>
						<div class="card-tools">
							<div class="seg sm" role="tablist" aria-label="بازه" id="task-range">
								<button type="button" role="tab" data-range="today" aria-selected="true">امروز</button>
								<button type="button" role="tab" data-range="week" aria-selected="false">هفته</button>
								<button type="button" role="tab" data-range="overdue" aria-selected="false">عقب‌افتاده</button>
							</div>
							<button type="button" class="icon-btn sm accent" id="dash-add-task" aria-label="افزودن تسک" title="افزودن تسک"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?></button>
						</div>
					</div>
					<div class="task-stack" id="dash-tasks"></div>
				</section>

				<section class="card meetings-card">
					<div class="card-head"><h2>جلسات امروز</h2><button type="button" class="icon-btn sm on-dark" id="add-meeting" aria-label="افزودن جلسه" title="افزودن جلسه"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?></button></div>
					<div id="dash-meetings" class="meeting-stack"></div>
					<button type="button" class="join-btn" id="join-meeting" disabled><span>جلسه‌ای در پیش نیست</span><span class="join-icon"><?php echo $mp_i( 'video' ); // phpcs:ignore ?></span></button>
				</section>
			</div>
		</section>

		<!-- ================= Calendar ================= -->
		<section class="view" id="view-calendar" data-view="calendar" hidden aria-label="تقویم">
			<div class="page-head">
				<div><h1>تقویم</h1><p>برنامه روزانه؛ تسک‌های ناظر قفل هستند و فقط وضعیتشان تغییر می‌کند</p></div>
				<div class="page-actions">
					<div class="seg manager-only" role="tablist" id="cal-mode" aria-label="نما">
						<button type="button" role="tab" data-mode="person" aria-selected="true">فردی</button>
						<button type="button" role="tab" data-mode="team" aria-selected="false">تیم</button>
					</div>
					<select class="select manager-only" id="cal-user" aria-label="تقویم چه کسی"></select>
					<button type="button" class="btn btn-secondary" id="cal-today">امروز</button>
					<button type="button" class="btn btn-secondary" data-action="daily-report"><?php echo $mp_i( 'list' ); // phpcs:ignore ?>گزارش روزانه</button><button type="button" class="btn btn-secondary manager-only" data-action="task-io"><?php echo $mp_i( 'file' ); // phpcs:ignore ?>اکسل تسک‌ها</button><button type="button" class="btn btn-secondary manager-only" data-action="templates"><?php echo $mp_i( 'list' ); // phpcs:ignore ?>قالب‌ها</button><button type="button" class="btn btn-secondary manager-only" data-action="voice-tasks"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?>تسک گروهی با صدا</button>
					<button type="button" class="btn btn-primary" id="cal-add"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>افزودن تسک</button>
				</div>
			</div>
			<div class="legend">
				<span><i class="lg lg-lock"></i>تعیین‌شده توسط ناظر</span>
				<span><i class="lg lg-self"></i>تسک شخصی</span>
				<span><i class="lg lg-leave"></i>مرخصی</span>
				<span><i class="lg lg-rem"></i>یادآوری</span>
			</div>
			<div class="cal-layout" id="cal-person">
				<aside class="card day-panel" id="day-panel" aria-live="polite"></aside>
				<section class="card cal-card">
					<div class="cal-head">
						<button type="button" class="icon-btn" id="cal-prev" aria-label="ماه قبل"><?php echo $mp_i( 'right' ); // phpcs:ignore ?></button>
						<strong id="cal-title"></strong>
						<button type="button" class="icon-btn" id="cal-next" aria-label="ماه بعد"><?php echo $mp_i( 'left' ); // phpcs:ignore ?></button>
					</div>
					<div class="cal-week" aria-hidden="true"><span>شنبه</span><span>یکشنبه</span><span>دوشنبه</span><span>سه‌شنبه</span><span>چهارشنبه</span><span>پنجشنبه</span><span>جمعه</span></div>
					<div class="cal-grid" id="cal-grid"></div>
				</section>
			</div>
			<section class="card team-cal" id="cal-team" hidden>
				<div class="cal-head">
					<button type="button" class="icon-btn" id="team-prev" aria-label="هفته قبل"><?php echo $mp_i( 'right' ); // phpcs:ignore ?></button>
					<strong id="team-title"></strong>
					<button type="button" class="icon-btn" id="team-next" aria-label="هفته بعد"><?php echo $mp_i( 'left' ); // phpcs:ignore ?></button>
				</div>
				<div class="team-scroll"><div class="team-grid" id="team-grid"></div></div>
			</section>
		</section>

		<!-- ================= My tasks ================= -->
		<section class="view" id="view-mytasks" data-view="mytasks" hidden aria-label="تسک‌های من">
			<div class="page-head">
				<div><h1>تسک‌های من</h1><p>همه کارهایی که به شما سپرده شده یا خودتان ثبت کرده‌اید</p></div>
				<div class="page-actions"><button type="button" class="btn btn-secondary" data-action="daily-report"><?php echo $mp_i( 'list' ); // phpcs:ignore ?>گزارش روزانه</button><button type="button" class="btn btn-secondary manager-only" data-action="task-io"><?php echo $mp_i( 'file' ); // phpcs:ignore ?>اکسل تسک‌ها</button><button type="button" class="btn btn-secondary manager-only" data-action="templates"><?php echo $mp_i( 'list' ); // phpcs:ignore ?>قالب‌ها</button><button type="button" class="btn btn-secondary manager-only" data-action="voice-tasks"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?>تسک گروهی با صدا</button><button type="button" class="btn btn-primary" id="mytasks-add"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>افزودن تسک</button></div>
			</div>
			<div class="toolbar">
				<label class="search grow"><?php echo $mp_i( 'search' ); // phpcs:ignore ?><input type="search" id="mt-q" placeholder="جستجوی تسک، پروژه یا بخش…" aria-label="جستجو"></label>
				<select class="select" id="mt-status" aria-label="وضعیت"><option value="open">باز</option><option value="all">همه وضعیت‌ها</option><option value="done">انجام شده</option><option value="archived">آرشیو</option></select>
				<select class="select" id="mt-source" aria-label="منبع"><option value="all">همه منابع</option><option value="manager">تعیین‌شده توسط ناظر</option><option value="self">شخصی</option></select>
				<select class="select" id="mt-range" aria-label="موعد"><option value="all">همه موعدها</option><option value="overdue">عقب‌افتاده</option><option value="today">امروز</option><option value="week">این هفته</option><option value="month">این ماه</option></select>
				<span class="toolbar-count" id="mt-count"></span>
			</div>
			<section class="card list-card" id="mt-list"></section>
		</section>

		<!-- ================= Projects ================= -->
		<section class="view" id="view-projects" data-view="projects" hidden aria-label="پروژه‌ها">
			<div class="page-head">
				<div><h1>پروژه‌ها</h1><p>بخش‌ها، تیم، یادداشت‌ها و تسک‌های هر پروژه</p></div>
				<div class="page-actions">
					<select class="select" id="proj-folder" aria-label="فولدر"></select>
					<button type="button" class="btn btn-secondary manager-only" id="proj-folders"><?php echo $mp_i( 'folder' ); // phpcs:ignore ?>فولدرها</button>
					<button type="button" class="btn btn-primary manager-only" id="proj-new"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>پروژه جدید</button>
				</div>
			</div>
			<div class="tabs" role="tablist" id="proj-tabs" aria-label="پروژه‌ها"></div>
			<div id="proj-body"></div>
		</section>

		<!-- ================= Clients ================= -->
		<section class="view" id="view-clients" data-view="clients" hidden aria-label="مشتریان">
			<div class="page-head">
				<div><h1>مشتریان</h1><p>هر مشتری با پروژه‌ها، گروه‌های گفت‌وگو، پرتال، فاکتورها و آنچه منتظر پاسخ است</p></div>
				<div class="page-actions">
					<label class="search cl-search"><?php echo $mp_i( 'search' ); // phpcs:ignore ?><input type="search" id="cl-q" placeholder="جست‌وجوی مشتری یا پروژه" aria-label="جست‌وجوی مشتری"></label>
					<button type="button" class="btn btn-primary" id="cl-new"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>مشتری جدید</button>
				</div>
			</div>
			<div class="tabs" role="tablist" id="cl-tabs" aria-label="فیلتر مشتریان"></div>
			<div id="cl-body"></div>
		</section>

		<!-- ================= Meetings ================= -->
		<section class="view" id="view-meetings" data-view="meetings" hidden aria-label="جلسات">
			<div class="page-head">
				<div><h1>جلسات</h1><p>جلسه آنلاین با لینک اختصاصی، اتاق انتظار، دعوت همکاران و مهمان</p></div>
				<div class="page-actions">
					<button type="button" class="btn btn-secondary manager-only" id="mt-settings"><?php echo $mp_i( 'settings' ); // phpcs:ignore ?>تنظیمات</button>
					<button type="button" class="btn btn-primary" id="mt-new"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>جلسه جدید</button>
				</div>
			</div>
			<div class="mt-tools">
				<div class="tabs" role="tablist" id="mt-tabs" aria-label="فیلتر جلسات"></div>
				<label class="search mt-search"><?php echo $mp_i( 'search' ); // phpcs:ignore ?><input type="search" id="mt-q" placeholder="جستجو در جلسات…" aria-label="جستجو در جلسات"></label>
			</div>
			<div id="mt-body"></div>
		</section>

		<!-- ================= Contracts ================= -->
		<section class="view" id="view-contracts" data-view="contracts" hidden aria-label="قراردادها">
			<div class="page-head">
				<div><h1>قراردادها</h1><p>قرارداد پروژه‌ها از روی قالب، با امضای آنلاین مشتری و خروجی چاپ و PDF</p></div>
				<div class="page-actions">
					<button type="button" class="btn btn-secondary" id="ct-settings"><?php echo $mp_i( 'settings' ); // phpcs:ignore ?>قالب‌ها و ظاهر</button>
					<button type="button" class="btn btn-primary" id="ct-new"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>قرارداد جدید</button>
				</div>
			</div>
			<div class="tabs" role="tablist" id="ct-tabs" aria-label="فیلتر قراردادها"></div>
			<div id="ct-body"></div>
		</section>

		<!-- ================= Messages ================= -->
		<section class="view" id="view-messages" data-view="messages" hidden aria-label="پیام‌ها">
			<div class="page-head">
				<div><h1>پیام‌ها</h1><p>گفت‌وگوی تیم، خصوصی و گروه‌های مشتری</p></div>
				<div class="page-actions">
					<button type="button" class="btn btn-secondary manager-only" id="new-team-group">گروه تیم</button><button type="button" class="btn btn-secondary" id="new-client-group">گروه مشتری</button>
					<button type="button" class="btn btn-primary" id="new-dm"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>پیام جدید</button>
				</div>
			</div>
			<div class="chat-layout" id="chat-layout">
				<aside class="card chat-list" id="chat-list" aria-label="گفت‌وگوها"></aside>
				<section class="card chat-pane">
					<header class="chat-head">
						<button type="button" class="icon-btn chat-back" id="chat-back" aria-label="بازگشت به فهرست"><?php echo $mp_i( 'right' ); // phpcs:ignore ?></button>
						<button type="button" class="chat-head-who" id="chat-who" aria-label="اطلاعات گفت‌وگو">
							<span class="chat-head-av" id="chat-avatar"></span>
							<span class="chat-head-copy"><strong id="chat-title">گفت‌وگویی انتخاب نشده</strong><small id="chat-sub"></small><small class="chat-activity" id="chat-activity" hidden></small></span>
						</button>
						<div id="chat-tools" class="chat-tools"></div>
						<div class="chat-find" id="chat-find" hidden>
							<button type="button" class="icon-btn" id="chat-find-close" aria-label="بستن جستجو"><?php echo $mp_i( 'right' ); // phpcs:ignore ?></button>
							<input type="search" id="chat-find-q" placeholder="جستجو در این گفت‌وگو…" aria-label="جستجو در این گفت‌وگو" autocomplete="off">
							<span class="chat-find-n" id="chat-find-n"></span>
							<button type="button" class="icon-btn" id="chat-find-up" aria-label="نتیجه قبلی"><?php echo $mp_i( 'arrow-up' ); // phpcs:ignore ?></button>
							<button type="button" class="icon-btn" id="chat-find-down" aria-label="نتیجه بعدی"><?php echo $mp_i( 'arrow-down' ); // phpcs:ignore ?></button>
						</div>
						<div class="chat-select" id="chat-select" hidden>
							<button type="button" class="icon-btn" id="sel-close" aria-label="لغو انتخاب"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button>
							<strong id="sel-count"></strong>
							<button type="button" class="icon-btn" id="sel-copy" aria-label="کپی"><?php echo $mp_i( 'file' ); // phpcs:ignore ?></button>
							<button type="button" class="icon-btn" id="sel-forward" aria-label="فوروارد"><?php echo $mp_i( 'send' ); // phpcs:ignore ?></button>
							<button type="button" class="icon-btn danger" id="sel-delete" aria-label="حذف"><?php echo $mp_i( 'trash' ); // phpcs:ignore ?></button>
						</div>
					</header>
					<button type="button" class="chat-pinbar" id="chat-pinbar" hidden><span class="pb-ico"><?php echo $mp_i( 'pin' ); // phpcs:ignore ?></span><span class="pb-copy"><b>پیام سنجاق‌شده</b><small id="chat-pin-text"></small></span><span class="pb-x" id="chat-pin-x" role="button" aria-label="برداشتن سنجاق"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></span></button>
					<div class="chat-find-list" id="chat-find-list" hidden></div>
					<div class="chat-messages" id="chat-messages"></div>
					<button type="button" class="chat-down" id="chat-down" hidden aria-label="رفتن به آخرین پیام"><?php echo $mp_i( 'down' ); // phpcs:ignore ?><i class="badge" id="chat-down-n" hidden></i></button>
					<form class="composer" id="composer" hidden>
						<div class="compose-ctx" id="compose-ctx" hidden><span class="cc-ico" id="cc-ico"></span><span class="cc-copy"><b id="cc-title"></b><small id="cc-text"></small></span><button type="button" class="icon-btn sm" id="cc-x" aria-label="لغو"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button></div>
						<div class="mention-pop" id="mention-pop" hidden></div>
						<div class="emoji-pop" id="emoji-pop" hidden></div>
						<div class="composer-row">
							<label class="icon-btn composer-clip" title="پیوست عکس یا فایل" aria-label="پیوست عکس یا فایل"><?php echo $mp_i( 'clip' ); // phpcs:ignore ?><input type="file" id="composer-file" class="visually-hidden" multiple></label>
							<div class="composer-input"><textarea id="composer-text" rows="1" placeholder="پیام… (Enter ارسال، Shift+Enter خط جدید)" maxlength="4000" aria-label="متن پیام"></textarea><button type="button" class="composer-emoji" id="composer-emoji" aria-label="ایموجی">😊</button></div>
							<button type="button" class="icon-btn lg composer-mic" id="composer-mic" aria-label="ضبط پیام صوتی" title="پیام صوتی"><?php echo $mp_i( 'mic' ); // phpcs:ignore ?></button>
							<button type="submit" class="icon-btn accent lg composer-send" aria-label="ارسال"><?php echo $mp_i( 'send' ); // phpcs:ignore ?></button>
						</div>
						<div class="rec-bar" id="rec-bar" hidden>
							<button type="button" class="icon-btn danger" id="rec-cancel" aria-label="لغو ضبط"><?php echo $mp_i( 'trash' ); // phpcs:ignore ?></button>
							<span class="rec-dot" aria-hidden="true"></span><span class="rec-time" id="rec-time">۰:۰۰</span>
							<span class="rec-wave" id="rec-wave" aria-hidden="true"></span>
							<span class="rec-live" id="rec-live"></span>
							<button type="button" class="icon-btn accent lg" id="rec-send" aria-label="ارسال پیام صوتی"><?php echo $mp_i( 'send' ); // phpcs:ignore ?></button>
						</div>
					</form>
				</section>
			</div>
		</section>

		<!-- ================= Attendance & leave ================= -->
		<section class="view" id="view-attendance" data-view="attendance" hidden aria-label="حضور و مرخصی">
			<div class="page-head">
				<div><h1>حضور و مرخصی</h1><p>ثبت ورود و خروج، کارکرد و درخواست مرخصی</p></div>
				<div class="page-actions"><button type="button" class="btn btn-secondary manager-only" data-action="payroll"><?php echo $mp_i( 'wallet' ); // phpcs:ignore ?>حقوق ماهانه</button><button type="button" class="btn btn-primary" id="leave-new"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?>درخواست مرخصی</button></div>
			</div>
			<div id="att-body"></div>
		</section>

		<!-- ================= Reminders ================= -->
		<section class="view" id="view-reminders" data-view="reminders" hidden aria-label="یادآوری">
			<div class="page-head">
				<div><h1>یادآوری</h1><p>در زمان تعیین‌شده اعلان، ایمیل و پیام تلگرام/بله دریافت می‌کنید</p></div>
				<div class="page-actions"><button type="button" class="btn btn-secondary" data-go="calendar">نمایش در تقویم</button></div>
			</div>
			<div class="split">
				<section class="card pad" id="reminder-form-card"></section>
				<section class="card pad"><h2 class="card-title">یادآوری‌های آینده</h2><div id="reminder-list"></div></section>
			</div>
		</section>

		<!-- ================= Accounting ================= -->
		<section class="view" id="view-accounting" data-view="accounting" hidden aria-label="حسابداری">
			<div class="page-head">
				<div><h1>حسابداری</h1><p>ثبت دخل و خرج با تاریخ و ساعت و موجودی لحظه‌ای</p></div>
				<div class="page-actions">
					<button type="button" class="btn btn-primary manager-only" data-action="invoices"><?php echo $mp_i( 'file' ); // phpcs:ignore ?>فاکتورها</button><button type="button" class="btn btn-secondary" id="acc-print"><?php echo $mp_i( 'print' ); // phpcs:ignore ?>PDF</button>
					<button type="button" class="btn btn-secondary" id="acc-xlsx"><?php echo $mp_i( 'download' ); // phpcs:ignore ?>اکسل</button>
				</div>
			</div>
			<div id="acc-body"></div>
		</section>

		<!-- ================= Reports ================= -->
		<section class="view" id="view-reports" data-view="reports" hidden aria-label="گزارش‌ها">
			<div class="page-head">
				<div><h1>گزارش‌ها</h1><p>عملکرد، پیشرفت پروژه‌ها و تاریخچه تغییرات</p></div>
				<div class="page-actions">
					<div class="seg manager-only" role="tablist" id="rep-tab" aria-label="نوع گزارش"><button type="button" role="tab" data-tab="perf" aria-selected="true">عملکرد</button><button type="button" role="tab" data-tab="costs" aria-selected="false">هزینه پروژه‌ها</button><button type="button" role="tab" data-tab="payroll" aria-selected="false">حقوق ماهانه</button><button type="button" role="tab" data-tab="meetings" aria-selected="false">جلسات</button><button type="button" role="tab" data-tab="audit" aria-selected="false">تاریخچه تغییرات</button></div>
					<select class="select manager-only" id="rep-user" aria-label="گزارش چه کسی"></select><button type="button" class="btn btn-primary manager-only" data-action="weekly-report"><?php echo $mp_i( 'pie' ); // phpcs:ignore ?>گزارش هفتگی</button>
				</div>
			</div>
			<div id="rep-body"></div>
		</section>
	</main>
</div>

<nav class="bottom-nav" aria-label="منوی پایین">
	<button type="button" data-view="dashboard"><?php echo $mp_i( 'grid' ); // phpcs:ignore ?><span>خانه</span></button>
	<button type="button" data-view="calendar"><?php echo $mp_i( 'calendar' ); // phpcs:ignore ?><span>تقویم</span></button>
	<button type="button" class="fab" data-action="create" aria-label="ایجاد سریع"><?php echo $mp_i( 'plus' ); // phpcs:ignore ?></button>
	<button type="button" data-view="mytasks"><?php echo $mp_i( 'tasks' ); // phpcs:ignore ?><span>تسک‌ها</span><i class="badge" data-count="tasks" hidden></i></button>
	<button type="button" data-view="messages"><?php echo $mp_i( 'chat' ); // phpcs:ignore ?><span>پیام‌ها</span><i class="badge" data-count="messages" hidden></i></button>
</nav>

<dialog class="dialog" id="dialog" aria-labelledby="dialog-title">
	<div class="sheet-handle" aria-hidden="true"></div>
	<div class="dialog-head"><h2 id="dialog-title"></h2><button type="button" class="icon-btn dialog-close" aria-label="بستن"><?php echo $mp_i( 'close' ); // phpcs:ignore ?></button></div>
	<div class="dialog-body" id="dialog-body"></div>
</dialog>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
<noscript><p class="noscript">برای استفاده از پنل، جاوااسکریپت مرورگر را فعال کنید.</p></noscript>
<script>window.MP_CONFIG = <?php echo wp_json_encode( MP_Frontend::config() ); ?>;</script>
<?php echo MP_Frontend::pwa_script(); // phpcs:ignore ?>
<?php foreach ( MP_Frontend::SCRIPTS as $mp_script ) : ?>
<script src="<?php echo MP_Frontend::asset( 'js/' . $mp_script ); // phpcs:ignore ?>"></script>
<?php endforeach; ?>
</body>
</html>

<?php
defined( 'ABSPATH' ) || exit;

/**
 * Every notification and SMS the panel sends, in one editable catalog.
 *
 * - Texts use #NAME# variables (the same syntax as sms.ir patterns), so the SMS text is the pattern.
 * - The site admin can change the texts, turn a message off and choose when a notification is also an SMS.
 * - With sms.ir, a message that has a pattern (template) ID goes through «ارسال سریع» (/v1/send/verify);
 *   otherwise it goes as plain text from the sending line. sms.ir has no API for creating templates
 *   (each one is reviewed by their staff), so the panel builds the exact pattern text to paste there.
 * - Pattern values are limited to 25 characters, so links go as short links (/s/{code}) whose fixed
 *   part is written into the pattern and only the code is sent.
 */
class MP_Messages {

	const OPTION    = 'mp_messages';
	const LOG       = 'mp_sms_log';
	const MAX_PARAM = 25;

	/** Variable name => [description, sample, kind]. kind: '' text, 'link' (short link), 'const' (fixed, written into the pattern). */
	const VARS = array(
		'ACTOR'    => array( 'نام کسی که کار را انجام داد', 'سارا احمدی', '' ),
		'NAME'     => array( 'نام گیرنده', 'آقای رضایی', '' ),
		'FIRST'    => array( 'نام کوچک گیرنده', 'سارا', '' ),
		'CLIENT'   => array( 'نام مشتری', 'شرکت آوا', '' ),
		'TASK'     => array( 'عنوان تسک', 'طراحی لوگو', '' ),
		'TITLE'    => array( 'عنوان', 'بررسی طرح اولیه', '' ),
		'PROJECT'  => array( 'نام پروژه', 'هویت بصری آوا', '' ),
		'GROUP'    => array( 'نام گروه / گفت‌وگو', 'تیم طراحی', '' ),
		'PREVIEW'  => array( 'خلاصه متن پیام یا نظر', 'رنگ‌ها را کمی روشن‌تر کنید', '' ),
		'NOTE'     => array( 'توضیح', 'با هماهنگی انجام شود', '' ),
		'STATUS'   => array( 'نتیجه', 'تأیید شده', '' ),
		'DATE'     => array( 'تاریخ', '۱۴۰۵/۰۷/۱۰', '' ),
		'TIME'     => array( 'ساعت', '۱۰:۳۰', '' ),
		'WHEN'     => array( 'زمان (تاریخ و ساعت)', '۱۴۰۵/۰۷/۱۰ ساعت ۱۰:۳۰', '' ),
		'COUNT'    => array( 'تعداد', '۵', '' ),
		'PROGRESS' => array( 'درصد پیشرفت', '۸۰', '' ),
		'NUMBER'   => array( 'شماره سند', '۱۴۰۵-۰۱۲', '' ),
		'AMOUNT'   => array( 'مبلغ (تومان)', '۱۲٬۰۰۰٬۰۰۰', '' ),
		'GATEWAY'  => array( 'درگاه پرداخت', 'زیبال', '' ),
		'REF'      => array( 'کد پیگیری', '۸۴۵۲۱۳', '' ),
		'DEADLINE' => array( 'مهلت (با عنوان)', '(مهلت تا ۱۴۰۵/۰۸/۰۱)', '' ),
		'SUMMARY'  => array( 'خلاصه برنامه روز', '۳ تسک، ۱ جلسه', '' ),
		'ITEMS'    => array( 'فهرست کارهای روز', 'جلسه ۱۰:۳۰: بررسی طرح | • طراحی لوگو', '' ),
		'DONE'     => array( 'تسک‌های انجام‌شده', '۲۴', '' ),
		'OVERDUE'  => array( 'تسک‌های عقب‌افتاده', '۳', '' ),
		'INCOME'   => array( 'دخل', '۴۵٬۰۰۰٬۰۰۰ تومان', '' ),
		'EXPENSE'  => array( 'خرج', '۱۲٬۰۰۰٬۰۰۰ تومان', '' ),
		'HOURS'    => array( 'ساعت حضور تیم', '۱۸۰', '' ),
		'CODE'     => array( 'کد یک‌بارمصرف', '۴۸۲۱۷', '' ),
		'DAYS'     => array( 'تعداد روز', '۵', '' ),
		'DIRECTION' => array( 'جهت (عقب انداخت / جلو انداخت)', 'عقب انداخت', '' ),
		'LINK'     => array( 'لینک (کوتاه‌شده در پیامک)', '', 'link' ),
		'SITE'     => array( 'نام سایت (ثابت)', '', 'const' ),
		'STUDIO'   => array( 'نام استودیو در قرارداد (ثابت)', '', 'const' ),
		'PANEL'    => array( 'آدرس پنل (ثابت)', '', 'const' ),
	);

	/** Who receives the message: audience => [title, description]. */
	const AUDIENCES = array(
		'staff'  => array( 'کارمندان و تیم', 'اعلان‌ها (و پیامک‌هایشان) که به همکاران داخل پنل می‌رسد.' ),
		'client' => array( 'مشتریان، پرتال و مهمان‌ها', 'پیامک‌هایی که به مشتری، امضاکننده قرارداد یا مهمان جلسه می‌رسد؛ این افراد عضو پنل نیستند.' ),
		'shared' => array( 'مشترک', 'هم کارمندان و هم مشتریان دریافت می‌کنند.' ),
	);

	/** Sections of the settings page: group => [title, audience]. */
	const GROUPS = array(
		'tasks'      => array( 'تسک‌ها و گزارش روزانه', 'staff' ),
		'team'       => array( 'پروژه‌ها و گفت‌وگوها', 'staff' ),
		'meetings'   => array( 'جلسات و یادآوری‌ها', 'staff' ),
		'leave'      => array( 'مرخصی', 'staff' ),
		'clients'    => array( 'کارهای مشتری در پرتال، قرارداد و فاکتور (خبر به تیم)', 'staff' ),
		'digest'     => array( 'خلاصه‌ها', 'staff' ),
		'c_portal'   => array( 'گروه مشتری و پرتال', 'client' ),
		'c_contract' => array( 'قرارداد', 'client' ),
		'c_meeting'  => array( 'جلسه آنلاین (مهمان)', 'client' ),
		'login'      => array( 'کد ورود', 'shared' ),
	);

	/**
	 * key => [group, kind (notify|sms), label, recipient, type, title, detail, vars, sms?]
	 * «notify» goes to the panel (+ push, Telegram/Bale) and by SMS when important or when set to always;
	 * its default SMS text is title - detail. «sms» is a text message only (clients, guests, login codes).
	 */
	public static function catalog() {
		static $c = null;
		if ( null !== $c ) {
			return $c;
		}
		$n = function ( $group, $label, $to, $type, $title, $detail, $vars, $extra = array() ) {
			return array_merge( array( 'group' => $group, 'kind' => 'notify', 'label' => $label, 'to' => $to, 'type' => $type, 'title' => $title, 'detail' => $detail, 'vars' => $vars, 'sms' => $title . ( '' !== $detail ? ' - ' . $detail : '' ), 'important' => '' ), $extra );
		};
		$s = function ( $label, $to, $sms, $vars, $extra = array() ) {
			return array_merge( array( 'group' => 'c_portal', 'kind' => 'sms', 'label' => $label, 'to' => $to, 'type' => '', 'title' => '', 'detail' => '', 'vars' => $vars, 'sms' => $sms ), $extra );
		};
		$c = array(
			'task_assigned'      => $n( 'tasks', 'تعیین تسک توسط ناظر', 'کارمند مسئول', 'task', '#ACTOR# برای شما تسک تعیین کرد', '#TASK# · #WHEN#', array( 'ACTOR', 'TASK', 'WHEN' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'task_updated'       => $n( 'tasks', 'ویرایش تسک توسط ناظر', 'کارمند مسئول', 'task', 'تسک «#TASK#» توسط ناظر به‌روز شد', '#DATE#', array( 'TASK', 'DATE' ) ),
			'task_done'          => $n( 'tasks', 'انجام تسک تعیین‌شده', 'ناظری که تسک را داده', 'task', '#ACTOR# تسک را انجام داد', '#TASK#', array( 'ACTOR', 'TASK' ) ),
			'task_archived'      => $n( 'tasks', 'آرشیو تسک توسط ناظر', 'کارمند مسئول', 'task', 'تسک «#TASK#» توسط ناظر آرشیو شد', '#DATE#', array( 'TASK', 'DATE' ) ),
			'task_seen'          => $n( 'tasks', 'دیده شدن تسک', 'ناظری که تسک را داده', 'task', '#ACTOR# تسک را دید', '#TASK#', array( 'ACTOR', 'TASK' ) ),
			'task_comment'       => $n( 'tasks', 'نظر روی تسک', 'طرف‌های گفت‌وگوی تسک', 'comment', '#ACTOR# روی «#TASK#» نظر گذاشت', '#PREVIEW#', array( 'ACTOR', 'TASK', 'PREVIEW' ) ),
			'task_import'        => $n( 'tasks', 'ورود برنامه کاری از اکسل', 'کارمند', 'task', '#ACTOR# برنامه کاری شما را از اکسل وارد کرد', '#COUNT# تسک جدید در تقویم شما', array( 'ACTOR', 'COUNT' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'daily_report'       => $n( 'tasks', 'ثبت گزارش روزانه', 'ناظرها', 'report', '#ACTOR# گزارش روزانه را ثبت کرد', '#DATE# · #PROGRESS#٪', array( 'ACTOR', 'DATE', 'PROGRESS' ) ),
			'daily_remind'       => $n( 'tasks', 'یادآوری ثبت گزارش روزانه', 'کارمندانی که گزارش نداده‌اند', 'report', 'وقت ثبت گزارش روزانه است', 'کارهای امروز، درصد پیشرفت، مشکلات، نیاز به تصمیم و برنامه فردا', array(), array( 'important' => 'مهم' ) ),
			'project_added'      => $n( 'team', 'افزوده شدن به پروژه', 'عضو جدید', 'project', 'شما به پروژه «#PROJECT#» اضافه شدید', '', array( 'PROJECT' ) ),
			'project_shifted'    => $n( 'team', 'جابه‌جایی زمان‌بندی پروژه', 'کسانی که تسکشان جابه‌جا شد', 'project', '#ACTOR# تسک‌های پروژه «#PROJECT#» را #DAYS# روز #DIRECTION#', '#COUNT# تسک شما جابه‌جا شد؛ تقویم را ببینید', array( 'ACTOR', 'PROJECT', 'DAYS', 'DIRECTION', 'COUNT' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'group_added'        => $n( 'team', 'افزوده شدن به گروه', 'عضو جدید', 'message', 'شما به گروه «#GROUP#» اضافه شدید', '', array( 'GROUP' ) ),
			'message_direct'     => $n( 'team', 'پیام خصوصی جدید', 'طرف گفت‌وگو', 'message', 'پیام جدید از #ACTOR#', '#PREVIEW#', array( 'ACTOR', 'PREVIEW' ) ),
			'message_mention'    => $n( 'team', 'منشن در گفت‌وگو (@نام)', 'فردی که صدا زده شده', 'message', '#ACTOR# در «#GROUP#» شما را صدا زد', '#PREVIEW#', array( 'ACTOR', 'GROUP', 'PREVIEW' ) ),
			'message_reply'      => $n( 'team', 'پاسخ به پیام شما در گروه', 'نویسنده پیام', 'message', '#ACTOR# در «#GROUP#» به پیام شما پاسخ داد', '#PREVIEW#', array( 'ACTOR', 'GROUP', 'PREVIEW' ) ),
			'message_client'     => $n( 'team', 'پیام جدید مشتری', 'اعضای گروه مشتری', 'message', 'پیام جدید مشتری در «#GROUP#»', '#PREVIEW#', array( 'GROUP', 'PREVIEW' ) ),
			'meet_invite'        => $n( 'meetings', 'دعوت به جلسه', 'شرکت‌کنندگان', 'meeting', '#ACTOR# شما را به جلسه «#TITLE#» دعوت کرد', '#WHEN#', array( 'ACTOR', 'TITLE', 'WHEN' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'meet_moved'         => $n( 'meetings', 'تغییر زمان جلسه', 'شرکت‌کنندگان', 'meeting', 'زمان جلسه «#TITLE#» تغییر کرد', '#WHEN#', array( 'TITLE', 'WHEN' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'meet_cancel'        => $n( 'meetings', 'لغو جلسه', 'شرکت‌کنندگان', 'meeting', 'جلسه «#TITLE#» لغو شد', '#DATE# · #TIME#', array( 'TITLE', 'DATE', 'TIME' ) ),
			'meet_minutes'       => $n( 'meetings', 'ثبت صورتجلسه', 'شرکت‌کنندگان', 'meeting', 'صورتجلسه «#TITLE#» ثبت شد', '', array( 'TITLE' ) ),
			'meet_remind'        => $n( 'meetings', 'یادآوری ۱۰ دقیقه قبل از جلسه', 'شرکت‌کنندگان', 'meeting', 'جلسه «#TITLE#» ساعت #TIME# شروع می‌شود', 'ورود: #LINK#', array( 'TITLE', 'TIME', 'LINK' ), array( 'important' => 'مهم' ) ),
			'meet_started'       => $n( 'meetings', 'شروع جلسه', 'شرکت‌کنندگان', 'meeting', 'جلسه «#TITLE#» شروع شد', 'ورود: #LINK#', array( 'TITLE', 'LINK' ) ),
			'reminder'           => $n( 'meetings', 'یادآوری شخصی', 'صاحب یادآوری', 'reminder', 'یادآوری: #TITLE#', '#NOTE#', array( 'TITLE', 'NOTE' ), array( 'important' => 'مهم' ) ),
			'leave_request'      => $n( 'leave', 'درخواست مرخصی', 'ناظرها', 'leave', '#ACTOR# درخواست مرخصی داد', '#WHEN#', array( 'ACTOR', 'WHEN' ), array( 'important' => 'مهم (اگر ناظر اعلان مهم را خاموش نکرده باشد)' ) ),
			'leave_decision'     => $n( 'leave', 'نتیجه درخواست مرخصی', 'کارمند', 'leave', 'درخواست مرخصی شما #STATUS#', '#DATE# · #NOTE#', array( 'STATUS', 'DATE', 'NOTE' ), array( 'important' => 'مهم (اگر کارمند اعلان مهم را خاموش نکرده باشد)' ) ),
			'portal_comment'     => $n( 'clients', 'نظر مشتری روی طرح', 'اعضای پروژه', 'portal', '#CLIENT# روی طرح «#TITLE#» نظر داد', '#PREVIEW#', array( 'CLIENT', 'TITLE', 'PREVIEW' ), array( 'important' => 'مهم' ) ),
			'portal_approved'    => $n( 'clients', 'تأیید طرح توسط مشتری', 'اعضای پروژه', 'portal', '#CLIENT# طرح «#TITLE#» را تأیید کرد', '#NOTE#', array( 'CLIENT', 'TITLE', 'NOTE' ), array( 'important' => 'مهم' ) ),
			'portal_changes'     => $n( 'clients', 'درخواست تغییر طرح', 'اعضای پروژه', 'portal', '#CLIENT# برای طرح «#TITLE#» تغییر خواست', '#NOTE#', array( 'CLIENT', 'TITLE', 'NOTE' ), array( 'important' => 'مهم' ) ),
			'contract_viewed'    => $n( 'clients', 'باز شدن قرارداد توسط مشتری', 'ناظرها', 'contract', '#CLIENT# قرارداد #NUMBER# را باز کرد', '#TITLE#', array( 'CLIENT', 'NUMBER', 'TITLE' ) ),
			'contract_signed'    => $n( 'clients', 'امضای قرارداد توسط مشتری', 'ناظرها', 'contract', '#CLIENT# قرارداد #NUMBER# را امضا کرد؛ نوبت امضای مجری است', '#TITLE#', array( 'CLIENT', 'NUMBER', 'TITLE' ), array( 'important' => 'مهم' ) ),
			'contract_complete'  => $n( 'clients', 'امضای کامل قرارداد', 'ناظرها', 'contract', 'قرارداد #NUMBER# کامل امضا شد', '#TITLE#', array( 'NUMBER', 'TITLE' ), array( 'important' => 'مهم' ) ),
			'invoice_paid'       => $n( 'clients', 'پرداخت آنلاین فاکتور', 'ناظرها', 'invoice', '#CLIENT# فاکتور #NUMBER# را آنلاین پرداخت کرد', '#AMOUNT# تومان · #GATEWAY# · کد پیگیری #REF#', array( 'CLIENT', 'NUMBER', 'AMOUNT', 'GATEWAY', 'REF' ), array( 'important' => 'مهم' ) ),
			'proforma_accepted'  => $n( 'clients', 'تأیید پیش‌فاکتور', 'ناظرها', 'invoice', '#CLIENT# پیش‌فاکتور #NUMBER# را تأیید کرد', '#TITLE#', array( 'CLIENT', 'NUMBER', 'TITLE' ), array( 'important' => 'مهم' ) ),
			'digest_morning'     => $n( 'digest', 'خلاصه صبحگاهی', 'هر کارمند', 'digest', 'صبح بخیر #FIRST#! امروز #SUMMARY#', '#ITEMS#', array( 'FIRST', 'SUMMARY', 'ITEMS' ), array( 'sms' => 'صبح بخیر #FIRST#! امروز #SUMMARY#', 'sms_fixed' => 'پیامک این خلاصه از «تنظیمات خلاصه روزانه» در پنل روشن/خاموش می‌شود.' ) ),
			'digest_weekly'      => $n( 'digest', 'گزارش هفتگی', 'ناظرها', 'weekly', 'گزارش هفتگی: #DONE# تسک انجام، #OVERDUE# عقب‌افتاده، دخل #INCOME#', 'خرج #EXPENSE# · حضور تیم #HOURS# ساعت', array( 'DONE', 'OVERDUE', 'INCOME', 'EXPENSE', 'HOURS' ) ),
			'otp'                => $s( 'کد ورود (کارمند، پرتال مشتری، امضای قرارداد)', 'هر کسی که با موبایل وارد می‌شود', 'کد ورود پنل #SITE#: #CODE#' . "\n\n" . self::origin_line(), array( 'CODE' ), array( 'locked' => true, 'group' => 'login' ) ),
			'portal_link'        => $s( 'لینک گروه مشتری (پرتال) — هنگام اضافه شدن مشتری به گروه', 'مشتری‌ای که به گروه اضافه می‌شود', '#NAME# عزیز، پرتال پروژه «#GROUP#» در #SITE#: #LINK#', array( 'NAME', 'GROUP', 'LINK' ) ),
			'contract_send'      => $s( 'ارسال قرارداد برای امضا', 'مشتری', '#NAME# عزیز، قرارداد «#TITLE#» از #STUDIO# آماده امضاست: #LINK#', array( 'NAME', 'TITLE', 'LINK' ), array( 'group' => 'c_contract' ) ),
			'contract_remind'    => $s( 'یادآوری امضای قرارداد', 'امضاکننده بعدی', '#NAME# عزیز، قرارداد «#TITLE#» از #STUDIO# منتظر امضای شماست #DEADLINE#: #LINK#', array( 'NAME', 'TITLE', 'DEADLINE', 'LINK' ), array( 'group' => 'c_contract' ) ),
			'contract_next'      => $s( 'نوبت امضای نفر بعد', 'امضاکننده بعدی', '#NAME# عزیز، #ACTOR# قرارداد «#TITLE#» را امضا کرد؛ نوبت امضای شماست: #LINK#', array( 'NAME', 'ACTOR', 'TITLE', 'LINK' ), array( 'group' => 'c_contract' ) ),
			'meet_guest_invite'  => $s( 'دعوت مهمان به جلسه آنلاین', 'مهمان', '#NAME# عزیز، دعوت به جلسه آنلاین «#TITLE#» #WHEN#: #LINK#', array( 'NAME', 'TITLE', 'WHEN', 'LINK' ), array( 'group' => 'c_meeting' ) ),
			'meet_guest_remind'  => $s( 'یادآوری جلسه به مهمان', 'مهمان', 'یادآوری: جلسه آنلاین «#TITLE#» ساعت #TIME# شروع می‌شود: #LINK#', array( 'TITLE', 'TIME', 'LINK' ), array( 'group' => 'c_meeting' ) ),
		);
		return $c;
	}

	/* ------------------------------------------------------------------ Settings */

	/** Saved changes only: key => [on, title, detail, sms, mode, tpl, tpl_text]. */
	public static function saved() {
		$s = get_option( self::OPTION, array() );
		return is_array( $s ) ? $s : array();
	}

	/** One message with the admin's changes applied. */
	public static function get( $key ) {
		$cat = self::catalog();
		if ( ! isset( $cat[ $key ] ) ) {
			return null;
		}
		$saved = self::saved();
		$s     = isset( $saved[ $key ] ) && is_array( $saved[ $key ] ) ? $saved[ $key ] : array();
		$m     = $cat[ $key ];
		$m['key']      = $key;
		$m['on']       = ! empty( $m['locked'] ) || ! isset( $s['on'] ) || $s['on'];
		$m['def']      = array( 'title' => $m['title'], 'detail' => $m['detail'], 'sms' => $m['sms'] );
		foreach ( array( 'title', 'detail', 'sms' ) as $f ) {
			if ( isset( $s[ $f ] ) && '' !== trim( (string) $s[ $f ] ) ) {
				$m[ $f ] = (string) $s[ $f ];
			}
		}
		$m['mode']     = isset( $s['mode'] ) && in_array( $s['mode'], array( 'on', 'off' ), true ) ? $s['mode'] : '';
		$m['tpl']      = 'otp' === $key ? (int) get_option( 'mp_smsir_template', 0 ) : ( isset( $s['tpl'] ) ? (int) $s['tpl'] : 0 );
		$m['tpl_text'] = isset( $s['tpl_text'] ) ? (string) $s['tpl_text'] : '';
		$m['custom']   = (bool) array_intersect_key( $s, array_flip( array( 'title', 'detail', 'sms', 'mode' ) ) ) || ( isset( $s['on'] ) && ! $s['on'] );
		return $m;
	}

	/** The fixed values written straight into texts and patterns. */
	public static function constants() {
		$studio = class_exists( 'MP_Contracts' ) ? MP_Contracts::settings()['studio'] : '';
		return array(
			'SITE'   => get_bloginfo( 'name' ),
			'STUDIO' => '' !== $studio ? $studio : get_bloginfo( 'name' ),
			'PANEL'  => MP_Frontend::panel_url(),
		);
	}

	/** Fixed start of every short link; the pattern contains it and only the code is sent. */
	public static function short_prefix() {
		return home_url( '/s/' );
	}

	/* ------------------------------------------------------------------ Rendering */

	/** Replaces #VAR# with values (one pass, so values that contain #X# stay as they are) and tidies empty parts. */
	public static function fill( $text, array $vars ) {
		$map = array();
		foreach ( array_merge( self::constants(), $vars ) as $k => $v ) {
			$map[ '#' . $k . '#' ] = (string) $v;
		}
		return self::tidy( strtr( (string) $text, $map ) );
	}

	/** Separators and spaces left behind by empty values. */
	public static function tidy( $s ) {
		$s = preg_replace( '/[ \t]{2,}/u', ' ', $s );
		$s = preg_replace( '/\s+([!؟?،,.:؛;)»])/u', '$1', $s );
		$s = preg_replace( '/\(\s*\)/u', '', $s );
		$s = preg_replace( '/(\s*·\s*){2,}/u', ' · ', $s );
		$s = preg_replace( '/^(\s*[·\-–]\s*)+|(\s*[·\-–]\s*)+$/u', '', $s );
		return trim( preg_replace( '/[ \t]{2,}/u', ' ', $s ) );
	}

	/**
	 * Panel notification for an event, or null when the admin turned it off.
	 * @return array{type:string,title:string,detail:string}|null
	 */
	public static function notification( $key, array $vars ) {
		$m = self::get( $key );
		if ( ! $m ) {
			return null;
		}
		if ( ! $m['on'] ) {
			return null;
		}
		return array( 'type' => $m['type'], 'title' => self::fill( $m['title'], $vars ), 'detail' => self::fill( $m['detail'], $vars ) );
	}

	/** '' = only when the event is important, 'on' = always, 'off' = never, 'fixed' = decided elsewhere. */
	public static function sms_mode( $key ) {
		$m = self::get( $key );
		if ( ! $m ) {
			return '';
		}
		return ! empty( $m['sms_fixed'] ) ? 'fixed' : $m['mode'];
	}

	/** The text to register at sms.ir: fixed values written in, links as prefix + #LINK#. */
	public static function pattern_text( $text ) {
		$map = array();
		foreach ( self::constants() as $k => $v ) {
			$map[ '#' . $k . '#' ] = $v;
		}
		foreach ( self::VARS as $k => $v ) {
			if ( 'link' === $v[2] ) {
				$map[ '#' . $k . '#' ] = self::short_prefix() . '#' . $k . '#';
			}
		}
		return strtr( (string) $text, $map );
	}

	/** Variable names in a pattern text, in order. */
	public static function pattern_vars( $pattern ) {
		preg_match_all( '/#([A-Z][A-Z0-9]*)#/', (string) $pattern, $mm );
		return array_values( array_unique( $mm[1] ) );
	}

	/** sms.ir allows 25 characters per value. */
	private static function cut( $v ) {
		$v = trim( preg_replace( '/\s+/u', ' ', (string) $v ) );
		if ( '' === $v ) {
			return '-';
		}
		return mb_strlen( $v ) > self::MAX_PARAM ? rtrim( mb_substr( $v, 0, self::MAX_PARAM - 1 ) ) . '…' : $v;
	}

	/** Parameters for /v1/send/verify, named after the variables of the registered pattern. */
	public static function pattern_params( $m, array $vars ) {
		$pattern = '' !== $m['tpl_text'] ? $m['tpl_text'] : self::pattern_text( $m['sms'] );
		$out     = array();
		foreach ( self::pattern_vars( $pattern ) as $name ) {
			$v = isset( $vars[ $name ] ) ? $vars[ $name ] : '';
			if ( isset( self::VARS[ $name ] ) && 'link' === self::VARS[ $name ][2] ) {
				$v = '' !== $v ? self::short_code( $v ) : '';
			}
			$out[] = array( 'name' => $name, 'value' => self::cut( $v ) );
		}
		// Login code from before this catalog: a template made by hand with its own variable name.
		if ( 'otp' === $m['key'] && '' === $m['tpl_text'] ) {
			$param = get_option( 'mp_smsir_param', 'CODE' );
			$out   = array( array( 'name' => $param ? $param : 'CODE', 'value' => isset( $vars['CODE'] ) ? (string) $vars['CODE'] : '' ) );
		}
		return $out;
	}

	/**
	 * Last line of the login SMS: «@example.com #12345» (written ##CODE# so the # stays before the code). With it Android Chrome fills the code by itself
	 * (WebOTP) and iPhone offers it above the keyboard only on this site.
	 */
	public static function origin_line() {
		return '@' . wp_parse_url( home_url(), PHP_URL_HOST ) . ' ##CODE#';
	}

	/** Plain text of the SMS, links shortened. */
	public static function sms_text( $m, array $vars ) {
		if ( 'otp' === $m['key'] && false === strpos( $m['sms'], '@' . wp_parse_url( home_url(), PHP_URL_HOST ) ) ) {
			$m['sms'] = rtrim( $m['sms'] ) . "\n\n" . self::origin_line(); // an older custom text still gets the code line
		}
		foreach ( $vars as $k => $v ) {
			if ( isset( self::VARS[ $k ] ) && 'link' === self::VARS[ $k ][2] && '' !== (string) $v ) {
				$vars[ $k ] = self::short_url( $v );
			}
		}
		return self::fill( $m['sms'], $vars );
	}

	/* ------------------------------------------------------------------ Sending */

	public static $last_error = '';

	/**
	 * Sends one catalog SMS: by pattern when sms.ir has its template ID, otherwise as plain text.
	 * Blocking, so the result is real (and logged). Returns true when the provider accepted it.
	 */
	public static function send_sms( $key, $mobile, array $vars, $test = false ) {
		self::$last_error = '';
		$m      = self::get( $key );
		$mobile = MP_Auth::normalize( $mobile );
		if ( ! $m || ! $mobile ) {
			self::$last_error = 'شماره موبایل معتبر نیست.';
			return false;
		}
		if ( ! $m['on'] && ! $test ) {
			self::$last_error = 'این پیامک در «اعلان‌ها و پیامک‌ها» خاموش است.';
			return false;
		}
		$provider = MP_Auth::provider();
		if ( ! $provider ) {
			self::$last_error = 'سرویس پیامک انتخاب نشده یا کلید API خالی است.';
			return false;
		}
		if ( 'smsir' === $provider && $m['tpl'] ) {
			$params = self::pattern_params( $m, $vars );
			$res    = self::smsir_verify( $mobile, $m['tpl'], $params );
			$shown  = $m['tpl_text'] ? $m['tpl_text'] : self::pattern_text( $m['sms'] );
			foreach ( $params as $p ) {
				$shown = str_replace( '#' . $p['name'] . '#', $p['value'], $shown );
			}
			self::log( $key, $mobile, 'پترن ' . $m['tpl'], $shown, $res, $test );
			if ( true === $res ) {
				return true;
			}
			self::$last_error = $res;
			// A definite refusal (wrong ID, rejected template…) falls back to plain text when a line is set;
			// a network error may still have been delivered, and a test should show the pattern's own error.
			if ( $test || 0 === strpos( $res, 'HTTP' ) || ! get_option( 'mp_smsir_line', '' ) ) {
				return false;
			}
		}
		$text = self::sms_text( $m, $vars );
		$ok   = MP_Auth::text( $mobile, $text, true );
		$res  = $ok ? true : ( MP_Auth::$last_error ? MP_Auth::$last_error : 'ارسال نشد.' );
		self::log( $key, $mobile, 'متن عادی', $text, $res, $test );
		if ( ! $ok ) {
			self::$last_error = trim( ( self::$last_error ? self::$last_error . ' · ' : '' ) . $res );
		}
		return $ok;
	}

	/** @return true|string true when sms.ir accepted it, otherwise the reason. */
	private static function smsir_verify( $mobile, $template, array $params ) {
		$res = wp_remote_post(
			'https://api.sms.ir/v1/send/verify',
			array(
				'timeout' => 10,
				'headers' => array( 'X-API-KEY' => get_option( 'mp_smsir_key' ), 'Content-Type' => 'application/json', 'Accept' => 'text/plain' ),
				'body'    => wp_json_encode( array( 'mobile' => $mobile, 'templateId' => (int) $template, 'parameters' => $params ), JSON_UNESCAPED_UNICODE ),
			)
		);
		if ( is_wp_error( $res ) ) {
			return 'HTTP — ' . $res->get_error_message();
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( isset( $body['status'] ) && 1 === (int) $body['status'] ) {
			return true;
		}
		$msg = isset( $body['message'] ) ? (string) $body['message'] : '';
		return 'sms.ir' . ( isset( $body['status'] ) ? ' (کد ' . (int) $body['status'] . ')' : ' HTTP ' . wp_remote_retrieve_response_code( $res ) ) . ( '' !== $msg ? ': ' . $msg : '' );
	}

	/* ------------------------------------------------------------------ Log */

	private static function log( $key, $mobile, $via, $text, $res, $test ) {
		$log = get_option( self::LOG, array() );
		$log = is_array( $log ) ? $log : array();
		array_unshift(
			$log,
			array(
				't'    => MP_Util::now(),
				'key'  => $key,
				'to'   => substr( $mobile, 0, 4 ) . '***' . substr( $mobile, -4 ),
				'via'  => $via . ( $test ? ' · آزمایشی' : '' ),
				'text' => mb_substr( (string) $text, 0, 400 ),
				'ok'   => true === $res,
				'err'  => true === $res ? '' : mb_substr( (string) $res, 0, 300 ),
			)
		);
		update_option( self::LOG, array_slice( $log, 0, 80 ), false );
	}

	public static function log_rows() {
		$log = get_option( self::LOG, array() );
		return is_array( $log ) ? $log : array();
	}

	/* ------------------------------------------------------------------ Short links */

	/** Code of a short link to $url (the same URL keeps its code). */
	public static function short_code( $url ) {
		global $wpdb;
		$t    = MP_Install::table( 'shortlinks' );
		$hash = md5( $url );
		$code = $wpdb->get_var( $wpdb->prepare( "SELECT code FROM $t WHERE url_hash = %s LIMIT 1", $hash ) ); // phpcs:ignore
		if ( $code ) {
			return $code;
		}
		for ( $i = 0; $i < 5; $i++ ) {
			$code = wp_generate_password( 6, false, false );
			if ( $wpdb->insert( $t, array( 'code' => $code, 'url_hash' => $hash, 'url' => $url, 'created_at' => MP_Util::now() ) ) ) {
				return $code;
			}
		}
		return '';
	}

	public static function short_url( $url ) {
		$code = self::short_code( $url );
		return $code ? self::short_prefix() . $code : $url;
	}

	/** /s/{code} → the full address. */
	public static function redirect( $code ) {
		global $wpdb;
		$url = $wpdb->get_var( $wpdb->prepare( 'SELECT url FROM ' . MP_Install::table( 'shortlinks' ) . ' WHERE code = %s', $code ) ); // phpcs:ignore
		if ( ! $url ) {
			return;
		}
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		wp_redirect( $url, 302 ); // phpcs:ignore WordPress.Security.SafeRedirect -- only addresses the panel itself stored
		exit;
	}

	/* ------------------------------------------------------------------ Samples (settings page) */

	public static function samples() {
		$out = array();
		foreach ( self::VARS as $k => $v ) {
			$out[ $k ] = 'link' === $v[2] ? self::short_prefix() . 'Ab3xY9' : $v[1];
		}
		return array_merge( $out, self::constants() );
	}

	/** Sample values for a test SMS: a real short link to the panel. */
	public static function test_vars() {
		$vars = self::samples();
		foreach ( self::VARS as $k => $v ) {
			if ( 'link' === $v[2] ) {
				$vars[ $k ] = MP_Frontend::panel_url();
			} elseif ( 'const' === $v[2] ) {
				unset( $vars[ $k ] );
			}
		}
		return $vars;
	}
}

<?php
defined( 'ABSPATH' ) || exit;

/** Settings page and a quick way to give people panel access. */
class MP_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_mp_save_settings', array( __CLASS__, 'save_settings' ) );
		add_action( 'admin_post_mp_save_roles', array( __CLASS__, 'save_roles' ) );
		add_action( 'admin_post_mp_add_employee', array( __CLASS__, 'add_employee' ) );
		add_action( 'admin_post_mp_test_sms', array( __CLASS__, 'test_sms' ) );
		// Panel access + mobile right on WordPress's own "Add user" and profile screens.
		foreach ( array( 'user_new_form', 'show_user_profile', 'edit_user_profile' ) as $hook ) {
			add_action( $hook, array( __CLASS__, 'user_fields' ) );
		}
		foreach ( array( 'user_register', 'personal_options_update', 'edit_user_profile_update' ) as $hook ) {
			add_action( $hook, array( __CLASS__, 'save_user_fields' ) );
		}
		add_filter( 'plugin_action_links_' . plugin_basename( MP_FILE ), array( __CLASS__, 'links' ) );
		add_action( 'admin_head', array( __CLASS__, 'admin_font' ) );
	}

	public static function links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=moraba-panel' ) ) . '">تنظیمات</a>' );
		return $links;
	}

	public static function menu() {
		add_menu_page( 'پنل کارمندان مربع', 'پنل مربع', 'manage_options', 'moraba-panel', array( __CLASS__, 'page' ), 'dashicons-calendar-alt', 58 );
		add_submenu_page( 'moraba-panel', 'تنظیمات پنل مربع', 'تنظیمات', 'manage_options', 'moraba-panel', array( __CLASS__, 'page' ) );
		add_submenu_page( 'moraba-panel', 'پیام‌های حذف‌شده', 'پیام‌های حذف‌شده', 'manage_options', 'moraba-panel-deleted', array( __CLASS__, 'deleted_page' ) );
	}

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$users = get_users( array( 'orderby' => 'display_name', 'number' => 500 ) );
		?>
		<div class="wrap" dir="rtl">
			<h1>پنل کارمندان مربع</h1>
			<?php if ( isset( $_GET['updated'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="notice notice-success"><p>ذخیره شد.</p></div>
			<?php endif; ?>
			<?php $mp_notice = get_transient( 'mp_admin_notice_' . get_current_user_id() ); ?>
			<?php if ( $mp_notice ) : ?>
				<?php delete_transient( 'mp_admin_notice_' . get_current_user_id() ); ?>
				<div class="notice notice-<?php echo esc_attr( $mp_notice[0] ); ?>"><p><?php echo esc_html( $mp_notice[1] ); ?></p></div>
			<?php endif; ?>
			<?php if ( ! function_exists( 'mail' ) && ! has_action( 'phpmailer_init' ) ) : ?>
				<div class="notice notice-warning"><p>تابع mail() روی این هاست غیرفعال است؛ پنل ارسال ایمیل را بی‌صدا رد می‌کند تا خطا ندهد. برای ایمیل یک افزونه SMTP نصب کنید، یا از پیامک و تلگرام/بله استفاده کنید.</p></div>
			<?php endif; ?>
			<p>آدرس پنل: <a href="<?php echo esc_url( MP_Frontend::panel_url() ); ?>" target="_blank"><?php echo esc_html( MP_Frontend::panel_url() ); ?></a>
			— یا شورت‌کد <code>[moraba_panel]</code> را در یک برگه قرار دهید.</p>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'mp_save_settings' ); ?>
				<input type="hidden" name="action" value="mp_save_settings">
				<table class="form-table">
					<tr>
						<th><label for="mp_slug">نامک آدرس پنل</label></th>
						<td><code><?php echo esc_html( home_url( '/' ) ); ?></code><input id="mp_slug" name="mp_slug" value="<?php echo esc_attr( MP_Frontend::slug() ); ?>" dir="ltr"></td>
					</tr>
					<tr>
						<th><label for="mp_support">پشتیبانی صفحه ورود</label></th>
						<td><input id="mp_support" name="mp_support" class="regular-text" dir="ltr" placeholder="09121234567 یا support@… یا https://…" value="<?php echo esc_attr( get_option( 'mp_support', '' ) ); ?>">
						<p class="description">لینک «مشکلی در ورود دارید؟ پشتیبانی» زیر فرم ورود. شماره تلفن، ایمیل یا آدرس (مثلاً لینک تلگرام). خالی بگذارید تا نمایش داده نشود.</p></td>
					</tr>
					<tr>
						<th>اعلان ایمیلی</th>
						<td><label><input type="checkbox" name="mp_email_notifications" value="1" <?php checked( get_option( 'mp_email_notifications', '1' ) ); ?>> ارسال ایمیل برای تسک‌های تعیین‌شده، دعوت جلسه و یادآوری‌ها</label></td>
					</tr>
					<tr><th colspan="2"><h2 style="margin:0">کانال‌های اعلان</h2></th></tr>
					<tr>
						<th><label for="mp_telegram_token">توکن ربات تلگرام</label></th>
						<td><input id="mp_telegram_token" name="mp_telegram_token" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_telegram_token', '' ) ); ?>">
						<p class="description">از @BotFather بگیرید. هر کارمند شناسه عددی چت خود را در «تنظیمات حساب» پنل وارد می‌کند و یک بار به ربات پیام می‌دهد. سرور باید به api.telegram.org دسترسی داشته باشد.</p></td>
					</tr>
					<tr>
						<th><label for="mp_bale_token">توکن ربات بله</label></th>
						<td><input id="mp_bale_token" name="mp_bale_token" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_bale_token', '' ) ); ?>">
						<p class="description">از @botfather در بله بگیرید.</p></td>
					</tr>
					<tr><th colspan="2"><h2 style="margin:0">پیامک و ورود با موبایل</h2></th></tr>
					<tr>
						<th>سرویس پیامک</th>
						<td>
							<?php $prov = get_option( 'mp_sms_provider', '' ); ?>
							<label><input type="radio" name="mp_sms_provider" value="" <?php checked( $prov, '' ); ?>> خاموش</label>&nbsp;&nbsp;
							<label><input type="radio" name="mp_sms_provider" value="smsir" <?php checked( $prov, 'smsir' ); ?>> sms.ir</label>&nbsp;&nbsp;
							<label><input type="radio" name="mp_sms_provider" value="kavenegar" <?php checked( $prov, 'kavenegar' ); ?>> کاوه‌نگار</label>
							<p class="description">با روشن بودن پیامک، کارمندان با شماره موبایل و کد یک‌بارمصرف وارد پنل می‌شوند و اعلان‌های مهم (تسک تعیین‌شده، دعوت جلسه، یادآوری، نتیجه مرخصی) هم پیامک می‌شود.</p>
						</td>
					</tr>
					<tr>
						<th>sms.ir</th>
						<td>
							<p><label>کلید API (X-API-KEY)<br><input name="mp_smsir_key" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_smsir_key', '' ) ); ?>"></label></p>
							<p><label>شناسه قالب ارسال سریع (کد ورود)<br><input name="mp_smsir_template" dir="ltr" inputmode="numeric" value="<?php echo esc_attr( get_option( 'mp_smsir_template', '' ) ); ?>"></label>
							&nbsp;<label>نام متغیر قالب<br><input name="mp_smsir_param" dir="ltr" value="<?php echo esc_attr( get_option( 'mp_smsir_param', 'CODE' ) ); ?>"></label></p>
							<p><label>شماره خط (برای پیامک اعلان‌ها)<br><input name="mp_smsir_line" dir="ltr" inputmode="numeric" value="<?php echo esc_attr( get_option( 'mp_smsir_line', '' ) ); ?>"></label></p>
							<p class="description">در پنل sms.ir بخش «ارسال سریع» یک قالب بسازید، مثلاً: <code>کد ورود پنل مربع: #CODE#</code> و شناسه آن را اینجا بگذارید. کلید API را از «برنامه‌نویسان ← لیست کلیدها» بگیرید. اگر قالب نسازید، کد با شماره خط و متن عادی ارسال می‌شود.</p>
						</td>
					</tr>
					<tr>
						<th>کاوه‌نگار</th>
						<td>
							<label>کلید API <input name="mp_sms_key" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_sms_key', '' ) ); ?>"></label><br><br>
							<label>شماره فرستنده <input name="mp_sms_sender" dir="ltr" value="<?php echo esc_attr( get_option( 'mp_sms_sender', '' ) ); ?>"></label>
						</td>
					</tr>
					<tr><th colspan="2"><h2 style="margin:0">تبدیل گفتار و متن (اختیاری)</h2></th></tr>
					<tr>
						<th>سرویس تبدیل گفتار</th>
						<td>
							<p class="description" style="margin-top:0">پیام صوتی در Chrome دسکتاپ هنگام ضبط خودکار به متن تبدیل می‌شود و «خواندن پیام» از صدای فارسی خود دستگاه استفاده می‌کند. برای بقیه موارد (ویس‌های ضبط‌شده با گوشی، دستگاه‌های بدون صدای فارسی) یک سرویس سازگار با OpenAI وارد کنید.</p>
							<p><label>کلید API<br><input name="mp_speech_key" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_speech_key', '' ) ); ?>"></label></p>
							<p><label>آدرس سرویس (خالی = OpenAI)<br><input name="mp_speech_url" class="regular-text" dir="ltr" placeholder="https://api.openai.com/v1" value="<?php echo esc_attr( get_option( 'mp_speech_url', '' ) ); ?>"></label></p>
							<p><label>مدل گفتار به متن <input name="mp_speech_stt_model" dir="ltr" size="14" value="<?php echo esc_attr( get_option( 'mp_speech_stt_model', 'whisper-1' ) ); ?>"></label>
							&nbsp;<label>مدل متن به گفتار <input name="mp_speech_tts_model" dir="ltr" size="10" value="<?php echo esc_attr( get_option( 'mp_speech_tts_model', 'tts-1' ) ); ?>"></label>
							&nbsp;<label>صدا <input name="mp_speech_voice" dir="ltr" size="8" value="<?php echo esc_attr( get_option( 'mp_speech_voice', 'alloy' ) ); ?>"></label></p>
							<p class="description">فایل صوتی و متن پیام برای تبدیل به این سرویس فرستاده می‌شود. هر نفر حداکثر ۶۰ تبدیل در ساعت.</p>
						</td>
					</tr>
					<tr><th colspan="2"><h2 style="margin:0">دستیار هوشمند (هوش مصنوعی)</h2></th></tr>
					<tr>
						<th>سرویس مدل زبانی</th>
						<td>
							<p class="description" style="margin-top:0">دستیار پنل (دکمه میکروفون بالای صفحه) با یک مدل زبانی سازگار با OpenAI و «function calling» کار می‌کند: OpenAI، یا هر سرویس/درگاه سازگار که از سرور سایت در دسترس است. خالی بماند، همان کلید و آدرس «تبدیل گفتار» استفاده می‌شود. بدون کلید، دستیار فقط دستورهای ساده را می‌فهمد.</p>
							<p><label>کلید API<br><input name="mp_ai_key" class="regular-text" dir="ltr" autocomplete="off" value="<?php echo esc_attr( get_option( 'mp_ai_key', '' ) ); ?>"></label></p>
							<p><label>آدرس سرویس (خالی = آدرس تبدیل گفتار یا OpenAI)<br><input name="mp_ai_url" class="regular-text" dir="ltr" placeholder="https://api.openai.com/v1" value="<?php echo esc_attr( get_option( 'mp_ai_url', '' ) ); ?>"></label></p>
							<p><label>مدل <input name="mp_ai_model" dir="ltr" size="22" placeholder="gpt-4.1-mini" value="<?php echo esc_attr( get_option( 'mp_ai_model', '' ) ); ?>"></label></p>
							<p class="description">درخواست کاربر، اطلاعات لازم پنل (نام اعضای تیم، پروژه‌ها و نتیجه ابزارها) برای پاسخ به این سرویس فرستاده می‌شود. هر کار فقط با دسترسی خود همان کاربر انجام می‌شود و تغییرات پیش از انجام تأیید می‌خواهند. هر نفر حداکثر ۹۰ درخواست در ساعت.</p>
						</td>
					</tr>
				</table>
				<?php submit_button( 'ذخیره تنظیمات' ); ?>
			</form>

			<h2 id="mp-sms-test">آزمایش پیامک ورود</h2>
			<?php if ( ! MP_Auth::otp_enabled() ) : ?>
				<div class="notice notice-warning inline"><p>ورود با موبایل هنوز فعال نیست: در بخش «پیامک و ورود با موبایل» بالا، sms.ir را انتخاب کنید، کلید API و شناسه قالب را وارد و ذخیره کنید.</p></div>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'mp_test_sms' ); ?>
				<input type="hidden" name="action" value="mp_test_sms">
				<p>یک کد آزمایشی به این شماره فرستاده می‌شود: <input name="mobile" dir="ltr" inputmode="tel" placeholder="09121234567" value="<?php echo esc_attr( get_user_meta( get_current_user_id(), 'mp_phone', true ) ); ?>">
				<?php submit_button( 'ارسال پیامک آزمایشی', 'secondary', 'submit', false ); ?></p>
			</form>

			<h2 id="mp-add">افزودن کارمند</h2>
			<p>کارمند با همین شماره موبایل و کد پیامکی وارد پنل می‌شود؛ ایمیل لازم نیست و ایمیلی هم ارسال نمی‌شود.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'mp_add_employee' ); ?>
				<input type="hidden" name="action" value="mp_add_employee">
				<table class="form-table">
					<tr><th><label for="mp_e_name">نام و نام خانوادگی</label></th><td><input id="mp_e_name" name="name" class="regular-text" required></td></tr>
					<tr><th><label for="mp_e_mobile">شماره موبایل</label></th><td><input id="mp_e_mobile" name="mobile" dir="ltr" inputmode="tel" placeholder="09121234567" required></td></tr>
					<tr><th><label for="mp_e_title">سمت</label></th><td><input id="mp_e_title" name="title" class="regular-text" placeholder="مثلاً طراح گرافیک"></td></tr>
					<tr><th><label for="mp_e_role">دسترسی</label></th><td><?php self::role_boxes( null, 'roles' ); ?></td></tr>
					<tr><th><label for="mp_e_email">ایمیل (اختیاری)</label></th><td><input id="mp_e_email" name="email" type="email" dir="ltr" class="regular-text"></td></tr>
				</table>
				<?php submit_button( 'افزودن کارمند', 'primary', 'submit', false ); ?>
			</form>

			<h2>دسترسی به پنل</h2>
			<p><strong>کارمند</strong> تقویم و تسک‌های خودش را می‌بیند و تسک شخصی اضافه می‌کند؛ تسک‌هایی که ناظر تعیین کرده برای او قفل است.
			<strong>ناظر</strong> برای هر کارمند تسک تعیین می‌کند و پروژه‌ها، اعضا و بخش‌ها را مدیریت می‌کند. مدیران کل سایت به‌صورت خودکار ناظر پنل هستند.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'mp_save_roles' ); ?>
				<input type="hidden" name="action" value="mp_save_roles">
				<table class="widefat striped" style="max-width:900px">
					<thead><tr><th>کاربر</th><th>موبایل (ورود)</th><th>ایمیل</th><th>نقش در پنل (هر دو را می‌توان داد)</th></tr></thead>
					<tbody>
					<?php foreach ( $users as $u ) : ?>
						<?php $admin = user_can( $u, 'manage_options' ); ?>
						<tr>
							<td><?php echo esc_html( $u->display_name ); ?></td>
							<td><input name="mp_phone[<?php echo (int) $u->ID; ?>]" dir="ltr" inputmode="tel" size="13" placeholder="09…" value="<?php echo esc_attr( get_user_meta( $u->ID, 'mp_phone', true ) ); ?>"></td>
							<td dir="ltr"><?php echo esc_html( $u->user_email ); ?></td>
							<td><?php self::role_boxes( $u, 'mp_role[' . (int) $u->ID . ']' ); ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<?php submit_button( 'ذخیره دسترسی‌ها' ); ?>
			</form>
			<hr style="margin:32px 0">
			<?php MP_Backup::section(); ?>
		</div>
		<?php
	}

	public static function save_settings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( 'mp_save_settings' );
		$slug = isset( $_POST['mp_slug'] ) ? sanitize_title( wp_unslash( $_POST['mp_slug'] ) ) : 'panel';
		update_option( 'mp_slug', $slug ? $slug : 'panel' );
		update_option( 'mp_email_notifications', empty( $_POST['mp_email_notifications'] ) ? '' : '1' );
		foreach ( array( 'mp_support', 'mp_telegram_token', 'mp_bale_token', 'mp_sms_key', 'mp_sms_sender', 'mp_smsir_key', 'mp_smsir_param', 'mp_speech_key', 'mp_speech_url', 'mp_speech_stt_model', 'mp_speech_tts_model', 'mp_speech_voice', 'mp_ai_key', 'mp_ai_url', 'mp_ai_model' ) as $key ) {
			update_option( $key, isset( $_POST[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) ) : '' );
		}
		foreach ( array( 'mp_smsir_template', 'mp_smsir_line' ) as $key ) {
			update_option( $key, isset( $_POST[ $key ] ) ? preg_replace( '/\D/', '', J_latin( wp_unslash( $_POST[ $key ] ) ) ) : '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		}
		$prov = isset( $_POST['mp_sms_provider'] ) ? sanitize_key( wp_unslash( $_POST['mp_sms_provider'] ) ) : '';
		update_option( 'mp_sms_provider', in_array( $prov, array( 'smsir', 'kavenegar' ), true ) ? $prov : '' );
		MP_Frontend::add_rewrite();
		flush_rewrite_rules();
		wp_safe_redirect( admin_url( 'admin.php?page=moraba-panel&updated=1' ) );
		exit;
	}

	public static function save_roles() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( 'mp_save_roles' );
		$roles  = isset( $_POST['mp_role'] ) && is_array( $_POST['mp_role'] ) ? wp_unslash( $_POST['mp_role'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$phones = isset( $_POST['mp_phone'] ) && is_array( $_POST['mp_phone'] ) ? wp_unslash( $_POST['mp_phone'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$bad    = array();
		foreach ( $phones as $id => $raw ) {
			$id   = (int) $id;
			$raw  = trim( (string) $raw );
			$norm = MP_Auth::normalize( $raw );
			if ( ! get_userdata( $id ) || $norm === (string) get_user_meta( $id, 'mp_phone', true ) && '' !== $raw ) {
				continue;
			}
			if ( '' !== $raw && ( ! $norm || MP_Auth::mobile_taken( $norm, $id ) ) ) {
				$bad[] = get_userdata( $id )->display_name;
				continue;
			}
			update_user_meta( $id, 'mp_phone', $norm );
		}
		if ( $bad ) {
			self::notice( 'error', 'شماره این افراد ذخیره نشد (نامعتبر یا تکراری): ' . implode( '، ', $bad ) );
		}
		foreach ( $roles as $id => $set ) {
			$u = get_userdata( (int) $id );
			if ( $u ) {
				self::apply_roles( $u, (array) $set );
			}
		}
		wp_safe_redirect( admin_url( 'admin.php?page=moraba-panel&updated=1' ) );
		exit;
	}

	private static function notice( $type, $text ) {
		set_transient( 'mp_admin_notice_' . get_current_user_id(), array( $type, $text ), 120 );
	}

	/** Creates a panel user from name + mobile. No WordPress "new user" email is sent. */
	public static function add_employee() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( 'mp_add_employee' );
		$back   = admin_url( 'admin.php?page=moraba-panel#mp-add' );
		$name   = isset( $_POST['name'] ) ? MP_Util::text( wp_unslash( $_POST['name'] ), 80 ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$mobile = isset( $_POST['mobile'] ) ? MP_Auth::normalize( wp_unslash( $_POST['mobile'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$title  = isset( $_POST['title'] ) ? MP_Util::text( wp_unslash( $_POST['title'] ), 80 ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$email  = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$set    = isset( $_POST['roles'] ) ? array_map( 'sanitize_key', (array) wp_unslash( $_POST['roles'] ) ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$roles  = array();
		foreach ( array( 'employee', 'manager' ) as $k ) {
			if ( in_array( $k, $set, true ) ) {
				$roles[] = 'moraba_' . $k;
			}
		}
		$result = self::create_employee( $name, $mobile, $title, $email, $roles ? $roles : array( 'moraba_employee' ) );
		if ( is_wp_error( $result ) ) {
			self::notice( 'error', $result->get_error_message() );
		} else {
			self::notice( 'success', $name . ' اضافه شد. حالا می‌تواند با شماره ' . $mobile . ' وارد پنل شود.' );
		}
		wp_safe_redirect( $back );
		exit;
	}

	/** @return int|WP_Error */
	public static function create_employee( $name, $mobile, $title = '', $email = '', $roles = array( 'moraba_employee' ) ) {
		$roles = (array) $roles;
		if ( '' === $name ) {
			return new WP_Error( 'mp', 'نام را وارد کنید.' );
		}
		if ( ! $mobile ) {
			return new WP_Error( 'mp', 'شماره موبایل معتبر نیست. نمونه: 09121234567' );
		}
		if ( MP_Auth::mobile_taken( $mobile ) ) {
			return new WP_Error( 'mp', 'این شماره برای کاربر دیگری ثبت شده است.' );
		}
		if ( $email && email_exists( $email ) ) {
			return new WP_Error( 'mp', 'این ایمیل برای کاربر دیگری ثبت شده است.' );
		}
		$login = 'mp' . $mobile;
		for ( $i = 2; username_exists( $login ); $i++ ) {
			$login = 'mp' . $mobile . '_' . $i;
		}
		$uid = wp_insert_user(
			array(
				'user_login'   => $login,
				'user_pass'    => wp_generate_password( 24 ),
				'user_email'   => $email,
				'display_name' => $name,
				'nickname'     => $name,
				'first_name'   => $name,
				'role'         => $roles[0],
			)
		);
		if ( is_wp_error( $uid ) ) {
			return $uid;
		}
		update_user_meta( $uid, 'mp_phone', $mobile );
		foreach ( array_slice( $roles, 1 ) as $extra ) {
			( new WP_User( $uid ) )->add_role( $extra );
		}
		if ( $title ) {
			update_user_meta( $uid, 'mp_job_title', $title );
		}
		MP_Audit::log( 'create', 'user', $uid, 'افزودن کارمند ' . $name );
		return $uid;
	}

	/**
	 * Two independent checkboxes: employee (gets tasks, locked when a supervisor assigns them) and
	 * supervisor (assigns tasks, sees the team). A hidden "none" keeps an all-unchecked row in the POST.
	 */
	public static function role_boxes( $u, $name ) {
		$admin = $u && user_can( $u, 'manage_options' );
		$emp   = $u ? in_array( 'moraba_employee', (array) $u->roles, true ) : true;
		$sup   = $admin || ( $u && in_array( 'moraba_manager', (array) $u->roles, true ) );
		?>
		<input type="hidden" name="<?php echo esc_attr( $name ); ?>[]" value="none">
		<label style="margin-inline-end:14px"><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[]" value="employee" <?php checked( $emp ); ?>> کارمند</label>
		<label><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[]" value="manager" <?php checked( $sup ); ?> <?php disabled( $admin ); ?>> ناظر<?php echo $admin ? ' (مدیر کل سایت)' : ''; ?></label>
		<?php
	}

	/** @param string[] $set subset of employee, manager. Site admins always stay supervisors. */
	public static function apply_roles( WP_User $u, array $set ) {
		foreach ( array( 'employee', 'manager' ) as $k ) {
			$on = in_array( $k, $set, true );
			if ( 'manager' === $k && user_can( $u, 'manage_options' ) ) {
				continue;
			}
			if ( $on && ! in_array( 'moraba_' . $k, (array) $u->roles, true ) ) {
				$u->add_role( 'moraba_' . $k );
			} elseif ( ! $on ) {
				$u->remove_role( 'moraba_' . $k );
			}
		}
	}

	public static function user_fields( $user ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$u = $user instanceof WP_User ? $user : null;
		wp_nonce_field( 'mp_user_fields', 'mp_user_fields_nonce' );
		?>
		<div class="mp-user-fields">
		<h2>پنل کارمندان مربع</h2>
		<table class="form-table" role="presentation">
			<tr>
				<th>نقش در پنل</th>
				<td><?php self::role_boxes( $u, 'mp_level' ); ?><p class="description">کارمند: تقویم و تسک‌های خودش؛ تسک‌هایی که ناظر تعیین کند برایش قفل است. ناظر: برای دیگران تسک تعیین می‌کند و تیم را می‌بیند. هر دو را می‌توان هم‌زمان داد.</p></td>
			</tr>
			<tr>
				<th><label for="mp_mobile">موبایل (ورود با پیامک)</label></th>
				<td><input name="mp_mobile" id="mp_mobile" dir="ltr" inputmode="tel" placeholder="09121234567" value="<?php echo esc_attr( $u ? get_user_meta( $u->ID, 'mp_phone', true ) : '' ); ?>"></td>
			</tr>
		</table>
		</div>
		<?php
	}

	public static function save_user_fields( $user_id ) {
		if ( ! current_user_can( 'manage_options' ) || empty( $_POST['mp_user_fields_nonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['mp_user_fields_nonce'] ), 'mp_user_fields' ) ) {
			return;
		}
		$u = get_userdata( $user_id );
		if ( ! $u ) {
			return;
		}
		if ( isset( $_POST['mp_level'] ) ) {
			self::apply_roles( $u, array_map( 'sanitize_key', (array) wp_unslash( $_POST['mp_level'] ) ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		}
		if ( isset( $_POST['mp_mobile'] ) ) {
			$raw  = trim( sanitize_text_field( wp_unslash( $_POST['mp_mobile'] ) ) );
			$norm = MP_Auth::normalize( $raw );
			if ( '' === $raw || ( $norm && ! MP_Auth::mobile_taken( $norm, $user_id ) ) ) {
				update_user_meta( $user_id, 'mp_phone', $norm );
			}
		}
	}

	public static function test_sms() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( 'mp_test_sms' );
		$mobile = isset( $_POST['mobile'] ) ? MP_Auth::normalize( wp_unslash( $_POST['mobile'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( ! $mobile ) {
			self::notice( 'error', 'شماره موبایل معتبر نیست.' );
		} elseif ( MP_Auth::send_code( $mobile, (string) wp_rand( 10000, 99999 ) ) ) {
			self::notice( 'success', 'پیامک آزمایشی به ' . $mobile . ' ارسال شد. اگر رسید، ورود با موبایل آماده است.' );
		} else {
			self::notice( 'error', 'ارسال نشد: ' . MP_Auth::$last_error );
		}
		wp_safe_redirect( admin_url( 'admin.php?page=moraba-panel#mp-sms-test' ) );
		exit;
	}

	/** The panel's font (Dana) on its settings page and on the panel fields of user profile screens. */
	public static function admin_font() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen ) {
			return;
		}
		$ours    = false !== strpos( (string) $screen->id, 'moraba-panel' );
		$profile = in_array( $screen->id, array( 'user', 'user-edit', 'profile' ), true );
		if ( ! $ours && ! $profile ) {
			return;
		}
		$url = esc_url( MP_URL . 'assets/fonts/dana.woff2?ver=' . MP_VERSION );
		echo "<style>@font-face{font-family:Dana;src:url('$url') format('woff2');font-weight:10 990;font-display:swap}"; // phpcs:ignore WordPress.Security.EscapeOutput
		echo $ours ? '.wrap,.wrap h1,.wrap h2,.wrap h3,.wrap input,.wrap select,.wrap textarea,.wrap button,.wrap .button,.wrap .notice,.wrap code{font-family:Dana,Tahoma,sans-serif!important}' : '.mp-user-fields,.mp-user-fields *{font-family:Dana,Tahoma,sans-serif!important}';
		echo '</style>';
	}

	/** Messages people deleted in the panel: hidden there, kept here for the site admin. */
	public static function deleted_page() {
		global $wpdb;
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$m     = MP_Install::table( 'messages' );
		$c     = MP_Install::table( 'channels' );
		$page  = max( 1, isset( $_GET['paged'] ) ? (int) $_GET['paged'] : 1 ); // phpcs:ignore WordPress.Security.NonceVerification
		$per   = 50;
		$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM $m WHERE deleted_at IS NOT NULL" ); // phpcs:ignore
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT m.*, c.type AS ch_type, c.title AS ch_title, c.user_a, c.user_b, c.client_name FROM $m m LEFT JOIN $c c ON c.id = m.channel_id WHERE m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC LIMIT %d OFFSET %d", $per, ( $page - 1 ) * $per ) ); // phpcs:ignore
		$name  = function ( $id ) {
			$u = $id ? get_userdata( $id ) : null;
			return $u ? $u->display_name : '—';
		};
		$when  = function ( $dt ) {
			return MP_Jalali::format( substr( $dt, 0, 10 ) ) . ' ' . MP_Jalali::digits( substr( $dt, 11, 5 ) );
		};
		?>
		<div class="wrap" dir="rtl">
			<h1>پیام‌های حذف‌شده</h1>
			<p>پیام‌هایی که کارمندان در چت پنل حذف کرده‌اند. در پنل برای همه «این پیام حذف شد» نمایش داده می‌شود؛ متن و فایل اصلی فقط اینجا برای مدیر کل سایت می‌ماند.</p>
			<table class="widefat striped">
				<thead><tr><th>زمان حذف</th><th>ارسال‌کننده</th><th>گفت‌وگو</th><th>زمان ارسال</th><th>محتوا</th></tr></thead>
				<tbody>
				<?php if ( ! $rows ) : ?>
					<tr><td colspan="5">پیام حذف‌شده‌ای نیست.</td></tr>
				<?php endif; ?>
				<?php foreach ( $rows as $r ) : ?>
					<?php
					if ( 'direct' === $r->ch_type ) {
						$chat = 'خصوصی: ' . $name( $r->user_a ) . ' و ' . $name( $r->user_b );
					} elseif ( 'client' === $r->ch_type ) {
						$chat = 'گروه مشتری: ' . $r->client_name;
					} else {
						$chat = 'گروه: ' . $r->ch_title;
					}
					$file = $r->file_id ? MP_Files::get( $r->file_id ) : null;
					?>
					<tr>
						<td><?php echo esc_html( $when( $r->deleted_at ) ); ?></td>
						<td><?php echo esc_html( $r->user_id ? $name( $r->user_id ) : $r->guest_name ); ?></td>
						<td><?php echo esc_html( $chat ); ?></td>
						<td><?php echo esc_html( $when( $r->created_at ) ); ?></td>
						<td style="max-width:420px">
							<?php if ( '' !== trim( $r->body ) ) : ?>
								<div style="white-space:pre-wrap"><?php echo esc_html( $r->body ); ?></div>
							<?php endif; ?>
							<?php if ( $file && 0 === strpos( $file->mime, 'audio/' ) ) : ?>
								<audio controls preload="none" src="<?php echo esc_url( MP_Files::url( $file->id ) ); ?>" style="height:34px;max-width:100%"></audio>
								<?php if ( $r->transcript ) : ?><div class="description">متن ویس: <?php echo esc_html( $r->transcript ); ?></div><?php endif; ?>
							<?php elseif ( $file ) : ?>
								<a href="<?php echo esc_url( MP_Files::url( $file->id ) ); ?>" target="_blank" rel="noopener"><span class="dashicons dashicons-paperclip" aria-hidden="true"></span> <?php echo esc_html( $file->name ); ?></a>
							<?php endif; ?>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
			<?php if ( $total > $per ) : ?>
				<p><?php echo paginate_links( array( 'base' => add_query_arg( 'paged', '%#%' ), 'format' => '', 'current' => $page, 'total' => (int) ceil( $total / $per ) ) ); // phpcs:ignore ?></p>
			<?php endif; ?>
		</div>
		<?php
	}
}

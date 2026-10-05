<?php
defined( 'ABSPATH' ) || exit;

/**
 * Dashboard page «اعلان‌ها و پیامک‌ها»: every notification and SMS with its text and variables,
 * on/off, when a notification is also an SMS, the sms.ir pattern built from the text, its ID and a test send.
 */
class MP_Messages_Admin {

	const SLUG = 'moraba-panel-messages';

	public static function init() {
		add_action( 'admin_post_mp_save_messages', array( __CLASS__, 'save' ) );
	}

	public static function url( $anchor = '' ) {
		return admin_url( 'admin.php?page=' . self::SLUG ) . ( $anchor ? '#' . $anchor : '' );
	}

	private static function notice( $type, $text ) {
		set_transient( 'mp_admin_notice_' . get_current_user_id(), array( $type, $text ), 60 );
	}

	/* ------------------------------------------------------------------ Save */

	public static function save() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'دسترسی ندارید.' );
		}
		check_admin_referer( 'mp_save_messages' );
		$post  = isset( $_POST['msg'] ) && is_array( $_POST['msg'] ) ? wp_unslash( $_POST['msg'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$reset = isset( $_POST['mp_reset'] ) ? sanitize_key( wp_unslash( $_POST['mp_reset'] ) ) : '';
		$test  = isset( $_POST['mp_test'] ) ? sanitize_key( wp_unslash( $_POST['mp_test'] ) ) : '';
		$old   = MP_Messages::saved();
		$out   = array();
		foreach ( MP_Messages::catalog() as $key => $def ) {
			$p    = isset( $post[ $key ] ) && is_array( $post[ $key ] ) ? $post[ $key ] : array();
			$prev = isset( $old[ $key ] ) && is_array( $old[ $key ] ) ? $old[ $key ] : array();
			$row  = array();
			if ( $key !== $reset ) {
				if ( empty( $def['locked'] ) && empty( $p['on'] ) ) {
					$row['on'] = 0;
				}
				foreach ( array( 'title', 'detail', 'sms' ) as $f ) {
					if ( ! isset( $p[ $f ] ) || ( 'sms' !== $f && 'notify' !== $def['kind'] ) ) {
						continue;
					}
					$v = 'sms' === $f ? sanitize_textarea_field( (string) $p[ $f ] ) : sanitize_text_field( (string) $p[ $f ] );
					$v = trim( mb_substr( $v, 0, 'sms' === $f ? 600 : 250 ) );
					if ( '' !== $v && $v !== $def[ $f ] ) {
						$row[ $f ] = $v;
					}
				}
				if ( 'notify' === $def['kind'] && isset( $p['mode'] ) && in_array( $p['mode'], array( 'on', 'off' ), true ) ) {
					$row['mode'] = $p['mode'];
				}
			}
			// Pattern ID: a new ID takes a snapshot of the pattern text it was registered with.
			$tpl      = isset( $p['tpl'] ) ? (int) preg_replace( '/\D/', '', J_latin( (string) $p['tpl'] ) ) : 0;
			$old_tpl  = 'otp' === $key ? (int) get_option( 'mp_smsir_template', 0 ) : ( isset( $prev['tpl'] ) ? (int) $prev['tpl'] : 0 );
			$sms_text = isset( $row['sms'] ) ? $row['sms'] : $def['sms'];
			if ( $tpl ) {
				$row['tpl']      = $tpl;
				$row['tpl_text'] = $tpl === $old_tpl && isset( $prev['tpl_text'] ) ? (string) $prev['tpl_text'] : ( $tpl === $old_tpl && 'otp' === $key ? '' : MP_Messages::pattern_text( $sms_text ) );
				if ( '' === $row['tpl_text'] ) {
					unset( $row['tpl_text'] );
				}
			}
			if ( 'otp' === $key ) {
				update_option( 'mp_smsir_template', $tpl ? (string) $tpl : '' );
				unset( $row['tpl'] );
			}
			if ( $row ) {
				$out[ $key ] = $row;
			}
		}
		update_option( MP_Messages::OPTION, $out, false );

		$phone = isset( $_POST['test_phone'] ) ? MP_Auth::normalize( wp_unslash( $_POST['test_phone'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( $phone ) {
			update_user_meta( get_current_user_id(), 'mp_sms_test_phone', $phone );
		}
		$anchor = '';
		if ( $test && isset( MP_Messages::catalog()[ $test ] ) ) {
			$anchor = 'msg-' . $test;
			$label  = MP_Messages::catalog()[ $test ]['label'];
			if ( ! $phone ) {
				self::notice( 'error', 'برای ارسال آزمایشی، شماره موبایل بالای صفحه را وارد کنید.' );
			} elseif ( MP_Messages::send_sms( $test, $phone, MP_Messages::test_vars(), true ) ) {
				$log = MP_Messages::log_rows();
				self::notice( 'success', 'پیامک آزمایشی «' . $label . '» به ' . $phone . ' ارسال شد (' . ( $log ? $log[0]['via'] : '' ) . '). تغییرات هم ذخیره شد.' );
			} else {
				self::notice( 'error', 'پیامک آزمایشی «' . $label . '» ارسال نشد: ' . MP_Messages::$last_error );
			}
		} elseif ( $reset && isset( MP_Messages::catalog()[ $reset ] ) ) {
			$anchor = 'msg-' . $reset;
			self::notice( 'success', 'متن «' . MP_Messages::catalog()[ $reset ]['label'] . '» به پیش‌فرض برگشت.' );
		} else {
			self::notice( 'success', 'ذخیره شد.' );
		}
		wp_safe_redirect( self::url( $anchor ) );
		exit;
	}

	/* ------------------------------------------------------------------ Page */

	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$prov     = MP_Auth::provider();
		$line     = get_option( 'mp_smsir_line', '' );
		$smsir    = 'smsir' === $prov;
		$all      = array();
		$with_tpl = 0;
		$sms_able = 0;
		foreach ( array_keys( MP_Messages::catalog() ) as $key ) {
			$m           = MP_Messages::get( $key );
			$all[ $key ] = $m;
			++$sms_able;
			if ( $m['tpl'] ) {
				++$with_tpl;
			}
		}
		$phone = (string) get_user_meta( get_current_user_id(), 'mp_sms_test_phone', true );
		if ( '' === $phone ) {
			$phone = (string) get_user_meta( get_current_user_id(), 'mp_phone', true );
		}
		$notice = get_transient( 'mp_admin_notice_' . get_current_user_id() );
		$data   = array(
			'samples' => MP_Messages::samples(),
			'consts'  => MP_Messages::constants(),
			'prefix'  => MP_Messages::short_prefix(),
			'links'   => array_keys( array_filter( MP_Messages::VARS, function ( $v ) { return 'link' === $v[2]; } ) ),
			'max'     => MP_Messages::MAX_PARAM,
			'smsir'   => $smsir,
		);
		self::styles();
		?>
		<div class="wrap mp-msg" dir="rtl">
			<h1>اعلان‌ها و پیامک‌ها</h1>
			<?php if ( $notice ) : ?>
				<?php delete_transient( 'mp_admin_notice_' . get_current_user_id() ); ?>
				<div class="notice notice-<?php echo esc_attr( $notice[0] ); ?> is-dismissible"><p><?php echo esc_html( $notice[1] ); ?></p></div>
			<?php endif; ?>
			<p class="mp-lead">همه اعلان‌های پنل و همه پیامک‌هایی که افزونه می‌فرستد، اینجاست. متن‌ها را تغییر دهید، هر کدام را خاموش کنید، تعیین کنید کدام اعلان پیامک هم بشود و برای sms.ir پترن بسازید.</p>

			<div class="mp-status">
				<div class="mp-stat">
					<span class="mp-stat-k">سرویس پیامک</span>
					<strong><?php echo esc_html( $smsir ? 'sms.ir' : ( 'kavenegar' === $prov ? 'کاوه‌نگار' : 'خاموش' ) ); ?></strong>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=moraba-panel' ) ); ?>">تنظیم کلید و خط</a>
				</div>
				<div class="mp-stat">
					<span class="mp-stat-k">شماره خط (متن عادی)</span>
					<strong dir="ltr"><?php echo esc_html( $line ? $line : '—' ); ?></strong>
					<span class="mp-stat-d"><?php echo $line ? 'پیامک‌های بدون پترن از این خط می‌روند' : 'بدون خط، فقط پیامک‌های دارای پترن ارسال می‌شوند'; ?></span>
				</div>
				<div class="mp-stat">
					<span class="mp-stat-k">پترن‌های ثبت‌شده</span>
					<strong><?php echo esc_html( MP_Jalali::digits( $with_tpl ) . ' از ' . MP_Jalali::digits( $sms_able ) ); ?></strong>
					<span class="mp-stat-d">پیامک با پترن از خط خدماتی و بدون محدودیت تبلیغاتی می‌رود</span>
				</div>
			</div>
			<?php if ( 'kavenegar' === $prov ) : ?>
				<div class="notice notice-info inline"><p>ارسال با پترن فقط برای sms.ir است؛ با کاوه‌نگار همه پیامک‌ها با متن عادی همین صفحه ارسال می‌شوند.</p></div>
			<?php endif; ?>

			<details class="mp-help" <?php echo $with_tpl ? '' : 'open'; ?>>
				<summary>پترن چیست و چطور در sms.ir ثبت کنم؟</summary>
				<ol>
					<li>برای هر پیامک، «متن پترن» به‌صورت خودکار از متن همان پیامک ساخته می‌شود؛ متغیرها به شکل <code>#NAME#</code> هستند و نام سایت، آدرس پنل و ابتدای لینک‌ها مستقیم داخل متن نوشته می‌شوند.</li>
					<li>دکمه «کپی پترن» را بزنید (یا همه را یکجا از پایین صفحه بردارید).</li>
					<li>در پنل sms.ir: <b>برنامه‌نویسان ← ارسال سریع (قالب‌ها) ← افزودن قالب</b>؛ متن را بچسبانید و ذخیره کنید.</li>
					<li>بعد از تأیید کارشناس sms.ir، «شناسه قالب» را در کادر «شناسه پترن» همان پیام بگذارید و «ذخیره و ارسال آزمایشی» را بزنید.</li>
				</ol>
				<p class="description">چرا ثبت پترن کاملاً خودکار نیست؟ وب‌سرویس sms.ir روشی برای ساختن قالب ندارد و هر قالب را کارشناس آن‌ها دستی بررسی و تأیید می‌کند؛ برای همین افزونه متن دقیق و آماده را می‌سازد و شما فقط آن را می‌چسبانید.
				مقدار هر متغیر در پترن حداکثر <?php echo esc_html( MP_Jalali::digits( MP_Messages::MAX_PARAM ) ); ?> نویسه است: مقدارهای بلندتر (مثلاً عنوان طولانی تسک) کوتاه می‌شوند و لینک‌ها به لینک کوتاه <code dir="ltr"><?php echo esc_html( MP_Messages::short_prefix() ); ?>…</code> تبدیل می‌شوند.
				اگر پترنی رد شود یا شناسه اشتباه باشد و شماره خط داشته باشید، پیامک با متن عادی ارسال می‌شود.</p>
			</details>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="mp-msg-form">
				<?php wp_nonce_field( 'mp_save_messages' ); ?>
				<input type="hidden" name="action" value="mp_save_messages">
				<div class="mp-aud-tabs" role="tablist" aria-label="گیرنده">
					<?php
					$counts = array( '' => count( $all ) );
					foreach ( $all as $m ) {
						$a            = MP_Messages::GROUPS[ $m['group'] ][1];
						$counts[ $a ] = ( isset( $counts[ $a ] ) ? $counts[ $a ] : 0 ) + 1;
					}
					foreach ( array( '' => 'همه' ) + array_map( function ( $x ) { return $x[0]; }, MP_Messages::AUDIENCES ) as $ak => $alabel ) :
						?>
						<button type="button" role="tab" class="mp-aud-tab mp-aud-<?php echo esc_attr( $ak ? $ak : 'all' ); ?>" data-aud="<?php echo esc_attr( $ak ); ?>" aria-selected="<?php echo '' === $ak ? 'true' : 'false'; ?>"><?php echo esc_html( $alabel ); ?> <span><?php echo esc_html( MP_Jalali::digits( isset( $counts[ $ak ] ) ? $counts[ $ak ] : 0 ) ); ?></span></button>
					<?php endforeach; ?>
				</div>
				<div class="mp-bar">
					<input type="search" id="mp-q" placeholder="جست‌وجو در اعلان‌ها و پیامک‌ها…" aria-label="جست‌وجو">
					<select id="mp-filter" aria-label="نمایش">
						<option value="">همه</option>
						<option value="notify">فقط اعلان‌های تیم</option>
						<option value="sms">فقط پیامک‌های مستقیم</option>
						<option value="smson">اعلان‌هایی که پیامک می‌شوند</option>
						<option value="notpl">پیامک‌های بدون پترن</option>
						<option value="custom">تغییر داده‌شده</option>
						<option value="off">خاموش</option>
					</select>
					<label class="mp-tp">موبایل آزمایش <input name="test_phone" dir="ltr" inputmode="tel" placeholder="09121234567" value="<?php echo esc_attr( $phone ); ?>"></label>
					<button type="submit" class="button button-primary">ذخیره همه</button>
				</div>

				<?php foreach ( MP_Messages::AUDIENCES as $ak => $aud ) : ?>
					<div class="mp-aud mp-aud-<?php echo esc_attr( $ak ); ?>" data-aud="<?php echo esc_attr( $ak ); ?>">
						<div class="mp-aud-head">
							<span class="dashicons <?php echo esc_attr( 'staff' === $ak ? 'dashicons-groups' : ( 'client' === $ak ? 'dashicons-businessperson' : 'dashicons-lock' ) ); ?>" aria-hidden="true"></span>
							<div><h2><?php echo esc_html( $aud[0] ); ?></h2><p><?php echo esc_html( $aud[1] ); ?></p></div>
						</div>
						<?php foreach ( MP_Messages::GROUPS as $gk => $g ) : ?>
							<?php
							if ( $g[1] !== $ak ) {
								continue;
							}
							?>
							<section class="mp-group" data-group="<?php echo esc_attr( $gk ); ?>">
								<h3 class="mp-group-title"><?php echo esc_html( $g[0] ); ?></h3>
								<?php
								foreach ( $all as $key => $m ) {
									if ( $m['group'] === $gk ) {
										self::card( $m, $smsir, $ak );
									}
								}
								?>
							</section>
						<?php endforeach; ?>
					</div>
				<?php endforeach; ?>

				<section class="mp-group">
					<h2>همه پترن‌ها یکجا</h2>
					<p class="description">متن پترن همه پیامک‌ها (بر اساس متن‌های فعلی صفحه). هر بخش را جداگانه در sms.ir ثبت کنید.</p>
					<textarea id="mp-all-patterns" class="large-text code" rows="12" readonly dir="rtl"></textarea>
					<p><button type="button" class="button" data-copy="#mp-all-patterns">کپی همه</button></p>
				</section>
				<?php submit_button( 'ذخیره همه' ); ?>
			</form>

			<h2 id="mp-log">آخرین پیامک‌ها</h2>
			<?php $log = MP_Messages::log_rows(); ?>
			<table class="widefat striped mp-log">
				<thead><tr><th>زمان</th><th>پیام</th><th>گیرنده</th><th>روش</th><th>متن</th><th>نتیجه</th></tr></thead>
				<tbody>
				<?php if ( ! $log ) : ?>
					<tr><td colspan="6">هنوز پیامکی از این نسخه به بعد ارسال نشده.</td></tr>
				<?php endif; ?>
				<?php foreach ( array_slice( $log, 0, 50 ) as $r ) : ?>
					<tr>
						<td><?php echo esc_html( MP_Jalali::format( substr( $r['t'], 0, 10 ) ) . ' ' . MP_Jalali::digits( substr( $r['t'], 11, 5 ) ) ); ?></td>
						<td><?php echo esc_html( isset( MP_Messages::catalog()[ $r['key'] ] ) ? MP_Messages::catalog()[ $r['key'] ]['label'] : $r['key'] ); ?></td>
						<td dir="ltr"><?php echo esc_html( $r['to'] ); ?></td>
						<td><?php echo esc_html( $r['via'] ); ?></td>
						<td class="mp-log-text"><?php echo esc_html( $r['text'] ); ?></td>
						<td><?php echo $r['ok'] ? '<span class="mp-ok">ارسال شد</span>' : '<span class="mp-bad">' . esc_html( $r['err'] ) . '</span>'; ?></td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<script>window.MP_MSG = <?php echo wp_json_encode( $data, JSON_UNESCAPED_UNICODE ); ?>;</script>
		<?php
		self::script();
	}

	private static function card( $m, $smsir, $aud = '' ) {
		$key    = $m['key'];
		$name   = 'msg[' . $key . ']';
		$notify = 'notify' === $m['kind'];
		$vars   = array_merge( $m['vars'], array( 'SITE', 'STUDIO', 'PANEL' ) );
		$sms_on = $notify ? ( ! empty( $m['sms_fixed'] ) ? 'fixed' : ( 'on' === $m['mode'] ? 'on' : ( 'off' === $m['mode'] ? 'off' : ( $m['important'] ? 'auto' : 'off' ) ) ) ) : 'on';
		$search = $m['label'] . ' ' . $m['to'] . ' ' . $m['title'] . ' ' . $m['detail'] . ' ' . $m['sms'];
		?>
		<details class="mp-card" data-aud="<?php echo esc_attr( $aud ); ?>" id="msg-<?php echo esc_attr( $key ); ?>" data-kind="<?php echo esc_attr( $m['kind'] ); ?>" data-on="<?php echo $m['on'] ? '1' : '0'; ?>" data-smson="<?php echo esc_attr( $sms_on ); ?>" data-custom="<?php echo $m['custom'] ? '1' : '0'; ?>" data-search="<?php echo esc_attr( $search ); ?>" data-tpltext="<?php echo esc_attr( $m['tpl_text'] ); ?>" data-label="<?php echo esc_attr( $m['label'] ); ?>">
			<summary>
				<span class="mp-c-head">
					<span class="mp-c-label"><?php echo esc_html( $m['label'] ); ?></span>
					<span class="mp-c-to">← <?php echo esc_html( $m['to'] ); ?></span>
				</span>
				<span class="mp-badges">
					<?php if ( ! $m['on'] ) : ?><span class="mp-b mp-b-off">خاموش</span><?php endif; ?>
					<?php if ( $notify ) : ?><span class="mp-b">اعلان پنل</span><?php endif; ?>
					<?php
					$labels = array( 'on' => $notify ? 'همیشه پیامک' : 'پیامک', 'auto' => 'پیامک برای موارد مهم', 'off' => 'بدون پیامک', 'fixed' => 'پیامک از تنظیمات خلاصه' );
					?>
					<span class="mp-b <?php echo 'off' === $sms_on ? 'mp-b-mute' : 'mp-b-sms'; ?>"><?php echo esc_html( $labels[ $sms_on ] ); ?></span>
					<?php if ( $m['tpl'] ) : ?>
						<span class="mp-b mp-b-tpl">پترن <?php echo esc_html( MP_Jalali::digits( $m['tpl'] ) ); ?></span>
					<?php elseif ( 'off' !== $sms_on ) : ?>
						<span class="mp-b mp-b-mute">متن عادی</span>
					<?php endif; ?>
					<?php if ( $m['custom'] ) : ?><span class="mp-b mp-b-edit">تغییر داده‌شده</span><?php endif; ?>
				</span>
				<span class="mp-c-prev" data-prev-summary></span>
			</summary>
			<div class="mp-c-body">
				<?php if ( empty( $m['locked'] ) ) : ?>
					<label class="mp-switch"><input type="checkbox" name="<?php echo esc_attr( $name ); ?>[on]" value="1" <?php checked( $m['on'] ); ?>> <?php echo $notify ? 'این اعلان فعال باشد (خاموش = نه در پنل، نه تلگرام/بله، نه پیامک)' : 'این پیامک فعال باشد'; ?></label>
				<?php else : ?>
					<p class="description">کد ورود همیشه فعال است؛ فقط متن و پترن آن قابل تغییر است.</p>
				<?php endif; ?>
				<div class="mp-cols">
					<?php if ( $notify ) : ?>
						<div class="mp-col">
							<h3>اعلان داخل پنل، پوش، تلگرام و بله</h3>
							<p><label>عنوان<input type="text" class="large-text" name="<?php echo esc_attr( $name ); ?>[title]" value="<?php echo esc_attr( $m['title'] ); ?>" data-f="title" data-def="<?php echo esc_attr( $m['def']['title'] ); ?>"></label></p>
							<p><label>توضیح (خط دوم)<input type="text" class="large-text" name="<?php echo esc_attr( $name ); ?>[detail]" value="<?php echo esc_attr( $m['detail'] ); ?>" data-f="detail" data-def="<?php echo esc_attr( $m['def']['detail'] ); ?>"></label></p>
							<div class="mp-preview mp-preview-n"><span class="mp-pv-k">پیش‌نمایش</span><strong data-prev="title"></strong><span data-prev="detail"></span></div>
						</div>
					<?php endif; ?>
					<div class="mp-col">
						<h3>پیامک</h3>
						<?php if ( $notify && ! empty( $m['sms_fixed'] ) ) : ?>
							<p class="description"><?php echo esc_html( $m['sms_fixed'] ); ?></p>
						<?php elseif ( $notify ) : ?>
							<p><label>کی پیامک شود؟
								<select name="<?php echo esc_attr( $name ); ?>[mode]">
									<option value="" <?php selected( $m['mode'], '' ); ?>>خودکار — <?php echo esc_html( $m['important'] ? $m['important'] : 'این اعلان به‌طور پیش‌فرض پیامک نمی‌شود' ); ?></option>
									<option value="on" <?php selected( $m['mode'], 'on' ); ?>>همیشه پیامک شود</option>
									<option value="off" <?php selected( $m['mode'], 'off' ); ?>>هرگز پیامک نشود</option>
								</select></label></p>
							<p class="description">پیامک فقط به کسانی می‌رسد که شماره موبایل دارند و پیامک را در تنظیمات حساب خود خاموش نکرده‌اند.</p>
						<?php endif; ?>
						<p><label>متن پیامک<textarea class="large-text" rows="3" name="<?php echo esc_attr( $name ); ?>[sms]" data-f="sms" data-def="<?php echo esc_attr( $m['def']['sms'] ); ?>"><?php echo esc_textarea( $m['sms'] ); ?></textarea></label></p>
						<div class="mp-preview"><span class="mp-pv-k" data-prev="smskind">پیامک این‌طور می‌رسد</span><span data-prev="sms"></span><small data-prev="count"></small></div>

						<div class="mp-pattern">
							<div class="mp-pattern-head">
								<label>شناسه پترن sms.ir <input name="<?php echo esc_attr( $name ); ?>[tpl]" dir="ltr" inputmode="numeric" size="9" value="<?php echo $m['tpl'] ? esc_attr( $m['tpl'] ) : ''; ?>" data-f="tpl" placeholder="مثلاً 123456"></label>
								<button type="button" class="button button-small" data-copy-pattern>کپی پترن</button>
							</div>
							<label class="mp-pv-k">متن پترن برای ثبت در sms.ir (ساخته‌شده از متن بالا)</label>
							<textarea class="large-text code" rows="2" readonly data-prev="pattern"></textarea>
							<p class="mp-pattern-vars" data-prev="params"></p>
							<p class="mp-warn" data-prev="warn" hidden></p>
							<?php if ( ! $smsir ) : ?><p class="description">پترن فقط وقتی سرویس پیامک sms.ir باشد استفاده می‌شود.</p><?php endif; ?>
						</div>
					</div>
				</div>
				<div class="mp-vars">
					<span class="mp-pv-k">متغیرها (برای افزودن در جای مکان‌نما کلیک کنید):</span>
					<?php foreach ( $vars as $v ) : ?>
						<?php $info = MP_Messages::VARS[ $v ]; ?>
						<button type="button" class="mp-chip<?php echo 'const' === $info[2] ? ' mp-chip-const' : ''; ?>" data-var="<?php echo esc_attr( $v ); ?>" title="<?php echo esc_attr( $info[0] ); ?>"><code>#<?php echo esc_html( $v ); ?>#</code> <?php echo esc_html( $info[0] ); ?></button>
					<?php endforeach; ?>
				</div>
				<div class="mp-c-actions">
					<button type="submit" class="button button-primary" name="mp_test" value="<?php echo esc_attr( $key ); ?>">ذخیره و ارسال آزمایشی</button>
					<button type="submit" class="button" name="mp_reset" value="<?php echo esc_attr( $key ); ?>" data-reset>بازگشت به متن پیش‌فرض</button>
					<span class="description">آزمایش با مقدارهای نمونه و به شماره «موبایل آزمایش» بالای صفحه ارسال می‌شود.</span>
				</div>
			</div>
		</details>
		<?php
	}

	private static function styles() {
		?>
		<style>
		.mp-msg{max-width:1180px}
		.mp-msg .mp-lead{font-size:14px;color:#3c434a;max-width:820px}
		.mp-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0}
		.mp-stat{background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
		.mp-stat-k{color:#646970;font-size:12px}
		.mp-stat strong{font-size:18px}
		.mp-stat-d{color:#646970;font-size:12px}
		.mp-help{background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:10px 16px;margin:0 0 16px}
		.mp-help summary{cursor:pointer;font-weight:600}
		.mp-help ol{margin:10px 22px 6px}
		.mp-help li{margin-bottom:6px}
		.mp-bar{position:sticky;top:32px;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#f0f0f1;padding:10px 0;border-bottom:1px solid #dcdcde}
		.mp-bar #mp-q{flex:1 1 240px;min-width:0}
		.mp-tp input{width:130px}
		.mp-group-title{margin:22px 0 10px;font-size:14px;color:#3c434a}
		.mp-aud{margin-top:28px;padding:16px 18px 6px;border-radius:12px;border:1px solid #dcdcde;border-inline-start:5px solid #2271b1;background:#f6f7f7}
		.mp-aud-client{border-inline-start-color:#d97706;background:#fffaf2}
		.mp-aud-shared{border-inline-start-color:#7e57c2;background:#f8f5fd}
		.mp-aud-head{display:flex;gap:12px;align-items:flex-start}
		.mp-aud-head .dashicons{font-size:28px;width:28px;height:28px;color:#2271b1}
		.mp-aud-client .mp-aud-head .dashicons{color:#d97706}.mp-aud-shared .mp-aud-head .dashicons{color:#7e57c2}
		.mp-aud-head h2{margin:0;font-size:18px}.mp-aud-head p{margin:4px 0 0;color:#50575e}
		.mp-aud-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 0}
		.mp-aud-tab{border:1px solid #c3c4c7;background:#fff;border-radius:20px;padding:6px 14px;font-size:13px;cursor:pointer}
		.mp-aud-tab span{display:inline-block;min-width:18px;padding:0 6px;margin-inline-start:4px;border-radius:10px;background:#f0f0f1;font-size:11px}
		.mp-aud-tab[aria-selected="true"]{background:#2271b1;border-color:#2271b1;color:#fff}
		.mp-aud-tab.mp-aud-client[aria-selected="true"]{background:#d97706;border-color:#d97706}
		.mp-aud-tab.mp-aud-shared[aria-selected="true"]{background:#7e57c2;border-color:#7e57c2}
		.mp-aud-tab[aria-selected="true"] span{background:rgba(255,255,255,.25)}
		.mp-card{background:#fff;border:1px solid #dcdcde;border-radius:8px;margin-bottom:8px;scroll-margin-top:120px}
		.mp-msg textarea,.mp-col input[type=text]{width:100%;box-sizing:border-box}
		.mp-card[open]{border-color:#2271b1;box-shadow:0 0 0 1px #2271b1}
		.mp-card[data-on="0"]>summary{opacity:.6}
		.mp-card>summary{cursor:pointer;padding:10px 14px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;list-style:none}
		.mp-card>summary::-webkit-details-marker{display:none}
		.mp-card>summary::before{content:"\25C2";color:#8c8f94;transition:transform .15s}
		.mp-card[open]>summary::before{transform:rotate(-90deg)}
		.mp-c-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
		.mp-c-label{font-weight:600;font-size:14px}
		.mp-c-to{color:#646970;font-size:12px}
		.mp-badges{display:flex;gap:4px;flex-wrap:wrap;margin-inline-start:auto}
		.mp-b{font-size:11px;line-height:1;padding:4px 7px;border-radius:20px;background:#f0f6fc;color:#0a4b78;border:1px solid #c5d9ed;white-space:nowrap}
		.mp-b-sms{background:#edfaef;color:#00631c;border-color:#b8e6bf}
		.mp-b-tpl{background:#fcf0e3;color:#8a4b00;border-color:#f0c58c}
		.mp-b-mute{background:#f6f7f7;color:#646970;border-color:#dcdcde}
		.mp-b-off{background:#fcf0f1;color:#8a2424;border-color:#f0b8b8}
		.mp-b-edit{background:#f4effa;color:#5b2d90;border-color:#d6c4ee}
		.mp-c-prev{flex-basis:100%;color:#50575e;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.mp-c-body{padding:4px 16px 16px;border-top:1px solid #f0f0f1}
		.mp-switch{display:block;margin:12px 0}
		.mp-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}
		.mp-col h3{font-size:13px;margin:12px 0 8px;color:#1d2327}
		.mp-col label{display:block;font-weight:500}
		.mp-col input[type=text],.mp-col textarea{margin-top:4px}
		.mp-preview{background:#f6f7f7;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px;margin-bottom:10px}
		.mp-preview small{color:#646970}
		.mp-preview [data-prev=sms]{white-space:pre-wrap;word-break:break-word}
		.mp-pv-k{color:#646970;font-size:11px;font-weight:400}
		.mp-pattern{border:1px dashed #c3c4c7;border-radius:8px;padding:10px 12px}
		.mp-pattern-head{display:flex;gap:8px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
		.mp-pattern-head label{font-weight:500}
		.mp-pattern textarea{background:#fff;direction:rtl}
		.mp-pattern-vars{font-size:12px;color:#50575e;margin:6px 0 0}
		.mp-warn{background:#fcf9e8;border-inline-start:3px solid #dba617;padding:6px 10px;margin:8px 0 0;font-size:12px}
		.mp-vars{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:14px 0 4px}
		.mp-chip{border:1px solid #c3c4c7;background:#fff;border-radius:16px;padding:3px 9px;font-size:12px;cursor:pointer}
		.mp-chip:hover,.mp-chip:focus-visible{border-color:#2271b1;color:#2271b1}
		.mp-chip code{background:none;padding:0;font-size:11px}
		.mp-chip-const{background:#f6f7f7}
		.mp-c-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
		.mp-log td{vertical-align:top}
		.mp-log-text{max-width:420px;white-space:pre-wrap;word-break:break-word}
		.mp-ok{color:#00631c}.mp-bad{color:#b32d2e}
		.mp-hidden{display:none}
		@media (max-width:782px){.mp-bar{top:46px}.mp-cols{grid-template-columns:1fr}}
		</style>
		<?php
	}

	private static function script() {
		?>
		<script>
		(function () {
			var D = window.MP_MSG, form = document.getElementById('mp-msg-form');
			if (!D || !form) return;
			function tidy(s) {
				return s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([!؟?،,.:؛;)»])/g, '$1').replace(/\(\s*\)/g, '')
					.replace(/(\s*·\s*){2,}/g, ' · ').replace(/^(\s*[·\-–]\s*)+|(\s*[·\-–]\s*)+$/g, '').replace(/[ \t]{2,}/g, ' ').trim();
			}
			function fill(t, vals) { return tidy(String(t || '').replace(/#([A-Z][A-Z0-9]*)#/g, function (all, k) { return k in vals ? vals[k] : all; })); }
			function pattern(t) {
				return String(t || '').replace(/#([A-Z][A-Z0-9]*)#/g, function (all, k) {
					if (k in D.consts) return D.consts[k];
					if (D.links.indexOf(k) > -1) return D.prefix + all;
					return all;
				});
			}
			function names(p) { var out = []; String(p).replace(/#([A-Z][A-Z0-9]*)#/g, function (a, k) { if (out.indexOf(k) < 0) out.push(k); }); return out; }
			function cut(v) { v = String(v || '').replace(/\s+/g, ' ').trim(); if (!v) return '-'; return v.length > D.max ? v.slice(0, D.max - 1).trim() + '…' : v; }
			function count(t) {
				var uni = /[^\x00-\x7F]/.test(t), n = t.length;
				var parts = uni ? (n <= 70 ? 1 : Math.ceil(n / 67)) : (n <= 160 ? 1 : Math.ceil(n / 153));
				return fa(n) + ' نویسه · ' + fa(parts) + ' پیامک' + (uni ? ' (فارسی: ۷۰ نویسه در هر پیامک)' : '');
			}
			function fa(n) { return String(n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
			function q(card, sel) { return card.querySelector(sel); }

			var cards = Array.prototype.slice.call(document.querySelectorAll('.mp-card'));
			function update(card) {
				var get = function (f) { var e = q(card, '[data-f="' + f + '"]'); return e ? e.value : ''; };
				var title = q(card, '[data-prev="title"]');
				if (title) { title.textContent = fill(get('title'), D.samples); q(card, '[data-prev="detail"]').textContent = fill(get('detail'), D.samples); }
				var sms = get('sms'), pat = pattern(sms), tpl = get('tpl').trim(), shown;
				var useTpl = D.smsir && tpl;
				var snap = card.getAttribute('data-tpltext');
				var regPat = useTpl && snap ? snap : pat;
				if (useTpl) {
					shown = regPat.replace(/#([A-Z][A-Z0-9]*)#/g, function (a, k) { return D.links.indexOf(k) > -1 ? 'Ab3xY9' : cut(D.samples[k]); });
					q(card, '[data-prev="smskind"]').textContent = 'با پترن ' + fa(tpl) + ' این‌طور می‌رسد (مقدارها حداکثر ' + fa(D.max) + ' نویسه)';
				} else {
					shown = fill(sms, D.samples);
					q(card, '[data-prev="smskind"]').textContent = 'پیامک (متن عادی) این‌طور می‌رسد';
				}
				q(card, '[data-prev="sms"]').textContent = shown;
				q(card, '[data-prev="count"]').textContent = count(shown);
				q(card, '[data-prev="pattern"]').value = pat;
				var ns = names(pat);
				q(card, '[data-prev="params"]').textContent = ns.length ? 'متغیرهای پترن: ' + ns.map(function (k) { return '#' + k + '#'; }).join('  ') : 'این پترن متغیری ندارد.';
				var warn = q(card, '[data-prev="warn"]');
				if (tpl && snap && snap !== pat) {
					warn.hidden = false;
					warn.textContent = 'متن پیامک بعد از ثبت پترن ' + fa(tpl) + ' تغییر کرده؛ تا وقتی پترن جدید ثبت و شناسه‌اش را وارد نکنید، همان پترن قبلی ارسال می‌شود: «' + snap + '»';
				} else if (tpl && !snap && card.id !== 'msg-otp') {
					warn.hidden = false;
					warn.textContent = 'با ذخیره، فرض می‌شود این شناسه برای همین متن پترن بالا ثبت شده است.';
				} else warn.hidden = true;
				var sum = q(card, '[data-prev-summary]');
				sum.textContent = title ? title.textContent + (q(card, '[data-prev="detail"]').textContent ? ' — ' + q(card, '[data-prev="detail"]').textContent : '') : shown;
			}
			function allPatterns() {
				var out = [], head = '';
				cards.forEach(function (c) {
					if (c.getAttribute('data-smson') === 'off' || c.getAttribute('data-on') === '0') return;
					var h = c.closest('.mp-aud').querySelector('h2').textContent;
					if (h !== head) { head = h; out.push('==== ' + h + ' ===='); }
					out.push('— ' + c.getAttribute('data-label') + '\n' + q(c, '[data-prev="pattern"]').value);
				});
				document.getElementById('mp-all-patterns').value = out.join('\n\n');
			}
			cards.forEach(function (c) {
				update(c);
				c.addEventListener('input', function () { update(c); allPatterns(); });
				['focusin', 'click', 'input'].forEach(function (ev) {
					c.addEventListener(ev, function (e) { if (e.target.matches && e.target.matches('[data-f="title"],[data-f="detail"],[data-f="sms"]')) c._last = e.target; });
				});
				c.querySelectorAll('.mp-chip').forEach(function (b) {
					b.addEventListener('click', function () {
						var el = c._last || q(c, '[data-f="sms"]'), tok = '#' + b.getAttribute('data-var') + '#';
						var s = el.selectionStart != null ? el.selectionStart : el.value.length, e = el.selectionEnd != null ? el.selectionEnd : s;
						el.value = el.value.slice(0, s) + tok + el.value.slice(e);
						el.focus(); el.setSelectionRange(s + tok.length, s + tok.length);
						update(c); allPatterns();
					});
				});
				var cp = q(c, '[data-copy-pattern]');
				cp.addEventListener('click', function () { copy(q(c, '[data-prev="pattern"]'), cp); });
				q(c, '[data-reset]').addEventListener('click', function (e) { if (!confirm('متن‌های «' + c.getAttribute('data-label') + '» به پیش‌فرض برگردد؟ (تغییرات دیگر صفحه هم ذخیره می‌شود)')) e.preventDefault(); });
			});
			allPatterns();
			function copy(ta, btn) {
				var text = ta.value, old = btn.textContent;
				var done = function () { btn.textContent = 'کپی شد ✓'; setTimeout(function () { btn.textContent = old; }, 1500); };
				if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
				else { ta.select(); document.execCommand('copy'); done(); }
			}
			document.querySelectorAll('[data-copy]').forEach(function (b) { b.addEventListener('click', function () { copy(document.querySelector(b.getAttribute('data-copy')), b); }); });

			var qi = document.getElementById('mp-q'), fi = document.getElementById('mp-filter'), aud = '';
			try { aud = localStorage.getItem('mp_msg_aud') || ''; } catch (e) {}
			var tabs = Array.prototype.slice.call(document.querySelectorAll('.mp-aud-tab'));
			if (!tabs.some(function (t) { return t.getAttribute('data-aud') === aud; })) aud = '';
			tabs.forEach(function (t) {
				t.setAttribute('aria-selected', String(t.getAttribute('data-aud') === aud));
				t.addEventListener('click', function () {
					aud = t.getAttribute('data-aud');
					try { localStorage.setItem('mp_msg_aud', aud); } catch (e) {}
					tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
					filter();
				});
			});
			function filter() {
				var s = qi.value.trim(), f = fi.value;
				cards.forEach(function (c) {
					var ok = (!aud || c.getAttribute('data-aud') === aud) && (!s || c.getAttribute('data-search').indexOf(s) > -1);
					if (ok && f) {
						var kind = c.getAttribute('data-kind'), on = c.getAttribute('data-on') === '1', smson = c.getAttribute('data-smson'), tpl = q(c, '[data-f="tpl"]').value.trim();
						ok = f === 'notify' ? kind === 'notify' : f === 'sms' ? kind === 'sms' : f === 'smson' ? kind === 'notify' && (smson === 'on' || smson === 'auto') : f === 'notpl' ? smson !== 'off' && !tpl : f === 'custom' ? c.getAttribute('data-custom') === '1' : !on;
					}
					c.classList.toggle('mp-hidden', !ok);
				});
				document.querySelectorAll('.mp-group[data-group], .mp-aud').forEach(function (g) { g.classList.toggle('mp-hidden', !g.querySelector('.mp-card:not(.mp-hidden)')); });
			}
			qi.addEventListener('input', filter); fi.addEventListener('change', filter);
			filter();
			function openHash() {
				if (!/^#msg-[a-z_]+$/.test(location.hash)) return;
				var open = document.querySelector(location.hash);
				if (open && open.classList.contains('mp-hidden')) { var t0 = document.querySelector('.mp-aud-tab[data-aud=""]'); if (t0) t0.click(); }
				if (open) { open.open = true; setTimeout(function () { open.scrollIntoView({ block: 'start' }); }, 50); }
			}
			openHash();
			window.addEventListener('hashchange', openHash);
		})();
		</script>
		<?php
	}
}

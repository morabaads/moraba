<?php
defined( 'ABSPATH' ) || exit;

/**
 * In-panel notifications, with copies by email, Telegram, Bale and SMS.
 * Bot tokens and the SMS key are set by the site admin; each person enters their own chat ID / phone.
 * "Important" notifications (assigned tasks, meeting invites, reminders, leave decisions) also go by email and SMS.
 * Texts come from the catalog in MP_Messages, which the site admin can edit («اعلان‌ها و پیامک‌ها»).
 */
class MP_Notify {

	/** A catalog notification: texts filled from $vars; nothing is sent when the admin turned it off. */
	public static function event( $key, $user_id, array $vars = array(), $target = '', $ref_id = 0, $important = false ) {
		$n = MP_Messages::notification( $key, $vars );
		if ( $n ) {
			self::send( $user_id, $n['type'], $n['title'], $n['detail'], $target, $ref_id, $important, array( 'key' => $key, 'vars' => $vars ) );
		}
	}

	public static function send( $user_id, $type, $title, $detail = '', $target = '', $ref_id = 0, $important = false, $sms = null ) {
		global $wpdb;
		$user_id = (int) $user_id;
		if ( ! $user_id ) {
			return;
		}
		$wpdb->insert(
			MP_Install::table( 'notifications' ),
			array(
				'user_id'    => $user_id,
				'type'       => substr( $type, 0, 20 ),
				'title'      => MP_Util::text( $title, 200 ),
				'detail'     => MP_Util::text( $detail, 255 ),
				'target'     => substr( $target, 0, 40 ),
				'ref_id'     => (int) $ref_id,
				'is_read'    => 0,
				'created_at' => MP_Util::now(),
			)
		);
		if ( $important && get_option( 'mp_email_notifications', '1' ) ) {
			$u = get_userdata( $user_id );
			if ( $u && is_email( $u->user_email ) ) {
				wp_mail( $u->user_email, '[' . get_bloginfo( 'name' ) . '] ' . $title, $title . "\n\n" . $detail . "\n\n" . MP_Frontend::panel_url() );
			}
		}
		self::later( $user_id, $title, $detail, $important, $sms );
	}

	private static $later = array();

	/**
	 * Messenger/SMS/push calls can take seconds (or hang on a filtered host), so during a web
	 * request they run after the response has been sent: sending a chat message stays instant.
	 */
	private static function later( $user_id, $title, $detail, $important, $sms = null ) {
		if ( wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			self::external( $user_id, $title, $detail, $important, $sms );
			MP_Push::send( $user_id );
			return;
		}
		if ( ! self::$later ) {
			add_action( 'shutdown', array( __CLASS__, 'flush_later' ), 1 );
		}
		self::$later[] = array( $user_id, $title, $detail, $important, $sms );
	}

	public static function flush_later() {
		$jobs         = self::$later;
		self::$later = array();
		if ( ! $jobs ) {
			return;
		}
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		} elseif ( function_exists( 'litespeed_finish_request' ) ) {
			litespeed_finish_request();
		}
		ignore_user_abort( true );
		foreach ( $jobs as $j ) {
			self::external( $j[0], $j[1], $j[2], $j[3], $j[4] );
			MP_Push::send( $j[0] );
		}
	}

	private static function prefs( $user_id ) {
		$p = get_user_meta( $user_id, 'mp_prefs', true );
		return wp_parse_args( is_array( $p ) ? $p : array(), array( 'telegram' => true, 'bale' => true, 'sms' => true ) );
	}

	/**
	 * Sends to the person's messenger/SMS channels; returns the names of channels used.
	 * $sms = [key, vars] of a catalog message: its SMS text/pattern and the admin's «when to SMS» choice apply.
	 */
	public static function external( $user_id, $title, $detail, $important, $sms = null ) {
		$prefs = self::prefs( $user_id );
		$text  = $title . ( $detail ? "\n" . $detail : '' ) . "\n" . MP_Frontend::panel_url();
		$used  = array();

		$bots = array(
			'telegram' => array( 'https://api.telegram.org/bot', get_option( 'mp_telegram_token', '' ), get_user_meta( $user_id, 'mp_telegram_chat', true ) ),
			'bale'     => array( 'https://tapi.bale.ai/bot', get_option( 'mp_bale_token', '' ), get_user_meta( $user_id, 'mp_bale_chat', true ) ),
		);
		foreach ( $bots as $name => $bot ) {
			if ( $bot[1] && $bot[2] && $prefs[ $name ] ) {
				wp_remote_post(
					$bot[0] . rawurlencode( $bot[1] ) . '/sendMessage',
					array(
						'blocking' => false,
						'timeout'  => 5,
						'headers'  => array( 'Content-Type' => 'application/json' ),
						'body'     => wp_json_encode( array( 'chat_id' => $bot[2], 'text' => $text ) ),
					)
				);
				$used[] = $name;
			}
		}

		$phone = (string) get_user_meta( $user_id, 'mp_phone', true );
		$want  = $important;
		if ( $sms ) {
			$mode = MP_Messages::sms_mode( $sms['key'] );
			$want = 'on' === $mode || ( '' === $mode && $important );
		}
		if ( $want && $phone && $prefs['sms'] ) {
			$sent = $sms ? MP_Messages::send_sms( $sms['key'], $phone, $sms['vars'] ) : MP_Auth::text( $phone, $title . ( $detail ? ' - ' . $detail : '' ) );
			if ( $sent ) {
				$used[] = 'sms';
			}
		}
		return $used;
	}
}

<?php
defined( 'ABSPATH' ) || exit;

/**
 * Optional server-side speech: voice message → text, and text message → audio, through any
 * OpenAI-compatible API (OpenAI itself, or a compatible gateway reachable from the host).
 * Browsers can't transcribe a recorded file on their own, so this covers voice messages whose
 * text wasn't captured live, and devices without a Persian text-to-speech voice.
 */
class MP_Speech {

	const HOURLY = 60; // requests per person per hour

	public static function enabled() {
		return (bool) get_option( 'mp_speech_key', '' );
	}

	private static function base() {
		$url = trim( (string) get_option( 'mp_speech_url', '' ) );
		return untrailingslashit( $url ? $url : 'https://api.openai.com/v1' );
	}

	private static function err( $msg, $status = 400 ) {
		return new WP_Error( 'mp_speech', $msg, array( 'status' => $status ) );
	}

	/** Message the current user may read, or WP_Error. */
	private static function message( $id ) {
		global $wpdb;
		$m = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'messages' ) . ' WHERE id = %d', (int) $id ) );
		if ( ! $m || ! empty( $m->deleted_at ) || ! MP_Rest::can_read_channel( $m->channel_id ) ) {
			return self::err( 'پیام پیدا نشد.', 404 );
		}
		return $m;
	}

	private static function throttle() {
		$key = 'mp_speech_' . get_current_user_id();
		$n   = (int) get_transient( $key );
		if ( $n >= self::HOURLY ) {
			return self::err( 'تعداد درخواست‌های تبدیل در این ساعت زیاد بود؛ کمی بعد امتحان کنید.', 429 );
		}
		set_transient( $key, $n + 1, HOUR_IN_SECONDS );
		return null;
	}

	private static function failure( $res ) {
		if ( is_wp_error( $res ) ) {
			return self::err( 'سرویس تبدیل گفتار در دسترس نیست: ' . $res->get_error_message(), 502 );
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		$msg  = isset( $body['error']['message'] ) ? $body['error']['message'] : 'HTTP ' . wp_remote_retrieve_response_code( $res );
		return self::err( 'سرویس تبدیل گفتار خطا داد: ' . $msg, 502 );
	}

	/** POST messages/{id}/transcribe — voice message to text (stored, so it runs once per message). */
	public static function transcribe( WP_REST_Request $r ) {
		global $wpdb;
		$m = self::message( $r['id'] );
		if ( is_wp_error( $m ) ) {
			return $m;
		}
		if ( '' !== trim( (string) $m->transcript ) ) {
			return MP_Rest::message_payload( $m, get_current_user_id() );
		}
		$file = $m->file_id ? MP_Files::get( $m->file_id ) : null;
		if ( ! $file || 0 !== strpos( $file->mime, 'audio/' ) ) {
			return self::err( 'این پیام صوتی نیست.' );
		}
		if ( ! self::enabled() ) {
			return self::err( 'متن این ویس هنگام ضبط گرفته نشده. برای تبدیل ویس‌ها، مدیر سایت باید در تنظیمات پنل «سرویس تبدیل گفتار» را فعال کند.', 409 );
		}
		$limited = self::throttle();
		if ( $limited ) {
			return $limited;
		}
		$text = self::whisper( MP_Files::dir() . '/' . $file->path, $file->mime );
		if ( is_wp_error( $text ) ) {
			return $text;
		}
		$wpdb->update( MP_Install::table( 'messages' ), array( 'transcript' => MP_Util::long_text( $text, 4000 ) ), array( 'id' => $m->id ) );
		$m->transcript = $text;
		return MP_Rest::message_payload( $m, get_current_user_id() );
	}

	/** A stored recording (e.g. a meeting's sound) to text; returns the text or WP_Error. */
	public static function transcribe_file( $path, $mime ) {
		if ( ! self::enabled() ) {
			return self::err( 'برای متن جلسه، مدیر سایت باید در تنظیمات پنل «سرویس تبدیل گفتار» را فعال کند.', 409 );
		}
		if ( ! is_file( $path ) || filesize( $path ) > 25 * MB_IN_BYTES ) {
			return self::err( 'فایل صدای جلسه پیدا نشد یا بزرگ‌تر از ۲۵ مگابایت است.' );
		}
		return self::whisper( $path, $mime, 600 );
	}

	/** Sends an audio file to the speech-to-text API; returns the text or WP_Error. */
	private static function whisper( $path, $mime, $timeout = 60 ) {
		$ext      = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
		$boundary = wp_generate_password( 24, false );
		$fields   = array( 'model' => get_option( 'mp_speech_stt_model', 'whisper-1' ), 'language' => 'fa', 'response_format' => 'json' );
		$body     = '';
		foreach ( $fields as $k => $v ) {
			$body .= "--$boundary\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n";
		}
		$body .= "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.$ext\"\r\nContent-Type: $mime\r\n\r\n" . file_get_contents( $path ) . "\r\n--$boundary--\r\n"; // phpcs:ignore WordPress.WP.AlternativeFunctions
		$res = wp_remote_post(
			self::base() . '/audio/transcriptions',
			array(
				'timeout' => $timeout,
				'headers' => array( 'Authorization' => 'Bearer ' . get_option( 'mp_speech_key' ), 'Content-Type' => 'multipart/form-data; boundary=' . $boundary ),
				'body'    => $body,
			)
		);
		if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
			return self::failure( $res );
		}
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		$text = isset( $data['text'] ) ? trim( (string) $data['text'] ) : '';
		return '' === $text ? self::err( 'متنی در صدا تشخیص داده نشد.', 422 ) : $text;
	}

	/**
	 * POST speech/transcribe (file) — a short spoken sentence for the smart input, on devices whose
	 * browser can't recognise speech itself (iPhone). Nothing is stored.
	 */
	public static function transcribe_upload() {
		if ( ! self::enabled() ) {
			return self::err( 'تبدیل صدا روی این دستگاه به «سرویس تبدیل گفتار» نیاز دارد که هنوز در تنظیمات پنل فعال نشده.', 409 );
		}
		$limited = self::throttle();
		if ( $limited ) {
			return $limited;
		}
		$f = isset( $_FILES['file'] ) ? $_FILES['file'] : null; // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
		$testing = defined( 'MP_TESTING' ) && MP_TESTING;
		if ( ! $f || ! empty( $f['error'] ) || ( ! is_uploaded_file( $f['tmp_name'] ) && ! $testing ) || $f['size'] > 5 * MB_IN_BYTES ) {
			return self::err( 'فایل صدا دریافت نشد.' );
		}
		$ext  = strtolower( pathinfo( sanitize_file_name( $f['name'] ), PATHINFO_EXTENSION ) );
		$mime = isset( MP_Files::AUDIO[ $ext ] ) ? MP_Files::AUDIO[ $ext ] : '';
		if ( ! $mime ) {
			return self::err( 'قالب صدا پشتیبانی نمی‌شود.' );
		}
		$tmp = trailingslashit( get_temp_dir() ) . 'mp-voice-' . wp_generate_password( 12, false ) . '.' . $ext;
		copy( $f['tmp_name'], $tmp );
		$text = self::whisper( $tmp, $mime );
		wp_delete_file( $tmp );
		return is_wp_error( $text ) ? $text : array( 'text' => $text );
	}

	/** POST messages/{id}/speech — text message read aloud; returns a data: URL (mp3). Cached per message. */
	public static function speak( WP_REST_Request $r ) {
		$m = self::message( $r['id'] );
		if ( is_wp_error( $m ) ) {
			return $m;
		}
		$text = trim( wp_strip_all_tags( (string) $m->body ) );
		if ( '' === $text ) {
			return self::err( 'این پیام متنی ندارد.' );
		}
		if ( ! self::enabled() ) {
			return self::err( 'این دستگاه صدای فارسی ندارد و سرویس تبدیل متن به گفتار در تنظیمات پنل فعال نیست.', 409 );
		}
		$cache = 'mp_tts_' . $m->id;
		$audio = get_transient( $cache );
		if ( ! $audio ) {
			$limited = self::throttle();
			if ( $limited ) {
				return $limited;
			}
			$res = wp_remote_post(
				self::base() . '/audio/speech',
				array(
					'timeout' => 60,
					'headers' => array( 'Authorization' => 'Bearer ' . get_option( 'mp_speech_key' ), 'Content-Type' => 'application/json' ),
					'body'    => wp_json_encode(
						array(
							'model'  => get_option( 'mp_speech_tts_model', 'tts-1' ),
							'voice'  => get_option( 'mp_speech_voice', 'alloy' ),
							'input'  => mb_substr( $text, 0, 1500 ),
							'format' => 'mp3',
						)
					),
				)
			);
			if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
				return self::failure( $res );
			}
			$audio = base64_encode( wp_remote_retrieve_body( $res ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions
			set_transient( $cache, $audio, DAY_IN_SECONDS );
		}
		return array( 'audio' => 'data:audio/mpeg;base64,' . $audio );
	}
}

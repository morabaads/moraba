<?php
defined( 'ABSPATH' ) || exit;

/**
 * Private uploads: stored in uploads/moraba-panel with random names and served only after a permission check
 * (?mp_file=ID). Contexts: task, comment, message, ledger, avatar.
 */
class MP_Files {

	const MAX_BYTES = 10485760; // 10 MB.
	/** Voice messages: recorded in the browser as WebM/Opus (Chrome, Android) or MP4/AAC (Safari, iPhone). */
	const AUDIO = array(
		'webm' => 'audio/webm',
		'ogg'  => 'audio/ogg',
		'opus' => 'audio/ogg',
		'm4a'  => 'audio/mp4',
		'mp4'  => 'audio/mp4',
		'aac'  => 'audio/aac',
		'mp3'  => 'audio/mpeg',
		'wav'  => 'audio/wav',
	);
	const TYPES     = array(
		'jpg|jpeg|jpe' => 'image/jpeg',
		'png'          => 'image/png',
		'gif'          => 'image/gif',
		'webp'         => 'image/webp',
		'pdf'          => 'application/pdf',
		'txt'          => 'text/plain',
		'zip'          => 'application/zip',
		'doc'          => 'application/msword',
		'docx'         => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'xls'          => 'application/vnd.ms-excel',
		'xlsx'         => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	);

	public static function dir() {
		$up  = wp_upload_dir( null, false );
		$dir = trailingslashit( $up['basedir'] ) . 'moraba-panel';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			file_put_contents( $dir . '/index.php', "<?php\n// Silence.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			file_put_contents( $dir . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
		return $dir;
	}

	public static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'files' ) . ' WHERE id = %d', $id ) );
	}

	public static function url( $id, $download = false ) {
		$args = array( 'mp_file' => (int) $id );
		if ( $download ) {
			$args['download'] = 1;
		}
		return add_query_arg( $args, home_url( '/' ) );
	}

	public static function payload( $file ) {
		if ( ! $file ) {
			return null;
		}
		return array(
			'id'    => (int) $file->id,
			'name'  => $file->name,
			'mime'  => $file->mime,
			'size'  => (int) $file->size,
			'image' => 0 === strpos( $file->mime, 'image/' ),
			'url'   => self::url( $file->id ),
		);
	}

	/**
	 * Stores $_FILES['file'] for the current user.
	 *
	 * @return object|WP_Error
	 */
	/**
	 * Audio by extension, confirmed by the file's real content (WordPress's own check rejects
	 * recordings whose container sniffs as video/webm or video/mp4).
	 */
	private static function audio_check( $tmp, $name ) {
		$ext = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
		if ( ! isset( self::AUDIO[ $ext ] ) ) {
			return null;
		}
		$real = function_exists( 'finfo_open' ) ? (string) finfo_file( finfo_open( FILEINFO_MIME_TYPE ), $tmp ) : '';
		if ( '' !== $real && ! preg_match( '#^(audio/|video/(webm|mp4|quicktime|3gpp)$|application/ogg$|application/octet-stream$)#', $real ) ) {
			return null;
		}
		return array( 'ext' => $ext, 'type' => self::AUDIO[ $ext ] );
	}

	public static function store( $context, $context_id, $images_only = false ) {
		global $wpdb;
		if ( empty( $_FILES['file'] ) || ! is_array( $_FILES['file'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return new WP_Error( 'mp_file', 'فایلی انتخاب نشده است.', array( 'status' => 400 ) );
		}
		$f = $_FILES['file']; // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
		$testing = defined( 'MP_TESTING' ) && MP_TESTING && is_file( $f['tmp_name'] );
		if ( ! empty( $f['error'] ) || ( ! is_uploaded_file( $f['tmp_name'] ) && ! $testing ) ) {
			return new WP_Error( 'mp_file', 'بارگذاری فایل انجام نشد.', array( 'status' => 400 ) );
		}
		if ( (int) $f['size'] > self::MAX_BYTES ) {
			return new WP_Error( 'mp_file', 'حجم فایل باید کمتر از ۱۰ مگابایت باشد.', array( 'status' => 400 ) );
		}
		$name  = sanitize_file_name( wp_basename( (string) $f['name'] ) );
		$check = self::audio_check( $f['tmp_name'], $name );
		if ( ! $check ) {
			$check = wp_check_filetype_and_ext( $f['tmp_name'], $name, self::TYPES );
		}
		if ( ! $check['ext'] || ! $check['type'] ) {
			return new WP_Error( 'mp_file', 'این نوع فایل مجاز نیست. تصویر، PDF، ورد، اکسل، متن یا ZIP بفرستید.', array( 'status' => 400 ) );
		}
		if ( $images_only && 0 !== strpos( $check['type'], 'image/' ) ) {
			return new WP_Error( 'mp_file', 'فقط تصویر مجاز است.', array( 'status' => 400 ) );
		}
		$sub  = gmdate( 'Y/m' );
		$dir  = self::dir() . '/' . $sub;
		wp_mkdir_p( $dir );
		$rel  = $sub . '/' . wp_generate_password( 32, false, false ) . '.' . $check['ext'];
		$moved = $testing ? copy( $f['tmp_name'], self::dir() . '/' . $rel ) : move_uploaded_file( $f['tmp_name'], self::dir() . '/' . $rel );
		if ( ! $moved ) {
			return new WP_Error( 'mp_file', 'ذخیره فایل انجام نشد.', array( 'status' => 500 ) );
		}
		$wpdb->insert(
			MP_Install::table( 'files' ),
			array(
				'user_id'    => get_current_user_id(),
				'context'    => $context,
				'context_id' => (int) $context_id,
				'name'       => $name ? $name : 'file.' . $check['ext'],
				'mime'       => $check['type'],
				'size'       => (int) $f['size'],
				'path'       => $rel,
				'created_at' => MP_Util::now(),
			)
		);
		return self::get( $wpdb->insert_id );
	}

	/** Stores bytes made by the plugin itself (e.g. a signed contract's PDF). */
	public static function store_bytes( $context, $context_id, $name, $mime, $bytes, $ext ) {
		global $wpdb;
		$sub = gmdate( 'Y/m' );
		wp_mkdir_p( self::dir() . '/' . $sub );
		$rel = $sub . '/' . wp_generate_password( 32, false, false ) . '.' . $ext;
		if ( false === file_put_contents( self::dir() . '/' . $rel, $bytes ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			return null;
		}
		$wpdb->insert(
			MP_Install::table( 'files' ),
			array(
				'user_id'    => get_current_user_id(),
				'context'    => $context,
				'context_id' => (int) $context_id,
				'name'       => sanitize_file_name( $name ),
				'mime'       => $mime,
				'size'       => strlen( $bytes ),
				'path'       => $rel,
				'created_at' => MP_Util::now(),
			)
		);
		return self::get( $wpdb->insert_id );
	}

	/** Attach an uploaded (still unattached) file to its object; only the uploader may do this. */
	public static function claim( $file_id, $context, $context_id ) {
		global $wpdb;
		$file = self::get( $file_id );
		if ( ! $file || (int) $file->user_id !== get_current_user_id() || $file->context !== $context ) {
			return 0;
		}
		$wpdb->update( MP_Install::table( 'files' ), array( 'context_id' => (int) $context_id ), array( 'id' => $file->id ) );
		return (int) $file->id;
	}

	public static function delete( $id ) {
		global $wpdb;
		$file = self::get( $id );
		if ( ! $file ) {
			return;
		}
		$path = self::dir() . '/' . $file->path;
		if ( is_file( $path ) ) {
			wp_delete_file( $path );
		}
		$wpdb->delete( MP_Install::table( 'files' ), array( 'id' => $file->id ) );
	}

	/** Can the current viewer (or a client with a group token) read this file? */
	public static function can_read( $file, $client_token = '' ) {
		global $wpdb;
		$uid = get_current_user_id();
		if ( 'client_logo' === $file->context ) {
			return true; // a client group's logo is public, like the page it sits on
		}
		// Meeting chat files and the design on show: a signed link opens them for the meeting's guests.
		$mk = isset( $_GET['mk'] ) ? (string) wp_unslash( $_GET['mk'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput
		if ( '' !== $mk && hash_equals( MP_Meet::file_sig( $file->id ), $mk ) ) {
			return true;
		}
		if ( $client_token ) {
			$tch = MP_Client::channel( $client_token );
			if ( ! $tch || MP_Client::gate( $tch ) ) {
				$client_token = ''; // logged-out client of a protected group: no files
			}
		}
		if ( 'client_item' === $file->context && $client_token ) {
			$pid = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT project_id FROM ' . MP_Install::table( 'channels' ) . " WHERE type = 'client' AND token = %s AND archived_at IS NULL", $client_token ) );
			if ( $pid && $pid === (int) $file->context_id ) {
				return true;
			}
		}
		if ( 'message' === $file->context && $client_token ) {
			$ch = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'channels' ) . " WHERE type = 'client' AND token = %s", $client_token ) );
			// Its own group, or a group it was forwarded into.
			if ( $ch && ( (int) $ch->id === (int) $file->context_id || $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . MP_Install::table( 'messages' ) . ' WHERE file_id = %d AND channel_id = %d AND deleted_at IS NULL LIMIT 1', $file->id, $ch->id ) ) ) ) {
				return true;
			}
		}
		if ( ! $uid || ! user_can( $uid, 'mp_access_panel' ) ) {
			return false;
		}
		if ( (int) $file->user_id === $uid || MP_Util::is_manager() || in_array( $file->context, array( 'avatar', 'ledger' ), true ) ) {
			return true;
		}
		if ( 'task' === $file->context || 'comment' === $file->context ) {
			$task_id = 'task' === $file->context ? $file->context_id : (int) $wpdb->get_var( $wpdb->prepare( 'SELECT task_id FROM ' . MP_Install::table( 'task_comments' ) . ' WHERE id = %d', $file->context_id ) );
			return MP_Rest::can_view_task_id( $task_id );
		}
		if ( 'message' === $file->context ) {
			if ( MP_Rest::can_read_channel( $file->context_id ) ) {
				return true;
			}
			// A forwarded copy in another chat the person can read.
			foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT DISTINCT channel_id FROM ' . MP_Install::table( 'messages' ) . ' WHERE file_id = %d', $file->id ) ) as $cid ) {
				if ( MP_Rest::can_read_channel( $cid ) ) {
					return true;
				}
			}
			return false;
		}
		if ( 'client_item' === $file->context ) {
			return MP_Util::can_see_project( $file->context_id );
		}
		if ( in_array( $file->context, array( 'meeting', 'meeting_rec', 'meeting_audio' ), true ) ) {
			$m = MP_Meet::get( $file->context_id );
			return $m && MP_Meet::can_see( $m, $uid );
		}
		return false;
	}

	public static function serve( $id ) {
		$file  = self::get( $id );
		$token = isset( $_GET['t'] ) ? preg_replace( '/[^A-Za-z0-9]/', '', (string) wp_unslash( $_GET['t'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( ! $file || ! self::can_read( $file, $token ) ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$path = self::dir() . '/' . $file->path;
		if ( ! is_file( $path ) ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$inline = ! isset( $_GET['download'] ) && ( 0 === strpos( $file->mime, 'image/' ) || 0 === strpos( $file->mime, 'audio/' ) || 0 === strpos( $file->mime, 'video/' ) || 'application/pdf' === $file->mime ); // phpcs:ignore WordPress.Security.NonceVerification
		// Drop anything themes/plugins buffered (BOM, whitespace, gzip handlers) so the bytes arrive intact.
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
		header( 'Content-Type: ' . $file->mime );
		// Safari only plays audio when the server answers byte-range requests.
		$size  = filesize( $path );
		$start = 0;
		$end   = $size - 1;
		header( 'Accept-Ranges: bytes' );
		if ( isset( $_SERVER['HTTP_RANGE'] ) && preg_match( '/bytes=(\d*)-(\d*)/', (string) wp_unslash( $_SERVER['HTTP_RANGE'] ), $rm ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			$start = '' === $rm[1] ? max( 0, $size - (int) $rm[2] ) : (int) $rm[1];
			$end   = '' === $rm[1] || '' === $rm[2] ? $end : min( $end, (int) $rm[2] );
			if ( $start > $end || $start >= $size ) {
				status_header( 416 );
				header( 'Content-Range: bytes */' . $size );
				exit;
			}
			status_header( 206 );
			header( 'Content-Range: bytes ' . $start . '-' . $end . '/' . $size );
		}
		header( 'Content-Length: ' . ( $end - $start + 1 ) );
		header( 'X-Content-Type-Options: nosniff' );
		header( "Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" );
		header( 'Content-Disposition: ' . ( $inline ? 'inline' : 'attachment' ) . "; filename*=UTF-8''" . rawurlencode( $file->name ) );
		header( 'Cache-Control: private, max-age=86400' );
		header_remove( 'Pragma' );
		header_remove( 'Expires' );
		if ( 0 === $start && $end === $size - 1 ) {
			readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			exit;
		}
		$fh = fopen( $path, 'rb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		fseek( $fh, $start );
		$left = $end - $start + 1;
		while ( $left > 0 && ! feof( $fh ) ) {
			$chunk = fread( $fh, min( 65536, $left ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput
			$left -= strlen( $chunk );
		}
		fclose( $fh ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}
}

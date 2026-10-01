<?php
/**
 * Meeting media relay: sound and picture go through this site instead of browser-to-browser,
 * so a meeting needs no STUN / TURN server and works on any network that can open the site.
 *
 * Each participant sends small pieces of compressed audio (μ-law, 16 kHz) and the latest camera
 * frame (JPEG) in one POST, and gets back what the others sent since its last call.
 * Storage is plain files under uploads/mp-relay/{meeting}/:
 *   a{peer}-{gen}.log  audio records (seq, length, bytes), rotated every 4 MB
 *   g{peer}            current generation of that peer's audio log
 *   v{peer}.bin        latest video frame (seq + JPEG), replaced atomically
 *   x{peer}            the peer was removed by the host
 *
 * relay.php (plugin root) runs this without loading WordPress, which keeps each call to a few
 * milliseconds; the REST route room/{token}/relay is the fallback. Calls are signed with an HMAC
 * key kept in uploads/mp-relay/key.php.
 */
if ( ! defined( 'ABSPATH' ) && ! defined( 'MP_RELAY' ) ) {
	exit;
}

class MP_Relay {

	const SEG     = 4194304; // audio log rotation size
	const BACKLOG = 65536;   // more unread audio than this (~4 s) → skip to live
	const MAXBODY = 3145728;

	/* ------------------------------------------------------------------ WordPress side */

	public static function base_wp() {
		$u = wp_upload_dir( null, false );
		return $u['basedir'] . '/mp-relay';
	}

	private static function ensure( $base ) {
		if ( ! is_dir( $base ) ) {
			wp_mkdir_p( $base );
		}
		if ( ! file_exists( $base . '/.htaccess' ) ) {
			file_put_contents( $base . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore
			file_put_contents( $base . '/index.php', "<?php\n" ); // phpcs:ignore
		}
		if ( '' === self::key( $base ) ) {
			file_put_contents( $base . '/key.php', '<?php exit; ?>' . bin2hex( random_bytes( 32 ) ) ); // phpcs:ignore
		}
	}

	public static function room_id( $token ) {
		return substr( hash( 'sha256', 'mp-relay|' . $token ), 0, 24 );
	}

	/** Signed query string for one participant (valid 12 hours). */
	public static function issue( $token, $peer ) {
		$base = self::base_wp();
		self::ensure( $base );
		$m = self::room_id( $token );
		if ( ! is_dir( "$base/$m" ) ) {
			mkdir( "$base/$m", 0755 ); // phpcs:ignore
			self::sweep( $base );
		}
		$e = time() + 43200;
		return 'm=' . $m . '&p=' . (int) $peer . '&e=' . $e . '&s=' . hash_hmac( 'sha256', "$m|$peer|$e", self::key( $base ) );
	}

	public static function revoke( $token, $peer ) {
		$d = self::base_wp() . '/' . self::room_id( $token );
		if ( is_dir( $d ) ) {
			touch( "$d/x" . (int) $peer );
		}
	}

	public static function purge( $token ) {
		self::rmdir( self::base_wp() . '/' . self::room_id( $token ) );
	}

	/** Meetings untouched for a day are removed. */
	private static function sweep( $base ) {
		foreach ( (array) glob( $base . '/*', GLOB_ONLYDIR ) as $d ) {
			if ( $d && filemtime( $d ) < time() - DAY_IN_SECONDS ) {
				self::rmdir( $d );
			}
		}
	}

	private static function rmdir( $d ) {
		if ( ! is_dir( $d ) ) {
			return;
		}
		foreach ( (array) glob( $d . '/*' ) as $f ) {
			if ( $f ) {
				unlink( $f ); // phpcs:ignore
			}
		}
		rmdir( $d ); // phpcs:ignore
	}

	/* ------------------------------------------------------------------ The relay itself (no WordPress) */

	private static function key( $base ) {
		$raw = is_file( $base . '/key.php' ) ? (string) file_get_contents( $base . '/key.php' ) : ''; // phpcs:ignore
		return preg_match( '/\?>([a-f0-9]{64})/', $raw, $k ) ? $k[1] : '';
	}

	/** Entry point of relay.php. */
	public static function serve_standalone() {
		header( 'Cache-Control: no-store' );
		header( 'X-Content-Type-Options: nosniff' );
		if ( 'POST' !== ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) ) { // phpcs:ignore
			http_response_code( 405 );
			exit;
		}
		$script = isset( $_SERVER['SCRIPT_FILENAME'] ) ? (string) $_SERVER['SCRIPT_FILENAME'] : ''; // phpcs:ignore
		$base   = '';
		foreach ( array( $script ? dirname( $script, 3 ) : '', dirname( __DIR__, 3 ) ) as $wc ) {
			if ( $wc && is_file( $wc . '/uploads/mp-relay/key.php' ) ) {
				$base = $wc . '/uploads/mp-relay';
				break;
			}
		}
		if ( ! $base ) {
			http_response_code( 503 ); // the page then uses the WordPress route
			exit;
		}
		$res = self::handle( $base, $_GET, (string) file_get_contents( 'php://input', false, null, 0, self::MAXBODY ) ); // phpcs:ignore
		http_response_code( $res[0] );
		header( 'Content-Type: application/octet-stream' );
		echo $res[1]; // phpcs:ignore
		exit;
	}

	/**
	 * Body: u32 json length, json {a:[lengths], as: first audio seq, v: video length, vs: video seq,
	 * c:{peer:[gen,offset]}, vk:{peer:seq}}, then the audio pieces and the video frame.
	 * Reply: u32 json length, json {c, vk, items:[[peer,'a'|'v',seq,length]]}, then the bytes.
	 *
	 * @return array [http status, body]
	 */
	public static function handle( $base, $q, $body ) {
		$m = isset( $q['m'] ) ? (string) $q['m'] : '';
		$p = isset( $q['p'] ) ? (int) $q['p'] : 0;
		$e = isset( $q['e'] ) ? (int) $q['e'] : 0;
		$s = isset( $q['s'] ) ? (string) $q['s'] : '';
		$key = self::key( $base );
		if ( ! preg_match( '/^[a-f0-9]{24}$/', $m ) || ! $p || $e < time() || '' === $key || ! hash_equals( hash_hmac( 'sha256', "$m|$p|$e", $key ), $s ) ) {
			return array( 403, '' );
		}
		$d = "$base/$m";
		if ( ! is_dir( $d ) ) {
			return array( 410, '' ); // meeting ended
		}
		if ( file_exists( "$d/x$p" ) ) {
			return array( 403, '' );
		}
		if ( strlen( $body ) < 4 ) {
			return array( 400, '' );
		}
		$jl  = unpack( 'N', substr( $body, 0, 4 ) );
		$jl  = $jl[1];
		$j   = json_decode( substr( $body, 4, $jl ), true );
		$j   = is_array( $j ) ? $j : array();
		$pos = 4 + $jl;

		// What this participant sends.
		$out = '';
		$seq = isset( $j['as'] ) ? (int) $j['as'] : 0;
		foreach ( isset( $j['a'] ) && is_array( $j['a'] ) ? $j['a'] : array() as $len ) {
			$len = max( 0, min( 65536, (int) $len ) );
			$out .= pack( 'NN', $seq++, $len ) . substr( $body, $pos, $len );
			$pos += $len;
		}
		if ( '' !== $out ) {
			$gen  = self::gen( $d, $p );
			$file = "$d/a$p-$gen.log";
			file_put_contents( $file, $out, FILE_APPEND | LOCK_EX ); // phpcs:ignore
			clearstatcache( true, $file );
			if ( filesize( $file ) > self::SEG ) {
				file_put_contents( "$d/g$p", (string) ( $gen + 1 ) ); // phpcs:ignore
				@unlink( "$d/a$p-" . ( $gen - 1 ) . '.log' ); // phpcs:ignore
			}
		}
		$vl = isset( $j['v'] ) ? (int) $j['v'] : 0;
		if ( $vl > 0 && $vl < 1048576 ) {
			file_put_contents( "$d/v$p.tmp", pack( 'N', (int) $j['vs'] ) . substr( $body, $pos, $vl ) ); // phpcs:ignore
			rename( "$d/v$p.tmp", "$d/v$p.bin" ); // phpcs:ignore
		}
		touch( $d );

		// What the others sent.
		$cur   = isset( $j['c'] ) && is_array( $j['c'] ) ? $j['c'] : array();
		$vk    = isset( $j['vk'] ) && is_array( $j['vk'] ) ? $j['vk'] : array();
		$items = array();
		$data  = '';
		$nc    = array();
		$nvk   = array();
		$ids   = array();
		foreach ( (array) glob( "$d/g*" ) as $f ) {
			$ids[ (int) substr( basename( (string) $f ), 1 ) ] = 'a';
		}
		foreach ( (array) glob( "$d/a*-0.log" ) as $f ) {
			$ids[ (int) substr( basename( (string) $f ), 1 ) ] = 'a';
		}
		foreach ( (array) glob( "$d/v*.bin" ) as $f ) {
			$id = (int) substr( basename( (string) $f ), 1 );
			if ( ! isset( $ids[ $id ] ) ) {
				$ids[ $id ] = 'v';
			}
		}
		unset( $ids[ $p ] );
		foreach ( array_keys( $ids ) as $o ) {
			if ( ! $o || file_exists( "$d/x$o" ) ) {
				continue;
			}
			// Audio.
			$g    = self::gen( $d, $o );
			$c    = isset( $cur[ $o ] ) && is_array( $cur[ $o ] ) ? array( (int) $cur[ $o ][0], (int) $cur[ $o ][1] ) : null;
			$live = "$d/a$o-$g.log";
			if ( null === $c ) {
				clearstatcache( true, $live );
				$c = array( $g, is_file( $live ) ? filesize( $live ) : 0 ); // start at "now"
			}
			while ( $c[0] <= $g ) {
				$f = "$d/a$o-{$c[0]}.log";
				if ( ! is_file( $f ) ) {
					if ( $c[0] < $g ) {
						$c = array( $c[0] + 1, 0 );
						continue;
					}
					break;
				}
				$fh = fopen( $f, 'rb' ); // phpcs:ignore
				flock( $fh, LOCK_SH );
				$size = fstat( $fh )['size'];
				if ( $size - $c[1] > self::BACKLOG ) {
					$c[1] = $size; // too far behind: jump to live instead of playing old sound
				}
				if ( $size > $c[1] ) {
					fseek( $fh, $c[1] );
					$chunk = (string) fread( $fh, $size - $c[1] ); // phpcs:ignore
					$at    = 0;
					while ( $at + 8 <= strlen( $chunk ) ) {
						$h = unpack( 'Nseq/Nlen', substr( $chunk, $at, 8 ) );
						if ( $at + 8 + $h['len'] > strlen( $chunk ) ) {
							break;
						}
						$items[] = array( $o, 'a', $h['seq'], $h['len'] );
						$data   .= substr( $chunk, $at + 8, $h['len'] );
						$at     += 8 + $h['len'];
					}
					$c[1] += $at;
				}
				flock( $fh, LOCK_UN );
				fclose( $fh ); // phpcs:ignore
				if ( $c[0] < $g ) {
					$c = array( $c[0] + 1, 0 );
					continue;
				}
				break;
			}
			$nc[ $o ] = $c;
			// Video: only the newest frame.
			$vf = "$d/v$o.bin";
			if ( is_file( $vf ) ) {
				// Only the 4-byte frame number is read unless the frame is new for this reader.
				$fh  = fopen( $vf, 'rb' ); // phpcs:ignore
				$raw = $fh ? (string) fread( $fh, 4 ) : ''; // phpcs:ignore
				if ( 4 === strlen( $raw ) ) {
					$vs = unpack( 'N', $raw );
					$vs = $vs[1];
					if ( $vs > ( isset( $vk[ $o ] ) ? (int) $vk[ $o ] : 0 ) ) {
						$jpg = (string) stream_get_contents( $fh );
						$items[] = array( $o, 'v', $vs, strlen( $jpg ) );
						$data   .= $jpg;
					}
					$nvk[ $o ] = max( $vs, isset( $vk[ $o ] ) ? (int) $vk[ $o ] : 0 );
				}
				if ( $fh ) {
					fclose( $fh ); // phpcs:ignore
				}
			}
		}
		$json = json_encode( array( 'c' => (object) $nc, 'vk' => (object) $nvk, 'items' => $items ) ); // phpcs:ignore
		return array( 200, pack( 'N', strlen( $json ) ) . $json . $data );
	}

	private static function gen( $d, $p ) {
		return is_file( "$d/g$p" ) ? (int) file_get_contents( "$d/g$p" ) : 0; // phpcs:ignore
	}
}

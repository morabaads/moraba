<?php
/**
 * Meeting media relay: sound and picture go through this site instead of browser-to-browser,
 * so a meeting needs no STUN / TURN server and works on any network that can open the site.
 *
 * Each participant sends its newest sound and picture records in one POST, and gets back what the
 * others sent since its last call. Storage is plain files under uploads/mp-relay/{meeting}/:
 *   l{peer}-{gen}.log  records (u32 length, u8 type, 3 spare bytes, bytes), rotated every 8 MB
 *   g{peer}            current generation of that peer's log
 *   k{peer}            "gen:offset" of the newest picture that can be decoded on its own
 *   x{peer}            the peer was removed by the host
 *   m{peer}            the host muted this peer: its sound is dropped
 *
 * relay.php (plugin root) runs this without loading WordPress, which keeps each call to a few
 * milliseconds; the REST route room/{token}/relay is the fallback. Calls are signed with an HMAC
 * key kept in uploads/mp-relay/key.php.
 */
if ( ! defined( 'ABSPATH' ) && ! defined( 'MP_RELAY' ) ) {
	exit;
}

class MP_Relay {

	const SEG     = 8388608; // log rotation size
	const BACKLOG = 1048576; // more unread than this → skip to the newest keyframe
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
	 * Body: u32 json length, json {r:[[type,length],…] records to add, c:{peer:[gen,offset]} read cursors,
	 * w:{peer:'hi'|'lo'|'off'} wanted video, kf:[peer…] start those from their last keyframe},
	 * then the records' bytes.
	 * Record types: 1 μ-law sound, 2 Opus sound, 3 JPEG frame, 4 video keyframe, 5 video frame.
	 * Reply: u32 json length, json {c, items:[[peer,type,length]]}, then the bytes.
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
		$muted = file_exists( "$d/m$p" );
		$out   = '';
		$keyAt = -1;
		foreach ( isset( $j['r'] ) && is_array( $j['r'] ) ? $j['r'] : array() as $rec ) {
			$type = isset( $rec[0] ) ? (int) $rec[0] : 0;
			$len  = isset( $rec[1] ) ? max( 0, min( 1048576, (int) $rec[1] ) ) : 0;
			$data = substr( $body, $pos, $len );
			$pos += $len;
			if ( $type < 1 || $type > 5 || strlen( $data ) !== $len || ( $muted && $type <= 2 ) ) {
				continue;
			}
			if ( 3 === $type || 4 === $type ) {
				$keyAt = strlen( $out );
			}
			$out .= pack( 'NCCn', $len, $type, 0, 0 ) . $data;
		}
		if ( '' !== $out ) {
			$gen = self::gen( $d, $p );
			$fh  = fopen( "$d/l$p-$gen.log", 'ab' ); // phpcs:ignore
			if ( $fh ) {
				flock( $fh, LOCK_EX );
				$at = fstat( $fh )['size'];
				fwrite( $fh, $out ); // phpcs:ignore
				fflush( $fh );
				flock( $fh, LOCK_UN );
				fclose( $fh ); // phpcs:ignore
				if ( $keyAt >= 0 ) {
					file_put_contents( "$d/k$p", $gen . ':' . ( $at + $keyAt ) ); // phpcs:ignore
				}
				if ( $at + strlen( $out ) > self::SEG ) {
					file_put_contents( "$d/g$p", (string) ( $gen + 1 ) ); // phpcs:ignore
					@unlink( "$d/l$p-" . ( $gen - 1 ) . '.log' ); // phpcs:ignore
				}
			}
		}
		touch( $d );

		// What the others sent.
		$cur   = isset( $j['c'] ) && is_array( $j['c'] ) ? $j['c'] : array();
		$wants = isset( $j['w'] ) && is_array( $j['w'] ) ? $j['w'] : array();
		$kf    = isset( $j['kf'] ) && is_array( $j['kf'] ) ? array_map( 'intval', $j['kf'] ) : array();
		$items = array();
		$data  = '';
		$nc    = array();
		$ids   = array();
		foreach ( (array) glob( "$d/l*-*.log" ) as $f ) {
			$ids[ (int) substr( basename( (string) $f ), 1 ) ] = 1;
		}
		unset( $ids[ $p ] );
		foreach ( array_keys( $ids ) as $o ) {
			if ( ! $o || file_exists( "$d/x$o" ) ) {
				continue;
			}
			$g     = self::gen( $d, $o );
			$live  = "$d/l$o-$g.log";
			clearstatcache( true, $live );
			$end   = array( $g, is_file( $live ) ? filesize( $live ) : 0 );
			$noVid = isset( $wants[ $o ] ) && 'off' === $wants[ $o ];
			$c     = isset( $cur[ $o ] ) && is_array( $cur[ $o ] ) ? array( (int) $cur[ $o ][0], (int) $cur[ $o ][1] ) : null;
			$jump  = null === $c || in_array( $o, $kf, true ) || ( $c[0] === $g && $end[1] - $c[1] > self::BACKLOG ) || $c[0] < $g - 1;
			$soundFrom = $c ? $c : $end;
			if ( $jump ) {
				// Start at the newest keyframe so the picture can be decoded, but play no old sound.
				$soundFrom = $end;
				$c         = $end;
				$k         = is_file( "$d/k$o" ) ? explode( ':', (string) file_get_contents( "$d/k$o" ) ) : array(); // phpcs:ignore
				if ( 2 === count( $k ) && ! $noVid && (int) $k[0] >= $g - 1 && is_file( "$d/l$o-" . (int) $k[0] . '.log' ) ) {
					$c = array( (int) $k[0], (int) $k[1] );
				}
			}
			while ( $c[0] <= $g ) {
				$f = "$d/l$o-{$c[0]}.log";
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
				if ( $size > $c[1] ) {
					fseek( $fh, $c[1] );
					$chunk = (string) fread( $fh, min( $size - $c[1], 4194304 ) ); // phpcs:ignore
					$at    = 0;
					while ( $at + 8 <= strlen( $chunk ) ) {
						$h = unpack( 'Nlen/Ctype', substr( $chunk, $at, 5 ) );
						if ( $at + 8 + $h['len'] > strlen( $chunk ) ) {
							break;
						}
						$here  = array( $c[0], $c[1] + $at );
						$sound = $h['type'] <= 2;
						$older = $here[0] < $soundFrom[0] || ( $here[0] === $soundFrom[0] && $here[1] < $soundFrom[1] );
						if ( ! ( $sound && $older ) && ! ( ! $sound && $noVid ) ) {
							$items[] = array( $o, $h['type'], $h['len'] );
							$data   .= substr( $chunk, $at + 8, $h['len'] );
						}
						$at += 8 + $h['len'];
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
		}
		$json = json_encode( array( 'c' => (object) $nc, 'items' => $items ) ); // phpcs:ignore
		return array( 200, pack( 'N', strlen( $json ) ) . $json . $data );
	}

	/** Host-enforced mute: the relay drops this person's sound until it is lifted. */
	public static function mute( $token, $peer, $on ) {
		$d = self::base_wp() . '/' . self::room_id( $token );
		if ( ! is_dir( $d ) ) {
			return;
		}
		if ( $on ) {
			touch( "$d/m" . (int) $peer );
		} elseif ( file_exists( "$d/m" . (int) $peer ) ) {
			unlink( "$d/m" . (int) $peer ); // phpcs:ignore
		}
	}

	private static function gen( $d, $p ) {
		return is_file( "$d/g$p" ) ? (int) file_get_contents( "$d/g$p" ) : 0; // phpcs:ignore
	}
}

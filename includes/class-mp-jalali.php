<?php
defined( 'ABSPATH' ) || exit;

/** Jalali ⇄ Gregorian conversion (same algorithm as assets/js/jalali.js). */
class MP_Jalali {

	const MONTHS   = array( 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند' );
	const WEEKDAYS = array( 'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه' );

	private static function div( $a, $b ) {
		return intdiv( $a, $b );
	}

	private static function mod( $a, $b ) {
		return $a - intdiv( $a, $b ) * $b;
	}

	private static function cal( $jy ) {
		$breaks = array( -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178 );
		$gy     = $jy + 621;
		$leap_j = -14;
		$jp     = $breaks[0];
		$jump   = 0;
		$count  = count( $breaks );
		for ( $i = 1; $i < $count; $i++ ) {
			$jm   = $breaks[ $i ];
			$jump = $jm - $jp;
			if ( $jy < $jm ) {
				break;
			}
			$leap_j += self::div( $jump, 33 ) * 8 + self::div( self::mod( $jump, 33 ), 4 );
			$jp      = $jm;
		}
		$n       = $jy - $jp;
		$leap_j += self::div( $n, 33 ) * 8 + self::div( self::mod( $n, 33 ) + 3, 4 );
		if ( 4 === self::mod( $jump, 33 ) && 4 === $jump - $n ) {
			++$leap_j;
		}
		$leap_g = self::div( $gy, 4 ) - self::div( ( self::div( $gy, 100 ) + 1 ) * 3, 4 ) - 150;
		$march  = 20 + $leap_j - $leap_g;
		if ( $jump - $n < 6 ) {
			$n = $n - $jump + self::div( $jump + 4, 33 ) * 33;
		}
		$leap = self::mod( self::mod( $n + 1, 33 ) - 1, 4 );
		if ( -1 === $leap ) {
			$leap = 4;
		}
		return array( $leap, $gy, $march );
	}

	private static function g2d( $gy, $gm, $gd ) {
		$d = self::div( ( $gy + self::div( $gm - 8, 6 ) + 100100 ) * 1461, 4 ) + self::div( 153 * self::mod( $gm + 9, 12 ) + 2, 5 ) + $gd - 34840408;
		return $d - self::div( self::div( $gy + 100100 + self::div( $gm - 8, 6 ), 100 ) * 3, 4 ) + 752;
	}

	private static function d2g( $jdn ) {
		$j  = 4 * $jdn + 139361631;
		$j  = $j + self::div( self::div( 4 * $jdn + 183187720, 146097 ) * 3, 4 ) * 4 - 3908;
		$i  = self::div( self::mod( $j, 1461 ), 4 ) * 5 + 308;
		$gd = self::div( self::mod( $i, 153 ), 5 ) + 1;
		$gm = self::mod( self::div( $i, 153 ), 12 ) + 1;
		$gy = self::div( $j, 1461 ) - 100100 + self::div( 8 - $gm, 6 );
		return array( $gy, $gm, $gd );
	}

	/** @return int[] [jy, jm, jd] for a 'Y-m-d' Gregorian date. */
	public static function from_iso( $iso ) {
		list( $y, $m, $d ) = array_map( 'intval', explode( '-', substr( $iso, 0, 10 ) ) );
		$jdn               = self::g2d( $y, $m, $d );
		$gy                = self::d2g( $jdn )[0];
		$jy                = $gy - 621;
		$r                 = self::cal( $jy );
		$k                 = $jdn - self::g2d( $gy, 3, $r[2] );
		if ( $k >= 0 ) {
			if ( $k <= 185 ) {
				return array( $jy, 1 + self::div( $k, 31 ), self::mod( $k, 31 ) + 1 );
			}
			$k -= 186;
		} else {
			--$jy;
			$k += 179;
			if ( 1 === $r[0] ) {
				++$k;
			}
		}
		return array( $jy, 7 + self::div( $k, 30 ), self::mod( $k, 30 ) + 1 );
	}

	public static function to_iso( $jy, $jm, $jd ) {
		$r   = self::cal( $jy );
		$jdn = self::g2d( $r[1], 3, $r[2] ) + ( $jm - 1 ) * 31 - self::div( $jm, 7 ) * ( $jm - 7 ) + $jd - 1;
		list( $gy, $gm, $gd ) = self::d2g( $jdn );
		return sprintf( '%04d-%02d-%02d', $gy, $gm, $gd );
	}

	public static function month_length( $jy, $jm ) {
		if ( $jm <= 6 ) {
			return 31;
		}
		if ( $jm <= 11 ) {
			return 30;
		}
		return 0 === self::cal( $jy )[0] ? 30 : 29;
	}

	public static function digits( $s ) {
		return strtr( (string) $s, array( '0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴', '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹' ) );
	}

	/** '۸ مهر ۱۴۰۵' */
	public static function format( $iso ) {
		if ( ! $iso ) {
			return '';
		}
		list( $jy, $jm, $jd ) = self::from_iso( $iso );
		return self::digits( $jd ) . ' ' . self::MONTHS[ $jm - 1 ] . ' ' . self::digits( $jy );
	}

	/** Gregorian start and end of the Jalali month containing $iso, shifted by $offset months. */
	public static function month_range( $iso, $offset = 0 ) {
		list( $jy, $jm ) = self::from_iso( $iso );
		$jm += $offset;
		while ( $jm < 1 ) {
			$jm += 12;
			--$jy;
		}
		while ( $jm > 12 ) {
			$jm -= 12;
			++$jy;
		}
		return array( self::to_iso( $jy, $jm, 1 ), self::to_iso( $jy, $jm, self::month_length( $jy, $jm ) ), self::MONTHS[ $jm - 1 ] . ' ' . self::digits( $jy ) );
	}
}

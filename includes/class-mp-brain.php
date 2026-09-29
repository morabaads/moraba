<?php
defined( 'ABSPATH' ) || exit;

/**
 * «دستیار مربع» without any outside AI service: a Persian language engine built for this panel.
 *
 * How it understands a sentence:
 *  1. Normalize (digits, ی/ک, spacing, spoken forms like «میخوام»، «بذار»، «رو»).
 *  2. Split compound requests («… و به رضا بگو …»، «بعدش …») into clauses that each carry a verb.
 *  3. Pull out entities: people (full/first/last name, «من/خودم»، «همه»), projects, groups, dates
 *     (امروز، پس‌فردا، شنبه بعد، ۷ مهر، ۳ روز دیگه، آخر هفته), times (ساعت ۱۰ و نیم، ۵ عصر، ۲ ساعت دیگه),
 *     amounts (۱۳۰ تومن، دو میلیون و پونصد)، quoted text and «… که …» message bodies.
 *  4. Score every intent by its verbs and nouns, pick the best, fill its slots from the entities and the
 *     leftover words (the title), and remember the last person/task/group for «بهش بگو»، «اون تسک».
 *  5. Reading intents answer at once in natural Persian; changes become confirm cards and run through
 *     MP_AI::run, i.e. the panel's own REST routes with the person's own permissions.
 */
class MP_Brain {

	const DAYS   = array( 'شنبه' => 6, 'یکشنبه' => 0, 'دوشنبه' => 1, 'سهشنبه' => 2, 'سه شنبه' => 2, 'چهارشنبه' => 3, 'پنجشنبه' => 4, 'پنج شنبه' => 4, 'جمعه' => 5 );
	const MONTHS = array( 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند' );

	/** Conversation memory (per person, a few hours): last person, task, group, pending changes. */
	private static $mem = array();

	private static function mem_load() {
		$m         = get_transient( 'mp_brain_' . get_current_user_id() );
		self::$mem = is_array( $m ) ? $m : array( 'pending' => array() );
	}

	private static function mem_save() {
		set_transient( 'mp_brain_' . get_current_user_id(), self::$mem, 6 * HOUR_IN_SECONDS );
	}

	/* ================================================================== Text */

	public static function normalize( $s ) {
		$s = J_latin( (string) $s );
		$s = strtr( $s, array( '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9', 'ي' => 'ی', 'ك' => 'ک', 'ة' => 'ه', 'ۀ' => 'ه', 'أ' => 'ا', 'إ' => 'ا', 'ؤ' => 'و' ) );
		$s = str_replace( array( "\xE2\x80\x8C", "\xE2\x80\x8F", "\xE2\x80\x8E" ), ' ', $s ); // ZWNJ and marks → space
		$s = preg_replace( '/[؟?!،,؛;]+/u', ' ', $s );
		$s = preg_replace( '/\s+/u', ' ', trim( $s ) );
		// Colloquial → written, so fewer patterns are needed.
		$map = array(
			'/\bمیخوام\b/u' => 'می خواهم', '/\bمی خوام\b/u' => 'می خواهم', '/\bبزار\b/u' => 'بذار', '/\bبگذار\b/u' => 'بذار', '/\bبذارید\b/u' => 'بذار',
			'/\bپونصد\b/u' => 'پانصد', '/\bتومن\b/u' => 'تومان', '/\bتومنی\b/u' => 'تومان', '/\bیه\b/u' => 'یک', '/\bدیگه\b/u' => 'دیگر',
			'/\bبعدازظهر\b/u' => 'بعد از ظهر', '/\bپسفردا\b/u' => 'پس فردا', '/\bسه شنبه\b/u' => 'سهشنبه', '/\bپنج شنبه\b/u' => 'پنجشنبه', '/\bیک شنبه\b/u' => 'یکشنبه',
			'/\bچهار شنبه\b/u' => 'چهارشنبه', '/\bدو شنبه\b/u' => 'دوشنبه', '/\bهفته ی\b/u' => 'هفته', '/\bتسکها\b/u' => 'تسک ها', '/\bکارهام\b/u' => 'کار ها من',
			'/\bتسکام\b/u' => 'تسک ها من', '/\bتسکهام\b/u' => 'تسک ها من', '/\bپیامهام\b/u' => 'پیام ها من',
		);
		return preg_replace( array_keys( $map ), array_values( $map ), $s );
	}

	private static function words() {
		return array(
			'یک' => 1, 'یه' => 1, 'دو' => 2, 'سه' => 3, 'چهار' => 4, 'پنج' => 5, 'شش' => 6, 'شیش' => 6, 'هفت' => 7, 'هشت' => 8, 'نه' => 9, 'ده' => 10,
			'یازده' => 11, 'دوازده' => 12, 'سیزده' => 13, 'چهارده' => 14, 'پانزده' => 15, 'پونزده' => 15, 'شانزده' => 16, 'شونزده' => 16, 'هفده' => 17, 'هیفده' => 17, 'هجده' => 18, 'هیجده' => 18, 'نوزده' => 19,
			'بیست' => 20, 'سی' => 30, 'چهل' => 40, 'پنجاه' => 50, 'شصت' => 60, 'هفتاد' => 70, 'هشتاد' => 80, 'نود' => 90,
			'صد' => 100, 'یکصد' => 100, 'دویست' => 200, 'سیصد' => 300, 'چهارصد' => 400, 'پانصد' => 500, 'ششصد' => 600, 'هفتصد' => 700, 'هشتصد' => 800, 'نهصد' => 900,
		);
	}

	/** «دو میلیون و پانصد هزار» → «2500000»; «ساعت ده و نیم» keeps «و نیم» for the time reader. */
	private static function numbers( $t ) {
		$w     = self::words();
		$scale = array( 'هزار' => 1000, 'میلیون' => 1000000, 'میلیارد' => 1000000000 );
		$tok   = explode( ' ', $t );
		$out   = array();
		for ( $i = 0; $i < count( $tok ); $i++ ) {
			if ( ! isset( $w[ $tok[ $i ] ] ) && ! is_numeric( $tok[ $i ] ) ) {
				$out[] = $tok[ $i ];
				continue;
			}
			// Read a run: number words / digits joined by «و», with scales.
			$total = 0;
			$part  = 0;
			$last  = 0;
			$j     = $i;
			$used  = false;
			while ( $j < count( $tok ) ) {
				$x = $tok[ $j ];
				if ( isset( $w[ $x ] ) || is_numeric( $x ) ) {
					if ( $used && $part && ! isset( $w[ $x ] ) ) {
						break; // two digit groups in a row: separate numbers
					}
					$part += is_numeric( $x ) ? (float) $x : $w[ $x ];
					$used  = true;
					++$j;
				} elseif ( isset( $scale[ $x ] ) && $used ) {
					$total += ( $part ? $part : 1 ) * $scale[ $x ];
					$last   = $scale[ $x ];
					$part   = 0;
					++$j;
				} elseif ( 'و' === $x && $used && isset( $tok[ $j + 1 ] ) && ( isset( $w[ $tok[ $j + 1 ] ] ) || isset( $scale[ $tok[ $j + 1 ] ] ) ) && ! in_array( $tok[ $j + 1 ], array( 'نیم', 'ربع' ), true ) ) {
					++$j;
				} else {
					break;
				}
			}
			// «دو میلیون و پانصد» means 2,500,000: a bare remainder takes the next smaller scale.
			if ( $last >= 1000000 && $part > 0 && $part < 1000 ) {
				$part *= $last / 1000;
			}
			$out[] = (string) ( $total + $part );
			$i     = $j - 1;
		}
		return implode( ' ', $out );
	}

	/* ================================================================== Entities */

	/** People mentioned: [[id, phrase]] in order; «من/خودم» → me; «همه» → everyone. */
	private static function people( $t ) {
		$found = array();
		$me    = get_current_user_id();
		$cands = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$u = get_userdata( $id );
			if ( ! $u ) {
				continue;
			}
			$full    = MP_AI::norm( self::normalize( $u->display_name ) );
			$parts   = explode( ' ', $full );
			$cands[] = array( $full, $id, 3 );
			if ( count( $parts ) > 1 ) {
				$cands[] = array( $parts[0], $id, 2 );
				$cands[] = array( end( $parts ), $id, 1 );
			}
		}
		usort( $cands, function ( $a, $b ) { return mb_strlen( $b[0] ) - mb_strlen( $a[0] ); } );
		$taken = $t;
		foreach ( $cands as $c ) {
			if ( mb_strlen( $c[0] ) < 2 ) {
				continue;
			}
			$re = '/(^|\s)(?:به |با |برای |از |واسه )?' . preg_quote( $c[0], '/' ) . '(?:\s?(?:و|رو|را|ی|جان|جون|هم))?(?=\s|$)/u';
			if ( preg_match( $re, $taken, $m, PREG_OFFSET_CAPTURE ) ) {
				// A shared first name is only certain when one person has it.
				$same = array_filter( $cands, function ( $x ) use ( $c ) { return $x[0] === $c[0]; } );
				if ( count( array_unique( array_column( $same, 1 ) ) ) > 1 ) {
					$found[] = array( 'ambiguous' => array_values( array_unique( array_column( $same, 1 ) ) ), 'phrase' => $c[0], 'pos' => $m[0][1] );
				} else {
					$found[] = array( 'id' => (int) $c[1], 'phrase' => trim( $m[0][0] ), 'pos' => $m[0][1] );
				}
				$taken = substr_replace( $taken, str_repeat( '_', strlen( $m[0][0] ) ), $m[0][1], strlen( $m[0][0] ) );
			}
		}
		if ( preg_match( '/(^|\s)(من|خودم|منو|خود من)(?=\s|$)/u', $taken, $m, PREG_OFFSET_CAPTURE ) ) {
			$found[] = array( 'id' => $me, 'phrase' => $m[2][0], 'pos' => $m[2][1], 'me' => true );
		}
		if ( preg_match( '/(^|\s)(همه ی بچه ها|همه بچه ها|همه ی اعضا|همه اعضا|کل تیم|همه ی تیم|همه)(?=\s|$)/u', $taken, $m, PREG_OFFSET_CAPTURE ) ) {
			$found[] = array( 'all' => true, 'phrase' => $m[2][0], 'pos' => $m[2][1] );
		}
		usort( $found, function ( $a, $b ) { return $a['pos'] - $b['pos']; } );
		return $found;
	}

	/** Best project named in the text: [id, name, phrase] or null. */
	private static function project_in( $t ) {
		global $wpdb;
		$best = null;
		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . MP_Install::table( 'projects' ) ) as $p ) {
			$n = MP_AI::norm( self::normalize( $p->name ) );
			// Full name, name without brackets, or its most distinctive words (≥3 letters, not generic).
			$variants = array( $n, trim( preg_replace( '/\(.*?\)/u', '', $n ) ) );
			$generic  = array( 'افزونه', 'سایت', 'قالب', 'پروژه', 'پنل', 'اپ', 'اپلیکیشن', 'کاربری', 'فروشگاه', 'طراحی', 'امور', 'تیمی', 'گزارش', 'و', 'اصلاحات', 'تحویل' );
			foreach ( explode( ' ', $variants[1] ) as $w ) {
				if ( mb_strlen( $w ) >= 3 && ! in_array( $w, $generic, true ) ) {
					$variants[] = $w;
				}
			}
			foreach ( $variants as $k => $v ) {
				if ( '' === $v ) {
					continue;
				}
				if ( preg_match( '/(^|\s)(?:پروژه |پروژه ی )?' . preg_quote( $v, '/' ) . '(?=\s|$)/u', $t, $m ) ) {
					$score = mb_strlen( $v ) + ( $k < 2 ? 100 : 0 );
					if ( ! $best || $score > $best[3] ) {
						$best = array( (int) $p->id, $p->name, trim( $m[0] ), $score );
					}
				}
			}
		}
		return $best;
	}

	/** A team/client group or project chat named in the text: [id, title, phrase]. */
	private static function group_in( $t ) {
		$list = MP_AI::call( 'GET', 'channels' );
		$best = null;
		foreach ( is_wp_error( $list ) ? array() : $list as $c ) {
			if ( 'direct' === $c['type'] ) {
				continue;
			}
			$n = MP_AI::norm( self::normalize( $c['title'] ) );
			if ( '' !== $n && preg_match( '/(^|\s)(?:گروه |گروه ی )?' . preg_quote( $n, '/' ) . '(?=\s|$)/u', $t, $m ) && ( ! $best || mb_strlen( $n ) > mb_strlen( $best[1] ) ) ) {
				$best = array( (int) $c['id'], $c['title'], trim( $m[0] ), $c );
			}
		}
		return $best;
	}

	/** Date in the text: [iso, phrase] or null. */
	public static function date_in( $t ) {
		$today = MP_Util::today();
		$rel   = array( 'پس فردا' => 2, 'پریروز' => -2, 'فردا' => 1, 'دیروز' => -1, 'امروز' => 0, 'امشب' => 0, 'امروزه' => 0 );
		foreach ( $rel as $w => $n ) {
			if ( preg_match( '/(^|\s)(' . $w . ')(?=\s|$)/u', $t, $m ) ) {
				return array( MP_Util::add_days( $today, $n ), $m[2] );
			}
		}
		if ( preg_match( '/(\d{1,3}) (روز|هفته|ماه) (دیگر|بعد|آینده)/u', $t, $m ) ) {
			$n = (int) $m[1] * ( 'روز' === $m[2] ? 1 : ( 'هفته' === $m[2] ? 7 : 30 ) );
			return array( MP_Util::add_days( $today, $n ), $m[0] );
		}
		if ( preg_match( '/(\d{1,3}) روز پیش/u', $t, $m ) ) {
			return array( MP_Util::add_days( $today, -(int) $m[1] ), $m[0] );
		}
		if ( preg_match( '/آخر (این )?هفته/u', $t, $m ) ) {
			$dow = (int) gmdate( 'w', strtotime( $today . ' UTC' ) );
			return array( MP_Util::add_days( $today, ( 4 - $dow + 7 ) % 7 ), $m[0] );
		}
		// Weekday, optionally «هفته بعد/آینده» or «این».
		$names = implode( '|', array_map( function ( $x ) { return preg_quote( $x, '/' ); }, array_keys( self::DAYS ) ) );
		if ( preg_match( '/(این |همین )?(' . $names . ')( هفته)?( بعد| آینده| دیگر)?(?=\s|$)/u', $t, $m ) ) {
			$want = self::DAYS[ $m[2] ];
			$dow  = (int) gmdate( 'w', strtotime( $today . ' UTC' ) );
			$diff = ( $want - $dow + 7 ) % 7;
			if ( 0 === $diff && empty( $m[1] ) ) {
				$diff = 7;
			}
			if ( ! empty( $m[4] ) ) {
				// «شنبه بعد» = the one in next (Saturday-based) week.
				$sat_this = ( $dow + 1 ) % 7;
				$days_to_next_sat = 7 - $sat_this;
				$idx  = ( $want + 1 ) % 7;
				$diff = $days_to_next_sat + $idx;
			}
			return array( MP_Util::add_days( $today, $diff ), trim( $m[0] ) );
		}
		// «۷ مهر», «۷ مهر ۱۴۰۵», «هفتم مهر»
		$months = implode( '|', self::MONTHS );
		if ( preg_match( '/(\d{1,2})(?:م|ام)? (' . $months . ')(?: ماه)?(?: (\d{4}))?/u', $t, $m ) ) {
			list( $jy ) = MP_Jalali::from_iso( $today );
			$jm = array_search( $m[2], self::MONTHS, true ) + 1;
			$y  = ! empty( $m[3] ) ? (int) $m[3] : $jy;
			$iso = MP_Jalali::to_iso( $y, $jm, (int) $m[1] );
			if ( empty( $m[3] ) && $iso < MP_Util::add_days( $today, -60 ) ) {
				$iso = MP_Jalali::to_iso( $y + 1, $jm, (int) $m[1] );
			}
			return array( $iso, $m[0] );
		}
		if ( preg_match( '/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/u', $t, $m ) ) {
			return array( MP_AI::date( $m[0] ), $m[0] );
		}
		if ( preg_match( '/(^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/u', $t, $m ) ) {
			list( $jy ) = MP_Jalali::from_iso( $today );
			return array( MP_Jalali::to_iso( $jy, (int) $m[2], (int) $m[3] ), trim( $m[0] ) );
		}
		if ( preg_match( '/هفته (بعد|آینده|دیگر)/u', $t, $m ) ) {
			return array( MP_Util::add_days( $today, 7 ), $m[0] );
		}
		return null;
	}

	/** Time in the text: [HH:MM, phrase, date shift] or null. */
	public static function time_in( $t ) {
		$now = current_time( 'H:i' );
		if ( preg_match( '/(\d{1,3}) (دقیقه|ساعت) (دیگر|بعد)/u', $t, $m ) ) {
			$mins = (int) $m[1] * ( 'ساعت' === $m[2] ? 60 : 1 );
			list( $h, $i ) = array_map( 'intval', explode( ':', $now ) );
			$total = $h * 60 + $i + $mins;
			return array( sprintf( '%02d:%02d', intdiv( $total, 60 ) % 24, $total % 60 ), trim( $m[0] ), (int) floor( $total / 1440 ) );
		}
		$h = null;
		$i = 0;
		$p = '';
		if ( preg_match( '/(?:ساعت )?(\d{1,2}):(\d{2})/u', $t, $m ) ) {
			$h = (int) $m[1];
			$i = (int) $m[2];
			$p = $m[0];
		} elseif ( preg_match( '/ساعت (\d{1,2})(?: و (نیم|ربع|(\d{1,2}) دقیقه))?/u', $t, $m ) || preg_match( '/(?:^|\s)(\d{1,2})(?: و (نیم|ربع))? (صبح|ظهر|بعد از ظهر|عصر|شب)/u', $t, $m ) ) {
			$h = (int) $m[1];
			$i = isset( $m[2] ) ? ( 'نیم' === $m[2] ? 30 : ( 'ربع' === $m[2] ? 15 : ( isset( $m[3] ) && is_numeric( $m[3] ) ? (int) $m[3] : 0 ) ) ) : 0;
			$p = trim( $m[0] );
		} elseif ( preg_match( '/(^|\s)(ظهر)(?=\s|$)/u', $t, $m ) ) {
			return array( '12:00', $m[2], 0 );
		}
		if ( null === $h || $h > 23 ) {
			return null;
		}
		if ( preg_match( '/(بعد از ظهر|عصر|شب)/u', $t ) && $h < 12 ) {
			$h += 12;
		} elseif ( ! preg_match( '/صبح/u', $t ) && $h >= 1 && $h <= 6 ) {
			$h += 12; // «ساعت ۵» at work means 17:00
		}
		foreach ( array( 'صبح', 'بعد از ظهر', 'عصر', 'شب' ) as $w ) {
			if ( false !== mb_strpos( $t, $p . ' ' . $w ) ) {
				$p .= ' ' . $w;
			}
		}
		return array( sprintf( '%02d:%02d', $h % 24, $i ), $p, 0 );
	}

	/** Amount in toman: [int, phrase] or null. */
	private static function amount_in( $t ) {
		if ( preg_match( '/(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار|تومان|ریال|تومنی)?(?:\s*(تومان|ریال))?/u', $t, $m ) && ( ! empty( $m[2] ) || ! empty( $m[3] ) || (float) $m[1] >= 1000 ) ) {
			$v    = (float) $m[1];
			$unit = ! empty( $m[2] ) ? $m[2] : '';
			if ( 'میلیارد' === $unit ) {
				$v *= 1000000000;
			} elseif ( 'میلیون' === $unit ) {
				$v *= 1000000;
			} elseif ( 'هزار' === $unit ) {
				$v *= 1000;
			} elseif ( ( 'تومان' === $unit || empty( $unit ) && ! empty( $m[3] ) ) && $v < 1000 ) {
				$v *= 1000; // spoken «۱۳۰ تومن» = 130,000 toman
			}
			if ( 'ریال' === $unit || ( ! empty( $m[3] ) && 'ریال' === $m[3] ) ) {
				$v /= 10;
			}
			return array( (int) round( $v ), trim( $m[0] ) );
		}
		return null;
	}

	/** Text inside «» or "" or after «:». */
	private static function quoted( $t ) {
		if ( preg_match( '/[«"](.+?)[»"]/u', $t, $m ) ) {
			return trim( $m[1] );
		}
		return null;
	}

	private static function strip( $t, array $phrases, array $fillers = array() ) {
		foreach ( $phrases as $p ) {
			$p = trim( (string) $p );
			if ( '' !== $p ) {
				$t = preg_replace( '/(^|\s)' . preg_quote( $p, '/' ) . '(?=\s|$)/u', ' ', $t, 1 );
			}
		}
		if ( $fillers ) {
			$t = preg_replace( '/(^|\s)(' . implode( '|', array_map( function ( $f ) { return preg_quote( $f, '/' ); }, $fillers ) ) . ')(?=\s|$)/u', ' ', $t );
			$t = preg_replace( '/(^|\s)(' . implode( '|', array_map( function ( $f ) { return preg_quote( $f, '/' ); }, $fillers ) ) . ')(?=\s|$)/u', ' ', $t );
		}
		return trim( preg_replace( '/\s+/u', ' ', $t ) );
	}

	/* ================================================================== Intents */

	/** intent => [score patterns] ; a pattern hit adds its weight. */
	private static function intents() {
		return array(
			'greet'        => array( '/^(سلام|درود|صبح بخیر|عصر بخیر|شب بخیر|خسته نباشی|hi|hello)/u' => 5 ),
			'thanks'       => array( '/^(مرسی|ممنون|متشکرم|دمت گرم|تشکر|عالی بود|آفرین)/u' => 5 ),
			'help'         => array( '/(چه کار(ی)? (ها )?(بلدی|می تونی|میتونی|می توانی)|کمک|راهنما|چی بلدی|help)/u' => 6 ),
			'clock_in'     => array( '/(^|\s)(ورود|ورودم|اومدم|آمدم|رسیدم|حضورم|حضور)(\s|$)/u' => 4, '/ثبت ورود|ورود(م)? (را |رو )?(ثبت|بزن)/u' => 4 ),
			'clock_out'    => array( '/(^|\s)(خروج|خروجم|رفتم|دارم می رم|دارم میرم|تموم کردم کارمو)(\s|$)/u' => 5 ),
			'create_group' => array( '/(گروه|گپ|گروپ)/u' => 3, '/(بساز|درست کن|ایجاد کن|راه بنداز|تشکیل بده|بزن)/u' => 2, '/(بین|با)/u' => 1 ),
			'group_add'    => array( '/(گروه)/u' => 2, '/(اضافه کن|اد کن|عضو کن|بیار تو|ببر تو)/u' => 3 ),
			'message'      => array( '/(پیام|پیغام|مسیج|بنویس)/u' => 3, '/(^|\s)به .+ (بگو|بنویس|خبر بده|اطلاع بده|پیام بده|پیام بفرست|بپرس)/u' => 5, '/(بگو|خبر بده|اطلاع بده|بپرس)/u' => 2 ),
			'task_create'  => array( '/(تسک|کار|وظیفه)/u' => 2, '/(بذار|بساز|تعریف کن|اضافه کن|ثبت کن|تعیین کن|محول کن|بده به)/u' => 2, '/(برای .+ (بذار|تعریف کن|ثبت کن))/u' => 1 ),
			'task_done'    => array( '/(انجام (شد|دادم)|تموم (شد|کردم)|تمام (شد|کردم)|تیک بزن|دان کن|done)/u' => 5, '/(تسک|کار)/u' => 1 ),
			'task_move'    => array( '/(ببر|منتقل کن|جابجا کن|جا به جا کن|بنداز|عقب بنداز|بیار|بکش)/u' => 3, '/(تسک|کار)/u' => 2, '/(به|برای) (فردا|پس فردا|شنبه|یکشنبه|دوشنبه|سهشنبه|چهارشنبه|پنجشنبه|جمعه|\d)/u' => 1 ),
			'task_archive' => array( '/(آرشیو کن|حذف کن|پاک کن|بردار|کنسل کن|لغو کن)/u' => 4, '/(تسک|کار)/u' => 1 ),
			'task_list'    => array( '/(چه کار(ی)?( ها| هایی| ایی| های)? (دارم|داره|داریم)|چه کارهایی|چه کارایی|کارهای (امروز|فردا)|تسک ها|کار ها|برنامه (امروز|فردا|من|هفته)|چی دارم|چیکار دارم|عقب افتاده|مونده|باقی مونده)/u' => 4, '/(نشون بده|بگو|لیست|چیه|چیا|کدوم)/u' => 1 ),
			'reminder'     => array( '/(یادم (بنداز|بیار|باشه)|یادآوری|یاد آوری|آلارم|هشدار بده)/u' => 6 ),
			'meeting'      => array( '/(جلسه|میتینگ|meeting|قرار ملاقات|ویدیو کال|تماس تصویری)/u' => 4, '/(بذار|بساز|تنظیم کن|هماهنگ کن|ست کن)/u' => 2 ),
			'meeting_list' => array( '/(جلسه|جلسات)/u' => 3, '/(دارم|داریم|کی|چه|امروز|فردا)/u' => 1, '/(بذار|بساز|تنظیم|هماهنگ)/u' => -4 ),
			'leave'        => array( '/(مرخصی|نمیام|نمی آیم|غیبت)/u' => 6 ),
			'ledger'       => array( '/(خرج|هزینه|خرید|پرداخت کردم|دادم|واریز|دخل|درآمد|گرفتم|دریافت)/u' => 3, '/(تومان|ریال|میلیون|هزار)/u' => 3 ),
			'money_report' => array( '/(چقدر (خرج|دخل|درآمد|پول)|موجودی|وضعیت مالی|حساب ها|مالی (این|ماه|هفته)|سود)/u' => 6 ),
			'daily_report' => array( '/(گزارش روزانه|گزارش امروز|گزارش کار)/u' => 5, '/(بنویس|ثبت کن|:)/u' => 1 ),
			'weekly'       => array( '/(گزارش هفتگی|وضعیت تیم|تیم چطوره|کی چقدر کار کرده|عملکرد تیم|این هفته چطور)/u' => 6 ),
			'who_online'   => array( '/(کی (آنلاین|آنلاینه|هست|سر کاره|اومده)|چه کسی آنلاین|کیا (آنلاین|اومدن|هستن))/u' => 6 ),
			'person_status' => array( '/(داره چیکار می کنه|چیکار میکنه|کجاست|وضعیت|چه کار می کنه|سرش شلوغه)/u' => 4 ),
			'unread'       => array( '/(پیام (جدید|خونده نشده|نخونده)|پیام ها من|کی پیام داده|چی گفتن|پیام دارم)/u' => 6 ),
			'read_chat'    => array( '/(چی گفت|چی نوشت|آخرین پیام|پیام های .+ رو (بخون|بیار|نشون بده))/u' => 6 ),
			'project_new'  => array( '/(پروژه)/u' => 3, '/(جدید|بساز|تعریف کن|ایجاد کن)/u' => 3 ),
			'project_add'  => array( '/(پروژه)/u' => 2, '/(اضافه کن|عضو کن|بیار تو)/u' => 3 ),
			'project_status' => array( '/(پروژه)/u' => 2, '/(چطوره|وضعیت|پیشرفت|چند درصد|کجای کار)/u' => 4 ),
			'invoice'      => array( '/(فاکتور|پیش فاکتور|صورتحساب)/u' => 5, '/(بزن|بساز|صادر کن|بنویس|بده)/u' => 2 ),
			'navigate'     => array( '/^(برو|ببر|باز کن|نشون بده|نمایش|بازکن|صفحه)/u' => 3, '/(صفحه|بخش)/u' => 2 ),
			'digest'       => array( '/(خلاصه|امروز چه خبر|وضعیت من|روزم|چه خبر)/u' => 5 ),
		);
	}

	private static function score( $t ) {
		$scores = array();
		foreach ( self::intents() as $intent => $rules ) {
			$s = 0;
			foreach ( $rules as $re => $w ) {
				if ( preg_match( $re, $t ) ) {
					$s += $w;
				}
			}
			$scores[ $intent ] = $s;
		}
		arsort( $scores );
		return $scores;
	}

	/* ================================================================== Clauses */

	/** Splits a compound request into clauses that each carry their own action. */
	private static function clauses( $t ) {
		$t    = preg_replace( '/\s+(و بعدش|و بعد|بعدش|بعد از اون|و همچنین|همچنین|ضمنا|ضمناً|سپس)\s+/u', ' || ', ' ' . $t . ' ' );
		$verb = '/(بگو|بپرس|بنویس|خبر بده|اطلاع بده|در جریان بذار|پیام بده|بفرست|بذار|بساز|درست کن|ثبت کن|اضافه کن|تعریف کن|یادم بنداز|یادآوری کن|ببر|انجام شد|تموم شد|حذف کن|آرشیو کن|باز کن|راه بنداز)/u';
		$out  = array();
		foreach ( explode( '||', $t ) as $part ) {
			// «… X کن و … Y کن»: split at «و» only when both sides have their own verb.
			$pieces = explode( ' و ', trim( $part ) );
			$cur    = array_shift( $pieces );
			foreach ( $pieces as $p ) {
				if ( preg_match( $verb, $cur ) && preg_match( $verb, $p ) ) {
					$out[] = $cur;
					$cur   = $p;
				} else {
					$cur .= ' و ' . $p;
				}
			}
			$out[] = $cur;
		}
		return array_values( array_filter( array_map( 'trim', $out ) ) );
	}

	/* ================================================================== Main */

	/**
	 * POST assistant (local mode) {text} or {approve: [ids], reject: [ids]}
	 * → {reply, pending:[{id,name,summary}], done:[...], changed:[...], client:[...], suggestions:[...]}
	 */
	public static function handle( WP_REST_Request $r ) {
		self::mem_load();
		$client  = array();
		$changed = array();
		$done    = array();

		// Decisions on earlier cards.
		if ( $r['approve'] || $r['reject'] ) {
			$errors = array();
			foreach ( (array) $r['approve'] as $id ) {
				if ( ! isset( self::$mem['pending'][ $id ] ) ) {
					continue;
				}
				$a   = self::$mem['pending'][ $id ];
				$res = MP_AI::run( $a['tool'], $a['args'], $client );
				if ( is_wp_error( $res ) ) {
					$errors[] = $a['summary'] . ': ' . $res->get_error_message();
				} else {
					$changed[] = $a['tool'];
					$done[]    = $a['summary'];
					self::remember_result( $a['tool'], $a['args'], $res );
				}
			}
			self::$mem['pending'] = array();
			self::mem_save();
			$reply = $errors ? 'بعضی کارها انجام نشد:' . "\n• " . implode( "\n• ", $errors ) : ( $done ? self::pick( array( 'انجام شد ✓', 'حله ✓', 'انجامش دادم ✓', 'تمام شد ✓' ) ) : 'باشه، لغو شد.' );
			return self::out( $reply, array(), $done, $changed, $client );
		}

		$raw = trim( (string) $r['text'] );
		if ( '' === $raw ) {
			return new WP_Error( 'mp_ai', 'چیزی بگویید یا بنویسید.', array( 'status' => 400 ) );
		}
		$t        = self::numbers( self::normalize( $raw ) );
		$pending  = array();
		$replies  = array();
		$suggest  = array();
		foreach ( self::clauses( $t ) as $clause ) {
			$res = self::understand( $clause, $raw );
			if ( isset( $res['reply'] ) ) {
				$replies[] = $res['reply'];
			}
			foreach ( isset( $res['actions'] ) ? $res['actions'] : array() as $a ) {
				$kind = MP_AI::kind( $a['tool'] );
				if ( 'write' === $kind && empty( $r['auto'] ) ) {
					$id                           = 'b' . wp_generate_password( 8, false, false );
					$a['summary']                 = MP_AI::summary( $a['tool'], $a['args'] );
					self::$mem['pending'][ $id ] = $a;
					$pending[]                    = array( 'id' => $id, 'name' => $a['tool'], 'summary' => $a['summary'] );
					continue;
				}
				$out = MP_AI::run( $a['tool'], $a['args'], $client );
				if ( is_wp_error( $out ) ) {
					$replies[] = $out->get_error_message();
				} elseif ( 'write' === $kind ) {
					$changed[] = $a['tool'];
					$done[]    = MP_AI::summary( $a['tool'], $a['args'] );
					self::remember_result( $a['tool'], $a['args'], $out );
				}
			}
			if ( isset( $res['suggest'] ) ) {
				$suggest = array_merge( $suggest, $res['suggest'] );
			}
		}
		self::mem_save();
		$reply = implode( "\n\n", array_filter( $replies ) );
		if ( $pending && '' === $reply ) {
			$reply = count( $pending ) > 1 ? 'این ' . MP_Jalali::digits( count( $pending ) ) . ' کار را انجام بدهم؟' : 'این کار را انجام بدهم؟';
		}
		return self::out( $reply, $pending, $done, $changed, $client, $suggest );
	}

	private static function out( $reply, $pending, $done, $changed, $client, $suggest = array() ) {
		return array( 'reply' => $reply, 'pending' => $pending, 'done' => $done, 'changed' => array_values( array_unique( $changed ) ), 'client' => $client, 'suggestions' => array_values( array_unique( $suggest ) ), 'messages' => array() );
	}

	private static function pick( array $a ) {
		return $a[ array_rand( $a ) ];
	}

	private static function remember_result( $tool, $args, $res ) {
		if ( isset( $res['task_id'] ) ) {
			self::$mem['task'] = (int) $res['task_id'];
		}
		if ( isset( $args['task_id'] ) ) {
			self::$mem['task'] = (int) $args['task_id'];
		}
	}

	private static function name( $id ) {
		$u = get_userdata( $id );
		return $u ? $u->display_name : '';
	}

	private static function first( $id ) {
		return explode( ' ', self::name( $id ) )[0];
	}

	/** People ids from entities, resolving «بهش/به او/اون» to the last person. Returns [ids, phrases, ambiguous]. */
	private static function who( $t, $include_me = false ) {
		$ids = array();
		$ph  = array();
		$amb = null;
		foreach ( self::people( $t ) as $p ) {
			$ph[] = $p['phrase'];
			if ( isset( $p['ambiguous'] ) ) {
				$amb = $p;
				continue;
			}
			if ( ! empty( $p['all'] ) ) {
				foreach ( MP_Util::panel_users() as $id ) {
					if ( MP_Util::is_employee( $id ) && $id !== get_current_user_id() ) {
						$ids[] = (int) $id;
					}
				}
				continue;
			}
			$ids[] = $p['id'];
		}
		if ( ! $ids && ! $amb && preg_match( '/(^|\s)(بهش|به او|به اون|بهشون|اون|او|ایشون)(?=\s|$)/u', $t, $m ) && ! empty( self::$mem['person'] ) ) {
			$ids[] = (int) self::$mem['person'];
			$ph[]  = $m[2];
		}
		if ( $include_me ) {
			$ids[] = get_current_user_id();
		}
		$ids = array_values( array_unique( $ids ) );
		$others = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( $others ) {
			self::$mem['person'] = end( $others );
		}
		return array( $ids, $ph, $amb );
	}

	private static function ask_which( $amb ) {
		return array( 'reply' => 'منظورتان کدام «' . $amb['phrase'] . '» است؟', 'suggest' => array_map( function ( $id ) { return self::name( $id ); }, $amb['ambiguous'] ) );
	}

	/** One clause → reply and/or actions. */
	private static function understand( $t, $raw ) {
		$scores = self::score( $t );
		$intent = key( $scores );
		$best   = current( $scores );
		$is_mgr = MP_Util::is_manager();

		// Tie-breaks that keywords alone get wrong (order matters).
		$forced      = true;
		$create_verb = (bool) preg_match( '/(بساز|درست کن|ایجاد کن|راه بنداز|تشکیل بده|تعریف کن|(^|\s)جدید(\s|$))/u', $t );
		if ( preg_match( '/(^برو|^صفحه|باز کن|بازکن|نشون بده|نمایش بده)/u', $t ) && ! preg_match( '/(گروه|تسک|پیام|جلسه|یادم|:)/u', $t ) && self::nav_target( $t ) ) {
			$intent = 'navigate';
		} elseif ( $scores['unread'] >= 6 || $scores['read_chat'] >= 6 ) {
			$intent = $scores['unread'] >= $scores['read_chat'] ? 'unread' : 'read_chat';
		} elseif ( preg_match( '/^(پیام|پیغام|مسیج)/u', $t ) || preg_match( '/(^|\s)(تو|توی|در|داخل) (گروه )?.+ (بنویس|بگو|بفرست|پیام بده)/u', $t ) ) {
			$intent = 'message';
		} elseif ( preg_match( '/(بگو|بپرس|خبر بده|اطلاع بده|در جریان بذار|پیام بده|پیام بفرست)/u', $t ) && ! preg_match( '/(تسک|یادم|یادآوری|جلسه بذار)/u', $t ) && self::who( $t )[0] ) {
			$intent = 'message';
		} elseif ( $scores['daily_report'] >= 5 ) {
			$intent = 'daily_report';
		} elseif ( preg_match( '/(تسک|وظیفه)/u', $t ) && preg_match( '/(بذار|بساز|تعریف کن|اضافه کن|ثبت کن|تعیین کن|محول کن)/u', $t ) && ! preg_match( '/(ببر|منتقل|انجام شد|تموم شد|آرشیو|حذف)/u', $t ) ) {
			$intent = 'task_create';
		} elseif ( preg_match( '/^(تسک|وظیفه)/u', $t ) && ( self::date_in( $t ) || self::time_in( $t ) ) && ! preg_match( '/(انجام شد|تموم شد|تمام شد|ببر|منتقل|آرشیو|حذف|پاک کن|چیه|چیا|کدوم|چند|چی |نشون بده|لیست|دارم|داره|داریم)/u', $t ) ) {
			$intent = 'task_create';
		} elseif ( $scores['reminder'] >= 6 ) {
			$intent = 'reminder';
		} elseif ( $scores['leave'] >= 6 ) {
			$intent = 'leave';
		} elseif ( preg_match( '/(گروه|گپ)/u', $t ) && $create_verb && $scores['group_add'] < 5 && ! preg_match( '/پروژه/u', $t ) ) {
			$intent = 'create_group';
		} elseif ( 'create_group' === $intent && ! $create_verb ) {
			$intent = $scores['group_add'] >= 5 ? 'group_add' : 'message';
		} elseif ( 'project_new' === $intent && ! $create_verb ) {
			$intent = $scores['task_create'] >= 2 ? 'task_create' : 'project_status';
		} elseif ( preg_match( '/(^|\s)به .+ (بگو|بنویس|خبر بده|اطلاع بده|پیام بده|پیام بفرست|بپرس)/u', $t ) && ! preg_match( '/(تسک|یادم|یادآوری)/u', $t ) ) {
			$intent = 'message';
		} elseif ( $scores['ledger'] >= 6 && $scores['invoice'] < 5 && $scores['money_report'] < 6 ) {
			$intent = 'ledger';
		} elseif ( $scores['task_done'] >= 5 && ! preg_match( '/(چه|چی|کدوم|چند)/u', $t ) ) {
			$intent = 'task_done';
		} elseif ( $scores['meeting'] >= 5 ) {
			$intent = 'meeting';
		} elseif ( $scores['task_list'] >= 4 && $scores['task_create'] < 4 && $scores['task_move'] < 5 ) {
			$intent = 'task_list';
		} else {
			$forced = false;
		}
		if ( ! $forced && $best < 3 && ! in_array( $intent, array( 'greet', 'thanks', 'help' ), true ) ) {
			// Last try: a bare page name, a person («رضا؟»), or a project name.
			$nav = self::nav_target( $t );
			if ( $nav ) {
				return array( 'actions' => array( array( 'tool' => 'open_page', 'args' => $nav ) ), 'reply' => 'باز کردم.' );
			}
			return array( 'reply' => 'متوجه نشدم دقیقاً چه کنم 🙂 چند نمونه:', 'suggest' => array( 'امروز چه کارهایی دارم؟', 'به رضا بگو فایل رو فرستادم', 'فردا ساعت ۱۰ با علی و مهدی جلسه بذار', 'یک گروه بین من و مهدی بساز', 'یادم بنداز ۵ عصر تماس با مشتری' ) );
		}
		$fn = 'i_' . $intent;
		return method_exists( __CLASS__, $fn ) ? self::$fn( $t, $raw, $is_mgr ) : array( 'reply' => 'این را هنوز بلد نیستم.' );
	}

	/* ================================================================== Intent handlers */

	private static function i_greet() {
		$h = (int) current_time( 'H' );
		$n = explode( ' ', self::name( get_current_user_id() ) )[0];
		return array( 'reply' => ( $h < 12 ? 'صبح بخیر' : ( $h < 17 ? 'روز بخیر' : 'عصر بخیر' ) ) . ' ' . $n . '! چه کاری انجام بدهم؟', 'suggest' => array( 'امروز چه کارهایی دارم؟', 'پیام‌های جدیدم', 'ورودم رو ثبت کن' ) );
	}

	private static function i_thanks() {
		return array( 'reply' => self::pick( array( 'خواهش می‌کنم 🌱', 'در خدمتم!', 'قربانت، کار دیگری هست؟' ) ) );
	}

	private static function i_help( $t, $raw, $mgr ) {
		$l = array( '• کارهایم: «امروز چه کارهایی دارم؟»، «تسک‌های عقب‌افتاده‌ام»، «برنامه فردا»', '• تسک: «تسک طراحی بنر فردا ساعت ۱۱ بذار»، «اون تسک رو ببر پس‌فردا»، «تسک بنر انجام شد»', '• پیام: «به رضا بگو فایل رو فرستادم»، «تو گروه زیوا بنویس جلسه کنسله»، «رضا چی گفت؟»', '• جلسه و یادآوری: «فردا ۱۰ صبح با علی و مهدی جلسه بذار»، «یادم بنداز ۵ عصر زنگ بزنم»', '• حضور و مرخصی: «ورودم رو ثبت کن»، «خروج»، «پنجشنبه مرخصی می‌خوام»', '• پول: «۱۳۰ تومن خرج افزونه»، «این ماه چقدر خرج کردیم؟»' );
		if ( $mgr ) {
			$l[] = '• ناظر: «یک گروه بین من و مهدی بساز»، «برای رضا و علی تسک تست نهایی پنجشنبه بذار»، «وضعیت تیم این هفته»، «پروژه جدید به اسم زیوا با رضا»، «فاکتور ۵ میلیونی برای زیوا»';
		}
		return array( 'reply' => "این‌ها را انجام می‌دهم (با صدا یا نوشتن):\n" . implode( "\n", $l ) );
	}

	private static function i_clock_in() {
		return array( 'actions' => array( array( 'tool' => 'clock', 'args' => array( 'action' => 'in' ) ) ) );
	}

	private static function i_clock_out() {
		return array( 'actions' => array( array( 'tool' => 'clock', 'args' => array( 'action' => 'out' ) ) ) );
	}

	/** «یک گروه بین من و مهدی بساز»، «گروه طراحی با رضا و علی درست کن»، «یه گروه به اسم فنی برای همه بچه‌ها» */
	private static function i_create_group( $t, $raw, $mgr ) {
		list( $ids, $ph, $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		$others = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( ! $others ) {
			return array( 'reply' => 'گروه را با چه کسانی بسازم؟ مثلاً «یک گروه بین من و مهدی بساز».' );
		}
		if ( ! $mgr ) {
			// Employees can't make groups; a two-person «group» is a private chat.
			if ( 1 === count( $others ) ) {
				return array( 'actions' => array( array( 'tool' => 'open_page', 'args' => array( 'page' => 'messages', 'person' => $others[0] ) ) ), 'reply' => 'ساخت گروه با ناظر است؛ گفت‌وگوی خصوصی شما با ' . self::name( $others[0] ) . ' را باز کردم.' );
			}
			return array( 'reply' => 'ساخت گروه فقط برای ناظر فعال است. از ناظر بخواهید، یا با هر نفر گفت‌وگوی خصوصی داشته باشید.' );
		}
		$title = self::quoted( $raw );
		if ( ! $title && preg_match( '/(?:به اسم|به نام|با اسم|با نام|اسمش|اسمشو|اسمش رو|عنوانش) (.+?)(?:\s+(?:بین|با|برای|بساز|درست کن|ایجاد کن|باشه|بذار)|$)/u', $t, $m ) ) {
			$title = trim( $m[1] );
		}
		if ( ! $title && preg_match( '/گروه (?!بین|با|برای|به|بساز|درست|ایجاد|جدید)([^\s]+(?: [^\s]+)?) (?:بین|با|برای)/u', $t, $m ) ) {
			$title = trim( $m[1] );
		}
		$members = array_unique( array_merge( array( get_current_user_id() ), $others ) );
		if ( ! $title ) {
			$title = implode( ' و ', array_map( array( __CLASS__, 'first' ), $members ) );
		}
		return array( 'actions' => array( array( 'tool' => 'create_group', 'args' => array( 'title' => $title, 'members' => array_map( 'strval', array_map( array( __CLASS__, 'name' ), $others ) ) ) ) ) );
	}

	private static function i_group_add( $t, $raw, $mgr ) {
		$g = self::group_in( $t );
		list( $ids, , $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		if ( ! $g ) {
			return array( 'reply' => 'به کدام گروه اضافه کنم؟ نام گروه را بگویید.' );
		}
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( ! $ids ) {
			return array( 'reply' => 'چه کسی را به «' . $g[1] . '» اضافه کنم؟' );
		}
		if ( 'project' === $g[3]['type'] ) {
			return array( 'actions' => array( array( 'tool' => 'add_project_members', 'args' => array( 'project' => $g[1], 'members' => array_map( array( __CLASS__, 'name' ), $ids ) ) ) ) );
		}
		return array( 'actions' => array( array( 'tool' => 'add_group_members', 'args' => array( 'group' => $g[1], 'members' => array_map( array( __CLASS__, 'name' ), $ids ) ) ) ) );
	}

	/** «به رضا بگو فایل رو فرستادم»، «پیام بده به مهدی که جلسه کنسله»، «تو گروه زیوا بنویس …»، «بهش بگو …» */
	private static function i_message( $t, $raw, $mgr ) {
		$body = self::quoted( $raw );
		$g    = self::group_in( $t );
		list( $ids, $ph, $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( ! $body ) {
			// Body: after «بگو/بنویس/که/:», else what is left.
			if ( preg_match( '/(?:بگو|بنویس|بپرس|اطلاع بده|خبر بده|در جریان بذار|پیام بده|پیام بفرست|بفرست)(?: که)? (.+)$/u', $t, $m ) && ! preg_match( '/^(به|برای)\s/u', $m[1] ) ) {
				$body = $m[1];
			} elseif ( preg_match( '/(?:که|:) (.+)$/u', $t, $m ) ) {
				$body = $m[1];
			} else {
				$body = self::strip( $t, array_merge( $ph, $g ? array( $g[2] ) : array() ), array( 'به', 'پیام', 'پیغام', 'بده', 'بفرست', 'بگو', 'بنویس', 'تو', 'توی', 'در', 'گروه', 'برای', 'که', 'رو', 'را', 'بهش' ) );
			}
			// Keep the person's own wording (Persian digits) where possible.
			$body = self::from_raw( $raw, $body );
		}
		$body = trim( preg_replace( '/^(که|:)\s*/u', '', (string) $body ) );
		if ( '' === $body ) {
			return array( 'reply' => 'چه پیامی بفرستم؟' );
		}
		$acts = array();
		if ( $g && ( ! $ids || preg_match( '/(گروه|تو |توی |در )/u', $t ) ) ) {
			$acts[] = array( 'tool' => 'send_message', 'args' => array( 'to' => $g[1], 'text' => $body ) );
		} else {
			if ( ! $ids ) {
				return array( 'reply' => 'پیام را برای چه کسی بفرستم؟' );
			}
			foreach ( $ids as $id ) {
				$acts[] = array( 'tool' => 'send_message', 'args' => array( 'to' => self::name( $id ), 'text' => $body ) );
			}
		}
		return array( 'actions' => $acts );
	}

	/** Finds the words of $norm inside the original text so digits and spelling stay as typed. */
	private static function from_raw( $raw, $norm ) {
		$r = self::normalize( $raw );
		$p = mb_strpos( $r, $norm );
		if ( false === $p ) {
			return $norm;
		}
		$fa = MP_Jalali::digits( $norm );
		return preg_match( '/[۰-۹]/u', $raw ) ? $fa : $norm;
	}

	private static function fillers_task() {
		return array( 'تسک', 'تسکی', 'کار', 'وظیفه', 'یک', 'جدید', 'برای', 'به', 'بذار', 'بساز', 'تعریف', 'کن', 'اضافه', 'ثبت', 'تعیین', 'محول', 'بده', 'ساعت', 'روز', 'در', 'تو', 'توی', 'رو', 'را', 'که', 'باید', 'لطفا', 'می خواهم', 'پروژه', 'با', 'اولویت', 'فوری', 'مهم', 'و', 'هم', 'تا', 'انجام', 'بشه', 'بدی', 'کنه', 'کنند', 'کنن', 'بدن', 'بده', 'ها', 'های', 'اون', 'این' );
	}

	/** «برای رضا و علی تسک تست نهایی پنجشنبه ساعت ۱۰ بذار»، «تسک طراحی بنر فوری فردا» */
	private static function i_task_create( $t, $raw, $mgr ) {
		list( $ids, $ph, $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		$d   = self::date_in( $t );
		$tm  = self::time_in( $t );
		$prj = self::project_in( $t );
		$title = self::quoted( $raw );
		if ( ! $title ) {
			$title = self::strip( $t, array_merge( $ph, array( $d ? $d[1] : '', $tm ? $tm[1] : '', $prj ? $prj[2] : '' ) ), self::fillers_task() );
			$title = self::from_raw( $raw, $title );
		}
		if ( '' === trim( $title ) ) {
			return array( 'reply' => 'عنوان تسک چیست؟' );
		}
		$others = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( $others && ! $mgr ) {
			return array( 'reply' => 'تعیین تسک برای دیگران با ناظر است. می‌توانم برای خودتان بسازم یا به ' . self::name( $others[0] ) . ' پیام بدهم.', 'suggest' => array( 'برای خودم تسک ' . $title . ' بذار' ) );
		}
		$date = $d ? $d[0] : MP_Util::today();
		if ( $tm && $tm[2] ) {
			$date = MP_Util::add_days( $date, $tm[2] );
		}
		$args = array( 'title' => $title, 'date' => $date );
		if ( $tm ) {
			$args['time'] = $tm[0];
		}
		if ( $ids ) {
			$args['assignees'] = array_map( array( __CLASS__, 'name' ), $ids );
		}
		if ( $prj ) {
			$args['project'] = $prj[1];
		}
		if ( preg_match( '/(فوری|مهم|اورژانسی|ضروری)/u', $t ) ) {
			$args['priority'] = 'high';
		}
		if ( preg_match( '/(هر روز|روزانه)/u', $t ) ) {
			$args['recurrence'] = 'daily';
		} elseif ( preg_match( '/(هر هفته|هفتگی)/u', $t ) ) {
			$args['recurrence'] = 'weekly';
		}
		return array( 'actions' => array( array( 'tool' => 'create_task', 'args' => $args ) ) );
	}

	/** Tasks matching words of the clause (or «اون تسک» = the last one). */
	private static function find_tasks( $t, $scope = 'open' ) {
		if ( preg_match( '/(اون|همون|این) (تسک|کار)|^(اونو|همونو|اینو)/u', $t ) && ! empty( self::$mem['task'] ) ) {
			$task = MP_Rest::get_task( (int) self::$mem['task'] );
			return $task ? array( MP_Rest::task_payload( $task ) ) : array();
		}
		$list = MP_AI::call( 'GET', 'tasks', MP_Util::is_manager() && preg_match( '/(رضا|مهدی|علی|همه)/u', $t ) ? array( 'user_id' => 'all' ) : array() );
		if ( is_wp_error( $list ) ) {
			return array();
		}
		$today = MP_Util::today();
		if ( preg_match( '/(عقب افتاده|مونده|باقی مونده|قبلی)/u', $t ) ) {
			return array_values( array_filter( $list, function ( $x ) use ( $today ) { return ! $x['done'] && $x['date'] < $today; } ) );
		}
		$d = self::date_in( $t );
		$words = array_filter( explode( ' ', MP_AI::norm( self::strip( $t, array( $d ? $d[1] : '' ), array_merge( self::fillers_task(), array( 'انجام', 'شد', 'دادم', 'تموم', 'تمام', 'کردم', 'ببر', 'منتقل', 'بنداز', 'بیار', 'آرشیو', 'حذف', 'پاک', 'بردار', 'کنسل', 'لغو', 'تیک', 'بزن', 'عقب', 'جابجا', 'امروز', 'فردا', 'من', 'مال', 'مربوط' ) ) ) ) ), function ( $w ) { return mb_strlen( $w ) > 1; } );
		$best = array();
		foreach ( $list as $x ) {
			if ( 'open' === $scope && $x['done'] ) {
				continue;
			}
			$hay = MP_AI::norm( self::normalize( $x['title'] ) );
			$hit = 0;
			foreach ( $words as $w ) {
				if ( false !== mb_strpos( $hay, $w ) ) {
					++$hit;
				}
			}
			if ( $hit ) {
				$best[] = array( $hit, $x );
			}
		}
		usort( $best, function ( $a, $b ) { return $b[0] - $a[0]; } );
		if ( ! $best ) {
			return array();
		}
		$top = $best[0][0];
		return array_values( array_map( function ( $b ) { return $b[1]; }, array_filter( $best, function ( $b ) use ( $top ) { return $b[0] === $top; } ) ) );
	}

	private static function choose( $tasks, $verb ) {
		return array( 'reply' => 'کدام تسک را ' . $verb . '؟', 'suggest' => array_slice( array_map( function ( $x ) { return $x['title']; }, $tasks ), 0, 5 ) );
	}

	private static function i_task_done( $t ) {
		$tasks = self::find_tasks( $t );
		if ( ! $tasks ) {
			return array( 'reply' => 'تسکی با این نام پیدا نکردم. نام تسک را دقیق‌تر بگویید.' );
		}
		if ( count( $tasks ) > 1 && ! preg_match( '/(همه|همشون|همه ی)/u', $t ) ) {
			return self::choose( $tasks, 'انجام‌شده بزنم' );
		}
		return array( 'actions' => array_map( function ( $x ) { return array( 'tool' => 'update_task', 'args' => array( 'task_id' => $x['id'], 'status' => 'done' ) ); }, $tasks ) );
	}

	private static function i_task_move( $t ) {
		$d  = self::date_in( $t );
		$tm = self::time_in( $t );
		if ( ! $d && ! $tm ) {
			return array( 'reply' => 'به چه روز یا ساعتی ببرم؟' );
		}
		$tasks = self::find_tasks( $t );
		if ( ! $tasks ) {
			return array( 'reply' => 'تسکی پیدا نکردم که جابه‌جا کنم.' );
		}
		if ( count( $tasks ) > 1 && ! preg_match( '/(همه|ها|های|عقب افتاده|مونده)/u', $t ) ) {
			return self::choose( $tasks, 'جابه‌جا کنم' );
		}
		return array(
			'actions' => array_map(
				function ( $x ) use ( $d, $tm ) {
					$a = array( 'task_id' => $x['id'] );
					if ( $d ) {
						$a['date'] = $d[0];
					}
					if ( $tm ) {
						$a['time'] = $tm[0];
					}
					return array( 'tool' => 'update_task', 'args' => $a );
				},
				array_slice( $tasks, 0, 30 )
			),
		);
	}

	private static function i_task_archive( $t ) {
		$tasks = self::find_tasks( $t );
		if ( ! $tasks ) {
			return array( 'reply' => 'تسکی با این نام پیدا نکردم.' );
		}
		if ( count( $tasks ) > 1 ) {
			return self::choose( $tasks, 'آرشیو کنم' );
		}
		return array( 'actions' => array( array( 'tool' => 'archive_task', 'args' => array( 'task_id' => $tasks[0]['id'] ) ) ) );
	}

	/** «امروز چه کارهایی دارم»، «تسک‌های رضا»، «عقب‌افتاده‌ها»، «برنامه فردا» */
	private static function i_task_list( $t, $raw, $mgr ) {
		list( $ids ) = self::who( $t );
		$uid   = $ids ? $ids[0] : get_current_user_id();
		$d     = self::date_in( $t );
		$today = MP_Util::today();
		$q     = array( 'user_id' => $uid );
		if ( $uid !== get_current_user_id() && ! $mgr ) {
			return array( 'reply' => 'دیدن تسک‌های دیگران فقط برای ناظر است.' );
		}
		$list = MP_AI::call( 'GET', 'tasks', $q );
		if ( is_wp_error( $list ) ) {
			return array( 'reply' => $list->get_error_message() );
		}
		$who   = $uid === get_current_user_id() ? '' : self::first( $uid ) . ' ';
		$late  = array_values( array_filter( $list, function ( $x ) use ( $today ) { return ! $x['done'] && $x['date'] < $today; } ) );
		if ( preg_match( '/(عقب افتاده|مونده|باقی)/u', $t ) ) {
			return array( 'reply' => $late ? $who . MP_Jalali::digits( count( $late ) ) . " تسک عقب‌افتاده:\n" . self::bullets( $late, true ) : 'هیچ تسک عقب‌افتاده‌ای نیست 👌', 'suggest' => $late && ! $who ? array( 'عقب‌افتاده‌ها رو بیار برای امروز' ) : array() );
		}
		$day   = $d ? $d[0] : $today;
		$items = array_values( array_filter( $list, function ( $x ) use ( $day ) { return $x['date'] === $day; } ) );
		$open  = array_filter( $items, function ( $x ) { return ! $x['done']; } );
		$label = $day === $today ? 'امروز' : ( MP_Util::add_days( $today, 1 ) === $day ? 'فردا' : MP_Jalali::format( $day ) );
		if ( ! $items ) {
			$r = $label . ' ' . ( $who ? $who . 'تسکی ندارد.' : 'تسکی ندارید.' );
		} else {
			$r = $label . ' ' . $who . MP_Jalali::digits( count( $items ) ) . ' تسک' . ( count( $open ) < count( $items ) ? ' (' . MP_Jalali::digits( count( $items ) - count( $open ) ) . ' انجام‌شده)' : '' ) . ":\n" . self::bullets( $items );
		}
		if ( $late && $day === $today ) {
			$r .= "\n\n" . 'و ' . MP_Jalali::digits( count( $late ) ) . ' تسک عقب‌افتاده.';
		}
		return array( 'reply' => $r );
	}

	private static function bullets( $tasks, $with_date = false ) {
		$l = array();
		foreach ( array_slice( $tasks, 0, 12 ) as $x ) {
			$l[] = ( $x['done'] ? '✓ ' : '• ' ) . $x['title'] . ( $x['time'] ? ' — ' . MP_Jalali::digits( $x['time'] ) : '' ) . ( $with_date ? ' (' . MP_Jalali::format( $x['date'] ) . ')' : '' );
		}
		if ( count( $tasks ) > 12 ) {
			$l[] = '… و ' . MP_Jalali::digits( count( $tasks ) - 12 ) . ' مورد دیگر';
		}
		return implode( "\n", $l );
	}

	/** «یادم بنداز فردا ساعت ۱۰ زنگ بزنم به مشتری»، «هر روز ۹ صبح یادآوری گزارش» */
	private static function i_reminder( $t, $raw ) {
		$d  = self::date_in( $t );
		$tm = self::time_in( $t );
		$title = self::quoted( $raw );
		if ( ! $title ) {
			$title = self::strip( $t, array( $d ? $d[1] : '', $tm ? $tm[1] : '' ), array( 'یادم', 'بنداز', 'بیار', 'باشه', 'یادآوری', 'یاد', 'آوری', 'کن', 'بذار', 'که', 'ساعت', 'هر', 'روز', 'هفته', 'روزانه', 'هفتگی', 'ماهانه', 'آلارم', 'هشدار', 'بده' ) );
			$title = preg_replace( '/^(به من|برای|رو|را)\s+/u', '', $title );
			$title = self::from_raw( $raw, $title );
		}
		if ( '' === $title ) {
			return array( 'reply' => 'برای چه چیزی یادآوری بگذارم؟' );
		}
		$date = $d ? $d[0] : MP_Util::today();
		$time = $tm ? $tm[0] : '09:00';
		if ( $tm && $tm[2] ) {
			$date = MP_Util::add_days( $date, $tm[2] );
		}
		if ( ! $d && $time <= current_time( 'H:i' ) ) {
			$date = MP_Util::add_days( MP_Util::today(), 1 );
		}
		$rep = preg_match( '/(هر روز|روزانه)/u', $t ) ? 'daily' : ( preg_match( '/(هر هفته|هفتگی)/u', $t ) ? 'weekly' : ( preg_match( '/(هر ماه|ماهانه)/u', $t ) ? 'monthly' : 'none' ) );
		return array( 'actions' => array( array( 'tool' => 'create_reminder', 'args' => array( 'title' => $title, 'date' => $date, 'time' => $time, 'repeat' => $rep ) ) ) );
	}

	/** «فردا ساعت ۱۰ با علی و مهدی جلسه بذار درباره زیوا» */
	private static function i_meeting( $t, $raw ) {
		list( $ids, $ph, $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		$d   = self::date_in( $t );
		$tm  = self::time_in( $t );
		$prj = self::project_in( $t );
		if ( ! $tm ) {
			return array( 'reply' => 'جلسه چه ساعتی باشد؟' );
		}
		$title = self::quoted( $raw );
		if ( ! $title && preg_match( '/(?:درباره|درمورد|در مورد|برای|با موضوع|موضوع) (.+?)(?:\s+(?:بذار|بساز|تنظیم کن|هماهنگ کن))?$/u', $t, $m ) ) {
			$title = self::strip( $m[1], array_merge( $ph, array( $d ? $d[1] : '', $tm[1] ) ), array( 'جلسه', 'بذار', 'ساعت' ) );
		}
		if ( ! $title ) {
			$title = $prj ? 'جلسه ' . $prj[1] : 'جلسه ' . ( $ids ? implode( ' و ', array_map( array( __CLASS__, 'first' ), array_diff( $ids, array( get_current_user_id() ) ) ) ) : 'تیم' );
		}
		$people = array_map( array( __CLASS__, 'name' ), array_values( array_diff( $ids, array( get_current_user_id() ) ) ) );
		$url    = preg_match( '#https?://\S+#', $raw, $m ) ? $m[0] : '';
		return array( 'actions' => array( array( 'tool' => 'create_meeting', 'args' => array_filter( array( 'title' => self::from_raw( $raw, $title ), 'date' => $d ? $d[0] : MP_Util::today(), 'time' => $tm[0], 'people' => $people, 'project' => $prj ? $prj[1] : '', 'url' => $url ) ) ) ) );
	}

	private static function i_meeting_list( $t ) {
		$d    = self::date_in( $t );
		$day  = $d ? $d[0] : MP_Util::today();
		$list = MP_AI::call( 'GET', 'meetings', array( 'from' => $day, 'to' => $day ) );
		if ( is_wp_error( $list ) || ! $list ) {
			return array( 'reply' => ( $d ? MP_Jalali::format( $day ) : 'امروز' ) . ' جلسه‌ای ندارید.' );
		}
		return array( 'reply' => 'جلسه‌ها:' . "\n" . implode( "\n", array_map( function ( $m ) { return '• ' . MP_Jalali::digits( $m['time'] ) . ' — ' . $m['title']; }, $list ) ) );
	}

	/** «پنجشنبه مرخصی می‌خوام»، «از شنبه تا دوشنبه مرخصی»، «فردا از ۱۰ تا ۱۲ مرخصی ساعتی» */
	private static function i_leave( $t, $raw ) {
		$reason = preg_match( '/(?:به خاطر|بخاطر|برای|چون|علت) (.+)$/u', $t, $m ) ? self::from_raw( $raw, $m[1] ) : '';
		if ( preg_match( '/از (.+?) تا (.+?)(?:\s|$)/u', $t, $m ) ) {
			$a = self::time_in( 'ساعت ' . $m[1] );
			$b = self::time_in( 'ساعت ' . $m[2] );
			if ( $a && $b && preg_match( '/^\d/u', $m[1] ) ) {
				$d = self::date_in( $t );
				return array( 'actions' => array( array( 'tool' => 'request_leave', 'args' => array( 'kind' => 'hourly', 'start' => $d ? $d[0] : MP_Util::today(), 'from_time' => $a[0], 'to_time' => $b[0], 'reason' => $reason ) ) ) );
			}
			$da = self::date_in( $m[1] );
			$db = self::date_in( $m[2] . ' ' );
			if ( $da && $db ) {
				return array( 'actions' => array( array( 'tool' => 'request_leave', 'args' => array( 'kind' => 'daily', 'start' => $da[0], 'end' => $db[0], 'reason' => $reason ) ) ) );
			}
		}
		$d = self::date_in( $t );
		if ( ! $d ) {
			return array( 'reply' => 'مرخصی برای چه روزی؟' );
		}
		$n = preg_match( '/(\d+) روز/u', $t, $mm ) ? max( 1, (int) $mm[1] ) : 1;
		return array( 'actions' => array( array( 'tool' => 'request_leave', 'args' => array( 'kind' => 'daily', 'start' => $d[0], 'end' => MP_Util::add_days( $d[0], $n - 1 ), 'reason' => $reason ) ) ) );
	}

	/** «۱۳۰ تومن خرج افزونه»، «۲ میلیون از زیوا گرفتم»، «هزینه هاست ۸۰۰ هزار برای پروژه کوچ» */
	private static function i_ledger( $t, $raw ) {
		$a = self::amount_in( $t );
		if ( ! $a ) {
			return array( 'reply' => 'مبلغ چقدر بود؟' );
		}
		$income = (bool) preg_match( '/(دخل|درآمد|گرفتم|دریافت|واریز شد|واریز کرد|پرداخت کرد|پول داد|داد به ما)/u', $t );
		$prj    = self::project_in( $t );
		$d      = self::date_in( $t );
		$title  = self::strip( $t, array( $a[1], $prj ? $prj[2] : '', $d ? $d[1] : '' ), array( 'خرج', 'هزینه', 'دخل', 'درآمد', 'گرفتم', 'دادم', 'دریافت', 'پرداخت', 'کردم', 'کرد', 'واریز', 'بابت', 'برای', 'از', 'به', 'ثبت', 'کن', 'تومان', 'ریال', 'پروژه', 'شد', 'خریدم', 'خرید', 'یک', 'رو', 'را' ) );
		return array( 'actions' => array( array( 'tool' => 'add_ledger', 'args' => array_filter( array( 'type' => $income ? 'income' : 'expense', 'amount' => $a[0], 'title' => $title ? self::from_raw( $raw, $title ) : ( $income ? 'دریافتی' : 'هزینه' ), 'project' => $prj ? $prj[1] : '', 'date' => $d ? $d[0] : '' ) ) ) ) );
	}

	private static function i_money_report( $t ) {
		$week = (bool) preg_match( '/هفته/u', $t );
		if ( $week ) {
			$from = MP_Util::add_days( MP_Util::today(), -6 );
			$to   = MP_Util::today();
			$lab  = 'هفت روز اخیر';
		} else {
			list( $from, $to ) = MP_Jalali::month_range( MP_Util::today(), preg_match( '/ماه (قبل|پیش|گذشته)/u', $t ) ? -1 : 0 );
			$lab = preg_match( '/ماه (قبل|پیش|گذشته)/u', $t ) ? 'ماه قبل' : 'این ماه';
		}
		$d = MP_Rest::ledger_rows( $from, $to );
		$toman = function ( $n ) { return MP_Jalali::digits( number_format( abs( (int) $n ) ) ) . ' تومان'; };
		$r = $lab . ":\n• دخل " . $toman( $d['income'] ) . "\n• خرج " . $toman( $d['expense'] ) . "\n• خالص " . ( $d['income'] - $d['expense'] < 0 ? '−' : '' ) . $toman( $d['income'] - $d['expense'] );
		if ( ! empty( $d['breakdown'] ) ) {
			$top = array_slice( $d['breakdown'], 0, 3 );
			$r  .= "\nبیشترین خرج: " . implode( '، ', array_map( function ( $b ) use ( $toman ) { return ( $b['category'] ? $b['category'] : 'بدون دسته' ) . ' ' . $toman( $b['amount'] ); }, $top ) );
		}
		return array( 'reply' => $r );
	}

	/** «گزارش روزانه: امروز صفحه اصلی زیوا رو تموم کردم، ۸۰ درصد، فردا صفحات داخلی» */
	private static function i_daily_report( $t, $raw ) {
		$body = preg_match( '/(?:گزارش روزانه|گزارش امروز|گزارش کار)(?: من| ام)?(?: رو| را)?(?: بنویس| ثبت کن)?[:\s]+(.+)$/u', $t, $m ) ? trim( $m[1] ) : '';
		if ( '' === $body ) {
			return array( 'actions' => array( array( 'tool' => 'open_page', 'args' => array( 'page' => 'daily_report' ) ) ), 'reply' => 'فرم گزارش روزانه را باز کردم. می‌توانید همین‌جا هم بگویید: «گزارش روزانه: … ۸۰ درصد، فردا …»' );
		}
		$pct      = preg_match( '/(\d{1,3}) ?(درصد|٪|%)/u', $body, $pm ) ? min( 100, (int) $pm[1] ) : 0;
		$tomorrow = preg_match( '/(?:فردا|برنامه فردا)[:\s]+(.+)$/u', $body, $fm ) ? $fm[1] : '';
		$problems = preg_match( '/(?:مشکل|مشکلات)[:\s]+(.+?)(?:\s+(?:فردا|نیاز)|$)/u', $body, $mm ) ? $mm[1] : '';
		$done     = trim( preg_replace( array( '/(\d{1,3}) ?(درصد|٪|%)/u', '/(?:فردا|برنامه فردا)[:\s]+.+$/u', '/(?:مشکل|مشکلات)[:\s]+.+?(?=\s+(?:فردا|نیاز)|$)/u' ), '', $body ) );
		return array( 'actions' => array( array( 'tool' => 'save_daily_report', 'args' => array( 'done' => self::from_raw( $raw, $done ? $done : $body ), 'progress' => $pct, 'problems' => $problems, 'tomorrow' => self::from_raw( $raw, $tomorrow ) ) ) ) );
	}

	private static function i_weekly( $t, $raw, $mgr ) {
		if ( ! $mgr ) {
			return self::i_digest( $t );
		}
		$w = MP_Digest::weekly( MP_Util::today() );
		$l = array( 'هفت روز اخیر: ' . MP_Jalali::digits( $w['totals']['done'] ) . ' تسک انجام، ' . MP_Jalali::digits( $w['totals']['overdue'] ) . ' عقب‌افتاده، ' . MP_Jalali::digits( $w['totals']['hours'] ) . ' ساعت حضور.' );
		foreach ( $w['people'] as $p ) {
			$l[] = '• ' . $p['name'] . ': ' . MP_Jalali::digits( $p['done'] ) . '/' . MP_Jalali::digits( $p['planned'] ) . ' تسک، ' . MP_Jalali::digits( $p['hours'] ) . ' ساعت' . ( $p['overdue'] ? '، ' . MP_Jalali::digits( $p['overdue'] ) . ' عقب‌افتاده' : '' );
		}
		$l[] = 'مالی: دخل ' . MP_Jalali::digits( number_format( $w['money']['income'] ) ) . '، خرج ' . MP_Jalali::digits( number_format( $w['money']['expense'] ) ) . ' تومان.';
		return array( 'reply' => implode( "\n", $l ), 'suggest' => array( 'گزارش هفتگی رو باز کن' ) );
	}

	private static function i_digest( $t ) {
		$b = MP_Digest::morning_for( get_current_user_id(), MP_Util::today() );
		return array( 'reply' => $b['title'] . ( $b['detail'] ? "\n" . str_replace( ' | ', "\n", $b['detail'] ) : '' ) );
	}

	private static function i_who_online() {
		$on = array();
		foreach ( MP_Util::panel_users() as $id ) {
			$p = MP_Util::user_payload( $id );
			if ( $p && 'online' === $p['status'] && $id !== get_current_user_id() ) {
				$on[] = $p['name'];
			}
		}
		return array( 'reply' => $on ? 'الان آنلاین: ' . implode( '، ', $on ) : 'الان کسی جز شما آنلاین نیست.' );
	}

	private static function i_person_status( $t, $raw, $mgr ) {
		list( $ids ) = self::who( $t );
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( ! $ids ) {
			return self::i_digest( $t );
		}
		$uid = $ids[0];
		$p   = MP_Util::user_payload( $uid );
		$r   = $p['name'] . ' ' . array( 'online' => 'الان آنلاین است', 'away' => 'کمی پیش آنلاین بود', 'busy' => 'آفلاین است' )[ $p['status'] ];
		if ( $mgr ) {
			$list = MP_AI::call( 'GET', 'tasks', array( 'user_id' => $uid, 'from' => MP_Util::today(), 'to' => MP_Util::today() ) );
			if ( ! is_wp_error( $list ) ) {
				$doing = array_filter( $list, function ( $x ) { return 'doing' === $x['status']; } );
				$r    .= '. امروز ' . MP_Jalali::digits( count( $list ) ) . ' تسک دارد' . ( $doing ? '؛ در حال انجام: ' . implode( '، ', array_map( function ( $x ) { return $x['title']; }, $doing ) ) : '' ) . '.';
			}
		}
		return array( 'reply' => $r );
	}

	private static function i_unread() {
		$list = MP_AI::call( 'GET', 'channels' );
		$un   = array_filter( is_wp_error( $list ) ? array() : $list, function ( $c ) { return $c['unread']; } );
		if ( ! $un ) {
			return array( 'reply' => 'پیام خوانده‌نشده‌ای ندارید ✓' );
		}
		return array( 'reply' => 'پیام‌های تازه:' . "\n" . implode( "\n", array_map( function ( $c ) { return '• ' . $c['title'] . ' (' . MP_Jalali::digits( $c['unread'] ) . '): ' . ( $c['last'] ? $c['last']['author'] . ' — ' . ( $c['last']['body'] ? mb_substr( $c['last']['body'], 0, 80 ) : 'فایل/ویس' ) : '' ); }, $un ) ), 'suggest' => array( 'برو به پیام‌ها' ) );
	}

	private static function i_read_chat( $t ) {
		$g = self::group_in( $t );
		list( $ids ) = self::who( $t );
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		$with = $g ? $g[1] : ( $ids ? self::name( $ids[0] ) : '' );
		if ( '' === $with ) {
			return self::i_unread();
		}
		$client = array();
		$res    = MP_AI::run( 'get_messages', array( 'with' => $with, 'limit' => 6 ), $client );
		if ( is_wp_error( $res ) ) {
			return array( 'reply' => $res->get_error_message() );
		}
		if ( ! $res ) {
			return array( 'reply' => 'با ' . $with . ' هنوز پیامی رد و بدل نشده.' );
		}
		return array( 'reply' => 'آخرین پیام‌ها با ' . $with . ":\n" . implode( "\n", array_map( function ( $m ) { return '• ' . $m['from'] . ': ' . mb_substr( $m['text'], 0, 140 ); }, $res ) ) );
	}

	private static function i_project_new( $t, $raw, $mgr ) {
		if ( ! $mgr ) {
			return array( 'reply' => 'ساخت پروژه با ناظر است.' );
		}
		list( $ids, $ph ) = self::who( $t );
		$name = self::quoted( $raw );
		if ( ! $name && preg_match( '/(?:به اسم|به نام|با اسم|با نام|اسمش) (.+?)(?:\s+(?:با|برای|بساز|درست کن|ایجاد کن|تعریف کن)|$)/u', $t, $m ) ) {
			$name = $m[1];
		}
		if ( ! $name ) {
			$name = self::strip( $t, $ph, array( 'پروژه', 'جدید', 'یک', 'بساز', 'درست', 'کن', 'تعریف', 'ایجاد', 'باز', 'با', 'برای', 'و', 'اعضا', 'اعضای' ) );
		}
		if ( ! $name ) {
			return array( 'reply' => 'اسم پروژه چیست؟' );
		}
		$d = self::date_in( $t );
		return array( 'actions' => array( array( 'tool' => 'create_project', 'args' => array_filter( array( 'name' => self::from_raw( $raw, $name ), 'members' => array_map( array( __CLASS__, 'name' ), array_diff( $ids, array( get_current_user_id() ) ) ), 'end' => $d ? $d[0] : '' ) ) ) ) );
	}

	private static function i_project_add( $t, $raw, $mgr ) {
		$p = self::project_in( $t );
		list( $ids, , $amb ) = self::who( $t );
		if ( $amb ) {
			return self::ask_which( $amb );
		}
		if ( ! $p ) {
			return array( 'reply' => 'به کدام پروژه اضافه کنم؟' );
		}
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		return $ids ? array( 'actions' => array( array( 'tool' => 'add_project_members', 'args' => array( 'project' => $p[1], 'members' => array_map( array( __CLASS__, 'name' ), $ids ) ) ) ) ) : array( 'reply' => 'چه کسی را به «' . $p[1] . '» اضافه کنم؟' );
	}

	private static function i_project_status( $t ) {
		$p = self::project_in( $t );
		if ( ! $p ) {
			return array( 'reply' => 'کدام پروژه؟' );
		}
		$list = MP_AI::call( 'GET', 'projects' );
		foreach ( is_wp_error( $list ) ? array() : $list['projects'] as $x ) {
			if ( (int) $x['id'] === $p[0] ) {
				$total = array_sum( $x['tasks'] );
				$pct   = $total ? round( $x['tasks']['done'] / $total * 100 ) : 0;
				$late  = $x['end'] && $x['end'] < MP_Util::today() && 'done' !== $x['status'];
				return array( 'reply' => '«' . $x['name'] . '»: ' . MP_Jalali::digits( $pct ) . '٪ انجام (' . MP_Jalali::digits( $x['tasks']['done'] ) . ' از ' . MP_Jalali::digits( $total ) . ' تسک)، ' . MP_Jalali::digits( $x['tasks']['doing'] ) . ' در حال انجام. موعد ' . MP_Jalali::format( $x['end'] ) . ( $late ? ' — از موعد گذشته!' : '' ) . '.', 'suggest' => array( 'پروژه ' . $x['name'] . ' رو باز کن' ) );
			}
		}
		return array( 'reply' => 'به این پروژه دسترسی ندارید.' );
	}

	/** «فاکتور ۵ میلیونی برای زیوا بابت طراحی سایت»، «پیش فاکتور برای آقای احمدی ۱۲ میلیون» */
	private static function i_invoice( $t, $raw, $mgr ) {
		if ( ! $mgr ) {
			return array( 'reply' => 'فاکتور را ناظر صادر می‌کند.' );
		}
		$a = self::amount_in( $t );
		if ( ! $a ) {
			return array( 'actions' => array( array( 'tool' => 'open_page', 'args' => array( 'page' => 'invoices' ) ) ), 'reply' => 'فاکتورها را باز کردم. برای ساخت سریع بگویید: «فاکتور ۵ میلیونی برای زیوا بابت طراحی سایت».' );
		}
		$prj    = self::project_in( $t );
		$client = preg_match( '/برای (.+?)(?:\s+(?:بابت|به مبلغ|بزن|بساز|صادر|بنویس)|$)/u', $t, $m ) ? self::strip( $m[1], array( $a[1] ), array( 'پروژه' ) ) : ( $prj ? $prj[1] : '' );
		$what   = preg_match( '/بابت (.+?)(?:\s+(?:بزن|بساز|صادر کن|بنویس)|$)/u', $t, $m ) ? $m[1] : ( $prj ? $prj[1] : 'خدمات' );
		if ( '' === $client ) {
			return array( 'reply' => 'فاکتور برای چه کسی (نام مشتری)؟' );
		}
		return array( 'actions' => array( array( 'tool' => 'create_invoice', 'args' => array( 'kind' => preg_match( '/پیش/u', $t ) ? 'proforma' : 'invoice', 'client_name' => self::from_raw( $raw, $client ), 'project' => $prj ? $prj[1] : '', 'title' => self::from_raw( $raw, $what ), 'items' => array( array( 'title' => self::from_raw( $raw, $what ), 'qty' => 1, 'price' => $a[0] ) ) ) ) ) );
	}

	private static function nav_target( $t ) {
		$map = array( 'تقویم' => 'calendar', 'میز کار' => 'dashboard', 'داشبورد' => 'dashboard', 'تسک' => 'mytasks', 'کار' => 'mytasks', 'پروژه' => 'projects', 'پیام' => 'messages', 'چت' => 'messages', 'حضور' => 'attendance', 'مرخصی' => 'attendance', 'یادآوری' => 'reminders', 'حسابداری' => 'accounting', 'حساب' => 'accounting', 'گزارش هفتگی' => 'weekly_report', 'گزارش روزانه' => 'daily_report', 'گزارش' => 'reports', 'فاکتور' => 'invoices' );
		$p   = self::project_in( $t );
		if ( $p && preg_match( '/پرتال/u', $t ) ) {
			return array( 'page' => 'portal', 'project' => $p[1] );
		}
		if ( $p && preg_match( '/(پروژه|باز کن|برو)/u', $t ) ) {
			return array( 'page' => 'projects', 'project' => $p[1] );
		}
		foreach ( $map as $w => $page ) {
			if ( false !== mb_strpos( $t, $w ) ) {
				return array( 'page' => $page );
			}
		}
		list( $ids ) = self::who( $t );
		$ids = array_values( array_diff( $ids, array( get_current_user_id() ) ) );
		if ( $ids && preg_match( '/(چت|پیام|گفتگو|صفحه)/u', $t ) ) {
			return array( 'page' => 'messages', 'person' => self::name( $ids[0] ) );
		}
		return null;
	}

	private static function i_navigate( $t ) {
		$n = self::nav_target( $t );
		return $n ? array( 'actions' => array( array( 'tool' => 'open_page', 'args' => $n ) ), 'reply' => 'باز کردم.' ) : array( 'reply' => 'کدام صفحه را باز کنم؟', 'suggest' => array( 'برو به تقویم', 'برو به پیام‌ها', 'برو به حسابداری' ) );
	}
}

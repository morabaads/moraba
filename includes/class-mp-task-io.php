<?php
defined( 'ABSPATH' ) || exit;

/**
 * Excel import / export of team tasks (supervisors only).
 *
 * The workbook layout is the team's daily-plan sheet: one sheet per person with the columns
 * شناسه، تاریخ، روز، میلادی، هفته، هدف روز، پروژه، اولویت، ریزتسک، زمان (دقیقه)، خروجی / معیار انجام،
 * ددلاین پروژه، ددلاین امروز، وضعیت، درصد پیشرفت، توضیحات. Export writes the same layout, so a file can
 * go out, be edited in Excel and come back in.
 *
 * Details that have no column of their own in the tasks table are kept as «key: value» lines at the top
 * of the task description. The شناسه line is how a re-import finds a task it already made and updates it
 * instead of adding a copy.
 *
 * Every import is recorded (tasks it made, the previous state of tasks it changed, projects and project
 * members it added) so it can be undone from the panel with one button.
 */
class MP_Task_IO {

	const HISTORY = 'mp_task_imports';
	const MAPPING = 'mp_task_import_map';
	const PMAP    = 'mp_task_import_pmap';
	const RESETS  = 'mp_task_resets';
	const KEEP    = 15;

	/** Description lines written/read by import and export, in this order. */
	const META = array( 'شناسه', 'هفته', 'هدف روز', 'اولویت', 'زمان (دقیقه)', 'خروجی / معیار انجام', 'ددلاین پروژه', 'ددلاین امروز', 'درصد پیشرفت', 'وضعیت' );

	const HEAD = array( 'شناسه', 'تاریخ', 'روز', 'میلادی', 'هفته', 'هدف روز', 'پروژه', 'اولویت', 'ریزتسک', 'زمان (دقیقه)', 'خروجی / معیار انجام', 'ددلاین پروژه', 'ددلاین امروز', 'وضعیت', 'درصد پیشرفت', 'توضیحات', 'ساعت' );

	const DAYS = array( 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه' );

	public static function register() {
		$m = array( 'MP_Rest', 'can_manage' );
		$routes = array(
			array( 'tasks/import/preview', 'POST', 'preview' ),
			array( 'tasks/import', 'POST', 'import' ),
			array( 'tasks/imports', 'GET', 'history' ),
			array( 'tasks/imports/(?P<id>[a-z0-9]+)/undo', 'POST', 'undo' ),
			array( 'tasks/reset', 'POST', 'reset' ),
			array( 'tasks/resets/(?P<id>[a-z0-9]+)/restore', 'POST', 'restore' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $m ) );
		}
	}

	private static function t( $name ) {
		return MP_Install::table( $name );
	}

	private static function err( $message, $status = 400 ) {
		return new WP_Error( 'mp_error', $message, array( 'status' => $status ) );
	}

	/* ------------------------------------------------------------------ Helpers */

	private static function latin( $s ) {
		return strtr( (string) $s, array( '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9', '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9' ) );
	}

	/** Loose form of a name for matching: Arabic ي/ك → Persian, no ZWNJ, single spaces. */
	private static function norm( $s ) {
		$s = str_replace( array( 'ي', 'ك', "\xE2\x80\x8C", 'ـ' ), array( 'ی', 'ک', ' ', '' ), (string) $s );
		$s = preg_replace( '/\s+/u', ' ', trim( $s ) );
		return function_exists( 'mb_strtolower' ) ? mb_strtolower( $s ) : strtolower( $s );
	}

	private static function jalali( $iso ) {
		list( $y, $m, $d ) = MP_Jalali::from_iso( $iso );
		return sprintf( '%04d/%02d/%02d', $y, $m, $d );
	}

	/** Gregorian 'Y-m-d' from a Gregorian string, an Excel serial number or a Jalali 'Y/m/d'. */
	private static function to_date( $v ) {
		$v = trim( self::latin( $v ) );
		if ( '' === $v ) {
			return '';
		}
		if ( is_numeric( $v ) && (float) $v > 20000 && (float) $v < 80000 ) {
			return gmdate( 'Y-m-d', ( (int) $v - 25569 ) * 86400 );
		}
		if ( preg_match( '/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/', $v, $m ) ) {
			$y = (int) $m[1];
			if ( $y > 1900 ) {
				$iso = sprintf( '%04d-%02d-%02d', $y, $m[2], $m[3] );
				return MP_Util::valid_date( $iso ) ? $iso : '';
			}
			if ( $y > 1300 && $y < 1500 && (int) $m[2] >= 1 && (int) $m[2] <= 12 && (int) $m[3] >= 1 && (int) $m[3] <= 31 ) {
				return MP_Jalali::to_iso( $y, (int) $m[2], (int) $m[3] );
			}
		}
		return '';
	}

	private static function priority( $p ) {
		$p = self::latin( $p );
		if ( false !== mb_strpos( $p, 'فوری' ) || false !== mb_strpos( $p, 'زیاد' ) || false !== mb_strpos( $p, 'بالا' ) || preg_match( '/^\s*1\b/', $p ) ) {
			return 'high';
		}
		if ( false !== mb_strpos( $p, 'کم' ) || preg_match( '/^\s*[4-9]\b/', $p ) ) {
			return 'low';
		}
		return 'medium';
	}

	private static function status( $s ) {
		$s = self::norm( $s );
		if ( '' === $s ) {
			return array( 'todo', '' );
		}
		if ( false !== mb_strpos( $s, 'انجام نشده' ) ) {
			return array( 'todo', '' );
		}
		if ( false !== mb_strpos( $s, 'در حال' ) ) {
			return array( 'doing', '' );
		}
		if ( false !== mb_strpos( $s, 'مسدود' ) ) {
			return array( 'todo', 'مسدود' );
		}
		if ( false !== mb_strpos( $s, 'انجام' ) || 'done' === $s ) {
			return array( 'done', '' );
		}
		return array( 'todo', '' );
	}

	/** Splits a description into its «key: value» lines and the free text after them. */
	public static function split_description( $text ) {
		$meta  = array();
		$lines = preg_split( '/\r?\n/', (string) $text );
		$i     = 0;
		for ( ; $i < count( $lines ); $i++ ) {
			$found = false;
			foreach ( self::META as $k ) {
				if ( 0 === strpos( $lines[ $i ], $k . ': ' ) ) {
					$meta[ $k ] = substr( $lines[ $i ], strlen( $k ) + 2 );
					$found      = true;
					break;
				}
			}
			if ( ! $found ) {
				break;
			}
		}
		return array( $meta, trim( implode( "\n", array_slice( $lines, $i ) ) ) );
	}

	private static function build_description( array $meta, $notes ) {
		$out = array();
		foreach ( self::META as $k ) {
			if ( isset( $meta[ $k ] ) && '' !== trim( (string) $meta[ $k ] ) ) {
				$out[] = $k . ': ' . preg_replace( '/\s*\n\s*/', ' ', trim( (string) $meta[ $k ] ) );
			}
		}
		$notes = trim( (string) $notes );
		return implode( "\n", $out ) . ( $notes ? ( $out ? "\n\n" : '' ) . $notes : '' );
	}

	/* ------------------------------------------------------------------ Reading .xlsx */

	private static function col_index( $ref ) {
		$letters = preg_replace( '/\d+/', '', $ref );
		$n       = 0;
		foreach ( str_split( $letters ) as $c ) {
			$n = $n * 26 + ( ord( $c ) - 64 );
		}
		return $n - 1;
	}

	private static function xml_text( $node ) {
		if ( ! $node ) {
			return '';
		}
		if ( isset( $node->t ) && ! isset( $node->r ) ) {
			return (string) $node->t;
		}
		$s = '';
		foreach ( $node->r as $run ) {
			$s .= (string) $run->t;
		}
		return '' === $s && isset( $node->t ) ? (string) $node->t : $s;
	}

	/**
	 * @return array<int,array{name:string,rows:array}>|WP_Error sheets as arrays of rows (cell values as strings).
	 */
	public static function read_xlsx( $path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return self::err( 'افزونه ZipArchive روی سرور فعال نیست.' );
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $path ) ) {
			return self::err( 'فایل اکسل (.xlsx) معتبر نیست.' );
		}
		$prev = libxml_use_internal_errors( true );

		$shared = array();
		$xml    = $zip->getFromName( 'xl/sharedStrings.xml' );
		if ( $xml ) {
			$sx = simplexml_load_string( $xml, 'SimpleXMLElement', LIBXML_NONET );
			if ( $sx ) {
				foreach ( $sx->si as $si ) {
					$shared[] = self::xml_text( $si );
				}
			}
		}

		$wb   = simplexml_load_string( (string) $zip->getFromName( 'xl/workbook.xml' ), 'SimpleXMLElement', LIBXML_NONET );
		$rels = simplexml_load_string( (string) $zip->getFromName( 'xl/_rels/workbook.xml.rels' ), 'SimpleXMLElement', LIBXML_NONET );
		if ( ! $wb || ! $rels ) {
			$zip->close();
			libxml_use_internal_errors( $prev );
			return self::err( 'فایل اکسل (.xlsx) معتبر نیست.' );
		}
		$targets = array();
		foreach ( $rels->Relationship as $rel ) {
			$t                                   = (string) $rel['Target'];
			$t                                   = 0 === strpos( $t, '/' ) ? ltrim( $t, '/' ) : 'xl/' . $t;
			$targets[ (string) $rel['Id'] ] = $t;
		}
		$sheets = array();
		foreach ( $wb->sheets->sheet as $sheet ) {
			$rid = (string) $sheet->attributes( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' )->id;
			if ( ! isset( $targets[ $rid ] ) ) {
				continue;
			}
			$sx = simplexml_load_string( (string) $zip->getFromName( $targets[ $rid ] ), 'SimpleXMLElement', LIBXML_NONET );
			if ( ! $sx ) {
				continue;
			}
			$rows = array();
			foreach ( $sx->sheetData->row as $row ) {
				$vals = array();
				foreach ( $row->c as $c ) {
					$type = (string) $c['t'];
					if ( 'inlineStr' === $type ) {
						$v = self::xml_text( $c->is );
					} elseif ( 's' === $type ) {
						$i = (int) $c->v;
						$v = isset( $shared[ $i ] ) ? $shared[ $i ] : '';
					} else {
						$v = isset( $c->v ) ? (string) $c->v : '';
					}
					$vals[ self::col_index( (string) $c['r'] ) ] = $v;
				}
				if ( $vals ) {
					$line = array_fill( 0, max( array_keys( $vals ) ) + 1, '' );
					foreach ( $vals as $k => $v ) {
						$line[ $k ] = $v;
					}
					$rows[] = $line;
				}
			}
			$sheets[] = array( 'name' => (string) $sheet['name'], 'rows' => $rows );
		}
		$zip->close();
		libxml_use_internal_errors( $prev );
		return $sheets;
	}

	/**
	 * Turns workbook sheets into task rows grouped by person name.
	 * Per-person sheets are preferred; an overview sheet with a «نفر» column is used only when there are none.
	 *
	 * @return array<string,array> person => rows
	 */
	public static function parse( array $sheets ) {
		$people = array();
		$team   = array();
		foreach ( $sheets as $sheet ) {
			$head = -1;
			$cols = array();
			foreach ( array_slice( $sheet['rows'], 0, 8 ) as $ri => $row ) {
				$names = array_map( array( __CLASS__, 'norm' ), $row );
				if ( array_intersect( array( 'ریزتسک', 'عنوان', 'تسک', 'عنوان تسک' ), $names ) ) {
					$head = $ri;
					foreach ( $names as $ci => $n ) {
						if ( '' !== $n && ! isset( $cols[ $n ] ) ) {
							$cols[ $n ] = $ci;
						}
					}
					break;
				}
			}
			if ( $head < 0 ) {
				continue;
			}
			$get = function ( $row, $keys ) use ( $cols ) {
				foreach ( (array) $keys as $k ) {
					$k = self::norm( $k );
					if ( isset( $cols[ $k ] ) && isset( $row[ $cols[ $k ] ] ) && '' !== trim( (string) $row[ $cols[ $k ] ] ) ) {
						return trim( (string) $row[ $cols[ $k ] ] );
					}
				}
				return '';
			};
			$by_row = isset( $cols['نفر'] ) || isset( $cols['مسئول'] );
			foreach ( array_slice( $sheet['rows'], $head + 1 ) as $row ) {
				$title = $get( $row, array( 'ریزتسک', 'عنوان تسک', 'عنوان', 'تسک' ) );
				if ( '' === $title ) {
					continue;
				}
				$date = self::to_date( $get( $row, 'میلادی' ) );
				if ( ! $date ) {
					$date = self::to_date( $get( $row, 'تاریخ' ) );
				}
				// Total/summary lines under the table have neither a date nor an ID.
				if ( ! $date && '' === $get( $row, array( 'شناسه', 'کد' ) ) ) {
					continue;
				}
				$person = $by_row ? $get( $row, array( 'نفر', 'مسئول' ) ) : $sheet['name'];
				if ( '' === $person ) {
					continue;
				}
				$time    = self::latin( $get( $row, 'ساعت' ) );
				$pct     = self::latin( $get( $row, 'درصد پیشرفت' ) );
				$minutes = self::latin( $get( $row, array( 'زمان (دقیقه)', 'زمان' ) ) );
				$item    = array(
					'code'     => $get( $row, array( 'شناسه', 'کد' ) ),
					'title'    => $title,
					'date'     => $date,
					'time'     => preg_match( '/^(\d{1,2}):(\d{2})/', $time, $tm ) ? sprintf( '%02d:%s', $tm[1], $tm[2] ) : '',
					'project'  => $get( $row, 'پروژه' ),
					'week'     => $get( $row, 'هفته' ),
					'goal'     => $get( $row, 'هدف روز' ),
					'priority' => $get( $row, 'اولویت' ),
					'minutes'  => is_numeric( $minutes ) ? (string) round( (float) $minutes ) : $minutes,
					'output'   => $get( $row, array( 'خروجی / معیار انجام', 'خروجی' ) ),
					'deadline' => $get( $row, 'ددلاین پروژه' ),
					'today'    => $get( $row, 'ددلاین امروز' ),
					'status'   => $get( $row, 'وضعیت' ),
					'percent'  => is_numeric( $pct ) ? (string) ( (float) $pct > 0 && (float) $pct <= 1 && false === strpos( $pct, '%' ) ? round( (float) $pct * 100 ) : round( (float) $pct ) ) : '',
					'notes'    => $get( $row, array( 'توضیحات', 'شرح' ) ),
				);
				if ( $by_row ) {
					$team[ $person ][] = $item;
				} else {
					$people[ $person ][] = $item;
				}
			}
		}
		return $people ? $people : $team;
	}

	/**
	 * One task per person, day and project: the sheet's sub-tasks (ریزتسک) become that task's checklist.
	 *
	 * @return array<int,array> groups in sheet order
	 */
	public static function group( array $rows ) {
		$out = array();
		$idx = array();
		$pri = array( 'low' => 0, 'medium' => 1, 'high' => 2 );
		foreach ( $rows as $x ) {
			if ( ! $x['date'] ) {
				continue;
			}
			$k = $x['date'] . '|' . self::norm( $x['project'] );
			if ( ! isset( $idx[ $k ] ) ) {
				$idx[ $k ] = count( $out );
				$out[]     = array(
					'code'     => $x['code'],
					'date'     => $x['date'],
					'time'     => $x['time'],
					'project'  => $x['project'],
					'title'    => '' !== $x['goal'] ? $x['goal'] : ( '' !== $x['project'] ? $x['project'] : $x['title'] ),
					'week'     => $x['week'],
					'goal'     => $x['goal'],
					'priority' => $x['priority'],
					'deadline' => $x['deadline'],
					'today'    => '',
					'minutes'  => 0,
					'blocked'  => false,
					'items'    => array(),
				);
			}
			$g = &$out[ $idx[ $k ] ];
			list( $st, $blocked ) = self::status( $x['status'] );
			if ( $pri[ self::priority( $x['priority'] ) ] > $pri[ self::priority( $g['priority'] ) ] ) {
				$g['priority'] = $x['priority'];
			}
			if ( '' !== $x['today'] ) {
				$g['today'] = $x['today'];
			}
			if ( '' === $g['code'] ) {
				$g['code'] = $x['code'];
			}
			$g['minutes'] += is_numeric( $x['minutes'] ) ? (int) $x['minutes'] : 0;
			$g['blocked']  = $g['blocked'] || (bool) $blocked;
			$g['items'][]  = array( 'title' => $x['title'], 'status' => $st, 'code' => $x['code'], 'minutes' => $x['minutes'], 'output' => $x['output'], 'notes' => $x['notes'], 'percent' => $x['percent'] );
			unset( $g );
		}
		foreach ( $out as &$g ) {
			$st          = wp_list_pluck( $g['items'], 'status' );
			$g['status'] = count( array_filter( $st, function ( $v ) { return 'done' === $v; } ) ) === count( $st ) ? 'done' : ( array_intersect( array( 'doing', 'done' ), $st ) ? 'doing' : 'todo' );
			if ( 1 === count( $g['items'] ) && '' === $g['project'] && '' === $g['goal'] ) {
				$g['title'] = $g['items'][0]['title'];
			}
		}
		unset( $g );
		return $out;
	}

	/** @return array<string,int> normalized project name => id */
	private static function project_names() {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . self::t( 'projects' ) . ' ORDER BY id' ) as $p ) {
			$out[ self::norm( $p->name ) ] = (int) $p->id;
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Preview */

	/** Best panel user for a name from the sheet: saved choice, exact, then a name that contains it. */
	private static function guess_user( $name, array $saved ) {
		$key = self::norm( $name );
		if ( isset( $saved[ $key ] ) && MP_Util::is_panel_user( (int) $saved[ $key ] ) ) {
			return (int) $saved[ $key ];
		}
		$best = 0;
		foreach ( MP_Util::panel_users() as $id ) {
			$u = get_userdata( $id );
			if ( ! $u ) {
				continue;
			}
			$full = self::norm( $u->display_name );
			if ( $full === $key || self::norm( $u->user_login ) === $key ) {
				return (int) $id;
			}
			$words = explode( ' ', $full );
			if ( ! $best && ( in_array( $key, $words, true ) || ( mb_strlen( $key ) > 2 && false !== mb_strpos( $full, $key ) ) ) ) {
				$best = (int) $id;
			}
		}
		return $best;
	}

	/** POST tasks/import/preview (multipart file) → people found in the file with a suggested panel user. */
	public static function preview( WP_REST_Request $r ) {
		$files = $r->get_file_params();
		$f     = isset( $files['file'] ) ? $files['file'] : null;
		if ( ! $f || ! empty( $f['error'] ) || empty( $f['tmp_name'] ) || ! is_uploaded_file( $f['tmp_name'] ) ) {
			return self::err( 'فایل اکسل دریافت نشد.' );
		}
		if ( ! preg_match( '/\.xlsx$/i', (string) $f['name'] ) ) {
			return self::err( 'فقط فایل اکسل با پسوند .xlsx پذیرفته می‌شود.' );
		}
		$sheets = self::read_xlsx( $f['tmp_name'] );
		if ( is_wp_error( $sheets ) ) {
			return $sheets;
		}
		$people = self::parse( $sheets );
		if ( ! $people ) {
			return self::err( 'در این فایل ستونی به نام «ریزتسک» (یا «عنوان») پیدا نشد؛ ساختار فایل با قالب برنامه تیم یکی نیست.' );
		}
		$groups = array();
		foreach ( $people as $name => $rows ) {
			$groups[ $name ] = self::group( $rows );
		}
		$token = strtolower( wp_generate_password( 20, false ) );
		set_transient( 'mp_tio_' . get_current_user_id() . '_' . $token, array( 'file' => sanitize_file_name( $f['name'] ), 'people' => $people, 'groups' => $groups ), HOUR_IN_SECONDS );

		$saved = get_option( self::MAPPING, array() );
		$saved = is_array( $saved ) ? $saved : array();
		$out   = array();
		$names = self::project_names();
		$pmap  = get_option( self::PMAP, array() );
		$pmap  = is_array( $pmap ) ? $pmap : array();
		$found = array();
		foreach ( $people as $name => $rows ) {
			$dates = array_filter( wp_list_pluck( $rows, 'date' ) );
			$bad   = count( $rows ) - count( $dates );
			foreach ( $rows as $x ) {
				if ( '' === $x['project'] ) {
					continue;
				}
				$pk = self::norm( $x['project'] );
				if ( ! isset( $found[ $pk ] ) ) {
					// Saved choice from an earlier import, then a project with the same name, else «new project».
					$guess        = isset( $pmap[ $pk ] ) && ( -1 === (int) $pmap[ $pk ] || in_array( (int) $pmap[ $pk ], $names, true ) ) ? (int) $pmap[ $pk ] : ( isset( $names[ $pk ] ) ? $names[ $pk ] : 0 );
					$found[ $pk ] = array( 'name' => $x['project'], 'count' => 0, 'project_id' => $guess );
				}
				++$found[ $pk ]['count'];
			}
			$out[] = array(
				'name'    => (string) $name,
				'count'   => count( $rows ),
				'invalid' => $bad,
				'from'    => $dates ? min( $dates ) : '',
				'to'      => $dates ? max( $dates ) : '',
				'user_id' => self::guess_user( $name, $saved ),
				'tasks'   => array_map(
					function ( $g ) {
						return array( 'date' => $g['date'], 'title' => $g['title'], 'project' => $g['project'], 'status' => $g['status'], 'minutes' => $g['minutes'], 'goal' => $g['goal'], 'items' => array_map( function ( $i ) { return array( 'title' => $i['title'], 'done' => 'done' === $i['status'], 'minutes' => $i['minutes'], 'output' => $i['output'] ); }, $g['items'] ) );
					},
					$groups[ $name ]
				),
			);
		}
		return array(
			'token'        => $token,
			'file'         => sanitize_file_name( $f['name'] ),
			'people'       => $out,
			'projects'     => array_values( $found ),
		);
	}

	/* ------------------------------------------------------------------ Import */

	private static function find_existing( $user_id, $code ) {
		global $wpdb;
		if ( '' === $code ) {
			return null;
		}
		if ( preg_match( '/^#(\d+)$/', $code, $m ) ) {
			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE id = %d', (int) $m[1] ), ARRAY_A );
			return $row && ( (int) $row['user_id'] === (int) $user_id ) ? $row : null;
		}
		$like = $wpdb->esc_like( 'شناسه: ' . $code ) . '%';
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE user_id = %d AND description LIKE %s', $user_id, $like ), ARRAY_A ) as $row ) {
			$first = strtok( (string) $row['description'], "\n" );
			if ( 'شناسه: ' . $code === $first ) {
				return $row;
			}
		}
		return null;
	}

	/** POST tasks/import {token, map: {name: user_id}, create_projects: bool} */
	public static function import( WP_REST_Request $r ) {
		global $wpdb;
		$me   = get_current_user_id();
		$key  = 'mp_tio_' . $me . '_' . preg_replace( '/[^a-z0-9]/', '', (string) $r['token'] );
		$data = get_transient( $key );
		if ( ! $data || ! isset( $data['groups'] ) ) {
			return self::err( 'پیش‌نمایش منقضی شده است؛ فایل را دوباره انتخاب کنید.' );
		}
		$map = is_array( $r['map'] ) ? $r['map'] : array();
		$use = array();
		foreach ( $data['people'] as $name => $rows ) {
			$uid = isset( $map[ $name ] ) ? (int) $map[ $name ] : 0;
			if ( $uid && MP_Util::is_panel_user( $uid ) ) {
				$use[ $name ] = $uid;
			}
		}
		if ( ! $use ) {
			return self::err( 'هیچ فردی به کاربران پنل وصل نشده است.' );
		}
		// Project in the file → panel project id, 0 = create a new one, -1 = no project.
		$choice = array();
		foreach ( is_array( $r['project_map'] ) ? $r['project_map'] : array() as $name => $pid ) {
			$pid = (int) $pid;
			if ( $pid > 0 && ! in_array( $pid, self::project_names(), true ) ) {
				$pid = 0;
			}
			$choice[ self::norm( $name ) ] = max( -1, $pid );
		}
		$pmap = get_option( self::PMAP, array() );
		update_option( self::PMAP, array_merge( is_array( $pmap ) ? $pmap : array(), $choice ), false );

		// Safety net on top of the per-import undo: a full panel backup, as before any restore.
		if ( class_exists( 'MP_Backup' ) ) {
			try {
				MP_Backup::write( 'before-task-import' );
			} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
			}
		}

		$saved = get_option( self::MAPPING, array() );
		$saved = is_array( $saved ) ? $saved : array();
		foreach ( $use as $name => $uid ) {
			$saved[ self::norm( $name ) ] = $uid;
		}
		update_option( self::MAPPING, $saved, false );

		$projects = self::project_names();
		foreach ( $choice as $pk => $pid ) {
			if ( 0 !== $pid ) {
				$projects[ $pk ] = $pid;
			}
		}
		$batch = array(
			'id'       => strtolower( wp_generate_password( 10, false ) ),
			'time'     => MP_Util::now(),
			'by'       => $me,
			'file'     => $data['file'],
			'people'   => array(),
			'created'  => array(),
			'updated'  => array(),
			'projects' => array(),
			'members'  => array(),
			'skipped'  => 0,
			'undone'   => false,
		);
		$per_user = array();

		foreach ( $use as $name => $uid ) {
			$batch['people'][] = array( 'name' => $name, 'user_id' => $uid );
			$batch['skipped'] += count( array_filter( $data['people'][ $name ], function ( $x ) { return ! $x['date']; } ) );
			foreach ( $data['groups'][ $name ] as $x ) {
				$pid = 0;
				if ( '' !== $x['project'] ) {
					$pk = self::norm( $x['project'] );
					if ( isset( $projects[ $pk ] ) ) {
						$pid = max( 0, $projects[ $pk ] );
					} else {
						$pid = self::make_project( $x['project'], $data['people'], $me );
						$projects[ $pk ]     = $pid;
						$batch['projects'][] = $pid;
					}
					if ( $pid && ! in_array( $uid, MP_Util::project_members( $pid ), true ) ) {
						$wpdb->insert( self::t( 'project_members' ), array( 'project_id' => $pid, 'user_id' => $uid ) );
						if ( ! in_array( $pid, $batch['projects'], true ) ) {
							$batch['members'][] = array( $pid, $uid );
						}
					}
				}
				$status = $x['status'];
				$lines  = array();
				foreach ( $x['items'] as $it ) {
					$bits = array_filter( array( '' !== $it['output'] ? 'خروجی: ' . $it['output'] : '', '' !== (string) $it['minutes'] ? $it['minutes'] . ' دقیقه' : '', 'done' !== $it['status'] && '' !== $it['percent'] && '0' !== $it['percent'] ? $it['percent'] . '٪' : '', $it['notes'] ) );
					$lines[] = '• ' . ( '' !== $it['code'] ? $it['code'] . ' ' : '' ) . $it['title'] . ( $bits ? ' — ' . implode( ' · ', $bits ) : '' );
				}
				$notes = implode( "\n", $lines );
				if ( '' !== $x['project'] && ! $pid ) {
					$notes = 'پروژه: ' . $x['project'] . "\n" . $notes;
				}
				$desc = self::build_description(
					array(
						'شناسه'        => $x['code'],
						'هفته'         => $x['week'],
						'هدف روز'      => $x['goal'],
						'اولویت'       => $x['priority'],
						'زمان (دقیقه)' => $x['minutes'] ? (string) $x['minutes'] : '',
						'ددلاین پروژه' => $x['deadline'],
						'ددلاین امروز' => $x['today'],
						'وضعیت'        => $x['blocked'] && 'done' !== $status ? 'مسدود' : '',
					),
					$notes
				);
				$row = array(
					'user_id'     => $uid,
					'title'       => MP_Util::text( $x['title'], 200 ),
					'description' => MP_Util::long_text( $desc, 4000 ),
					'task_date'   => $x['date'],
					'task_time'   => $x['time'],
					'project_id'  => $pid,
					'priority'    => self::priority( $x['priority'] ),
					'status'      => $status,
				);
				$old = self::find_existing( $uid, $x['code'] );
				if ( $old ) {
					if ( (int) $old['project_id'] !== $pid ) {
						$row['section_id'] = 0;
					}
					$row['done_at']    = 'done' === $status ? ( $old['done_at'] ? $old['done_at'] : MP_Util::now() ) : null;
					$row['updated_at'] = MP_Util::now();
					$wpdb->update( self::t( 'tasks' ), $row, array( 'id' => (int) $old['id'] ) );
					$old['_items']      = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'task_items' ) . ' WHERE task_id = %d', (int) $old['id'] ), ARRAY_A );
					$batch['updated'][] = $old;
					$tid                = (int) $old['id'];
					$wpdb->delete( self::t( 'task_items' ), array( 'task_id' => $tid ) );
				} else {
					$row += array(
						'source'      => 'manager',
						'assigned_by' => $me,
						'recurrence'  => 'none',
						'done_at'     => 'done' === $status ? MP_Util::now() : null,
						'created_at'  => MP_Util::now(),
						'updated_at'  => MP_Util::now(),
					);
					$wpdb->insert( self::t( 'tasks' ), $row );
					$tid                = (int) $wpdb->insert_id;
					$batch['created'][] = $tid;
					$per_user[ $uid ]   = isset( $per_user[ $uid ] ) ? $per_user[ $uid ] + 1 : 1;
				}
				foreach ( $x['items'] as $i => $it ) {
					$wpdb->insert( self::t( 'task_items' ), array( 'task_id' => $tid, 'text' => MP_Util::text( $it['title'], 200 ), 'done' => 'done' === $it['status'] ? 1 : 0, 'sort' => $i ) );
				}
			}
		}

		$history = self::load_history();
		array_unshift( $history, $batch );
		self::save_history( $history );
		delete_transient( $key );

		$who = implode( '، ', array_map( function ( $p ) { $u = get_userdata( $p['user_id'] ); return $u ? $u->display_name : $p['name']; }, $batch['people'] ) );
		MP_Audit::log( 'import', 'task', 0, 'ورود از اکسل «' . $data['file'] . '»: ' . MP_Jalali::digits( count( $batch['created'] ) ) . ' تسک جدید، ' . MP_Jalali::digits( count( $batch['updated'] ) ) . ' به‌روزرسانی برای ' . $who );
		foreach ( $per_user as $uid => $n ) {
			if ( $uid !== $me ) {
				MP_Notify::send( $uid, 'task', wp_get_current_user()->display_name . ' برنامه کاری شما را از اکسل وارد کرد', MP_Jalali::digits( $n ) . ' تسک جدید در تقویم شما', 'calendar', 0, MP_Rest::wants_email( $uid ) );
			}
		}
		return array( 'batch' => self::summary( $batch ), 'history' => self::history() );
	}

	private static function make_project( $name, array $people, $me ) {
		global $wpdb;
		$dates = array();
		foreach ( $people as $rows ) {
			foreach ( $rows as $x ) {
				if ( $x['date'] && self::norm( $x['project'] ) === self::norm( $name ) ) {
					$dates[] = $x['date'];
				}
			}
		}
		$start = $dates ? min( $dates ) : MP_Util::today();
		$end   = $dates ? max( $dates ) : MP_Util::add_days( $start, 30 );
		$name  = MP_Util::text( $name, 160 );
		$wpdb->insert( self::t( 'projects' ), array( 'name' => $name, 'icon' => 'grid', 'status' => 'doing', 'start_date' => $start, 'end_date' => $end, 'created_by' => $me, 'created_at' => MP_Util::now() ) );
		$pid = (int) $wpdb->insert_id;
		$wpdb->insert( self::t( 'project_members' ), array( 'project_id' => $pid, 'user_id' => $me ) );
		$wpdb->insert( self::t( 'channels' ), array( 'type' => 'project', 'project_id' => $pid, 'title' => $name, 'created_by' => $me, 'created_at' => MP_Util::now() ) );
		MP_Audit::log( 'create', 'project', $pid, 'پروژه «' . $name . '» (ورود از اکسل)' );
		return $pid;
	}

	/* ------------------------------------------------------------------ History & undo */

	private static function load_history() {
		$h = get_option( self::HISTORY, array() );
		return is_array( $h ) ? $h : array();
	}

	private static function save_history( array $h ) {
		update_option( self::HISTORY, array_slice( $h, 0, self::KEEP ), false );
	}

	private static function summary( array $b ) {
		$u = get_userdata( $b['by'] );
		return array(
			'id'       => $b['id'],
			'time'     => $b['time'],
			'by'       => $u ? $u->display_name : '',
			'file'     => $b['file'],
			'people'   => array_map( function ( $p ) { $u = get_userdata( $p['user_id'] ); return array( 'name' => $p['name'], 'user' => $u ? $u->display_name : '' ); }, $b['people'] ),
			'created'  => count( $b['created'] ),
			'updated'  => count( $b['updated'] ),
			'projects' => count( $b['projects'] ),
			'skipped'  => (int) $b['skipped'],
			'undone'   => ! empty( $b['undone'] ),
		);
	}

	public static function history( $r = null ) {
		if ( $r instanceof WP_REST_Request && $r['with'] ) {
			return array( 'imports' => self::history(), 'resets' => self::resets() );
		}
		return array_map( array( __CLASS__, 'summary' ), self::load_history() );
	}

	/** POST tasks/imports/{id}/undo — puts tasks and projects back the way they were before that import. */
	public static function undo( WP_REST_Request $r ) {
		global $wpdb;
		$history = self::load_history();
		$found   = null;
		foreach ( $history as $i => $b ) {
			if ( $b['id'] === (string) $r['id'] ) {
				$found = $i;
			}
		}
		if ( null === $found ) {
			return self::err( 'این ورود پیدا نشد.', 404 );
		}
		$b = $history[ $found ];
		if ( ! empty( $b['undone'] ) ) {
			return self::err( 'این ورود قبلاً بازگردانده شده است.' );
		}
		foreach ( $b['created'] as $id ) {
			foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'files' ) . " WHERE context = 'task' AND context_id = %d", $id ) ) as $fid ) {
				MP_Files::delete( $fid );
			}
			foreach ( $wpdb->get_col( $wpdb->prepare( 'SELECT file_id FROM ' . self::t( 'task_comments' ) . ' WHERE task_id = %d AND file_id > 0', $id ) ) as $fid ) {
				MP_Files::delete( $fid );
			}
			$wpdb->delete( self::t( 'task_items' ), array( 'task_id' => $id ) );
			$wpdb->delete( self::t( 'task_comments' ), array( 'task_id' => $id ) );
			$wpdb->delete( self::t( 'tasks' ), array( 'id' => $id ) );
		}
		foreach ( array_reverse( $b['updated'] ) as $old ) {
			$id    = (int) $old['id'];
			$items = isset( $old['_items'] ) ? $old['_items'] : null;
			unset( $old['id'], $old['_items'] );
			if ( null !== $items ) {
				$wpdb->delete( self::t( 'task_items' ), array( 'task_id' => $id ) );
				foreach ( $items as $it ) {
					$wpdb->insert( self::t( 'task_items' ), $it );
				}
			}
			$wpdb->update( self::t( 'tasks' ), $old, array( 'id' => $id ) );
		}
		foreach ( $b['members'] as $m ) {
			$wpdb->delete( self::t( 'project_members' ), array( 'project_id' => (int) $m[0], 'user_id' => (int) $m[1] ) );
		}
		$kept = 0;
		foreach ( $b['projects'] as $pid ) {
			// A project someone has since put their own tasks in stays.
			if ( (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . self::t( 'tasks' ) . ' WHERE project_id = %d', $pid ) ) ) {
				++$kept;
				continue;
			}
			$req = new WP_REST_Request( 'DELETE' );
			$req->set_param( 'id', $pid );
			MP_Rest::delete_project( $req );
		}
		$history[ $found ]['undone'] = true;
		self::save_history( $history );
		MP_Audit::log( 'undo', 'task', 0, 'بازگردانی ورود اکسل «' . $b['file'] . '»: ' . MP_Jalali::digits( count( $b['created'] ) ) . ' تسک حذف و ' . MP_Jalali::digits( count( $b['updated'] ) ) . ' تسک به حالت قبل برگشت' );
		return array( 'removed' => count( $b['created'] ), 'restored' => count( $b['updated'] ), 'projects_kept' => $kept, 'history' => self::history() );
	}

	/* ------------------------------------------------------------------ Tasks-only factory reset */

	const RESET_TABLES = array( 'tasks', 'task_items', 'task_comments' );

	private static function load_resets() {
		$h = get_option( self::RESETS, array() );
		return is_array( $h ) ? $h : array();
	}

	private static function reset_summary( array $x ) {
		$u = get_userdata( $x['by'] );
		return array( 'id' => $x['id'], 'time' => $x['time'], 'by' => $u ? $u->display_name : '', 'count' => (int) $x['count'], 'restored' => ! empty( $x['restored'] ) );
	}

	public static function resets() {
		return array_map( array( __CLASS__, 'reset_summary' ), self::load_resets() );
	}

	private static function snapshot_path( $id ) {
		return MP_Backup::dir() . '/tasks-snapshot-' . preg_replace( '/[^a-z0-9]/', '', $id ) . '.json';
	}

	/**
	 * POST tasks/reset {confirm: "حذف همه تسک‌ها"} — removes every task (with checklists and comments) for
	 * everyone. Projects, people, accounting and time logs stay. A snapshot is saved first so it can be restored.
	 */
	public static function reset( WP_REST_Request $r ) {
		global $wpdb;
		if ( 'حذف همه تسک‌ها' !== trim( (string) $r['confirm'] ) ) {
			return self::err( 'برای تأیید، عبارت «حذف همه تسک‌ها» را دقیق بنویسید.' );
		}
		$snap = array( 'format' => 'moraba-tasks-snapshot', 'created' => gmdate( 'c' ), 'tables' => array() );
		foreach ( self::RESET_TABLES as $t ) {
			$snap['tables'][ $t ] = $wpdb->get_results( 'SELECT * FROM ' . self::t( $t ), ARRAY_A ); // phpcs:ignore
		}
		$id = strtolower( wp_generate_password( 10, false ) );
		if ( false === file_put_contents( self::snapshot_path( $id ), wp_json_encode( $snap ) ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			return self::err( 'ذخیره نسخه پشتیبان تسک‌ها ممکن نشد؛ چیزی پاک نشد.', 500 );
		}
		$count = count( $snap['tables']['tasks'] );
		foreach ( self::RESET_TABLES as $t ) {
			$wpdb->query( 'DELETE FROM ' . self::t( $t ) ); // phpcs:ignore
		}
		// Earlier imports point at tasks that are gone; their undo no longer applies.
		$history = self::load_history();
		foreach ( $history as &$b ) {
			$b['undone'] = true;
		}
		unset( $b );
		self::save_history( $history );

		$list = self::load_resets();
		array_unshift( $list, array( 'id' => $id, 'time' => MP_Util::now(), 'by' => get_current_user_id(), 'count' => $count, 'restored' => false ) );
		foreach ( array_slice( $list, self::KEEP ) as $old ) {
			wp_delete_file( self::snapshot_path( $old['id'] ) );
		}
		update_option( self::RESETS, array_slice( $list, 0, self::KEEP ), false );
		MP_Audit::log( 'reset', 'task', 0, 'ریست تسک‌ها: ' . MP_Jalali::digits( $count ) . ' تسک برای همه حذف شد' );
		return array( 'removed' => $count, 'resets' => self::resets(), 'history' => self::history() );
	}

	/** POST tasks/resets/{id}/restore — puts back every task from that reset (tasks added since then stay). */
	public static function restore( WP_REST_Request $r ) {
		global $wpdb;
		$list = self::load_resets();
		foreach ( $list as $i => $x ) {
			if ( $x['id'] !== (string) $r['id'] ) {
				continue;
			}
			$path = self::snapshot_path( $x['id'] );
			$snap = is_file( $path ) ? json_decode( (string) file_get_contents( $path ), true ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions
			if ( ! is_array( $snap ) || empty( $snap['tables'] ) ) {
				return self::err( 'فایل پشتیبان این ریست پیدا نشد.', 404 );
			}
			$n = 0;
			foreach ( self::RESET_TABLES as $t ) {
				foreach ( isset( $snap['tables'][ $t ] ) ? $snap['tables'][ $t ] : array() as $row ) {
					$wpdb->replace( self::t( $t ), $row );
					$n += 'tasks' === $t ? 1 : 0;
				}
			}
			$list[ $i ]['restored'] = true;
			update_option( self::RESETS, $list, false );
			MP_Audit::log( 'undo', 'task', 0, 'بازگردانی ریست تسک‌ها: ' . MP_Jalali::digits( $n ) . ' تسک برگشت' );
			return array( 'restored' => $n, 'resets' => self::resets() );
		}
		return self::err( 'این ریست پیدا نشد.', 404 );
	}

	/** ?mp_export=tasks&snapshot=id — the JSON saved before a reset. */
	private static function send_snapshot( $id ) {
		$path = self::snapshot_path( $id );
		if ( ! is_file( $path ) ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="moraba-tasks-backup-' . basename( $path, '.json' ) . '.json"' );
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}

	/* ------------------------------------------------------------------ Export */

	/** ?mp_export=tasks&range=all|month|week&user= — one sheet per person, same layout as the import. */
	public static function export() {
		global $wpdb;
		// phpcs:disable WordPress.Security.NonceVerification
		$range = isset( $_GET['range'] ) ? sanitize_key( wp_unslash( $_GET['range'] ) ) : 'all';
		$only  = isset( $_GET['user'] ) ? (int) $_GET['user'] : 0;
		if ( isset( $_GET['format'] ) && 'json' === $_GET['format'] ) {
			global $wpdb;
			$snap = array( 'format' => 'moraba-tasks-snapshot', 'created' => gmdate( 'c' ), 'tables' => array() );
			foreach ( self::RESET_TABLES as $t ) {
				$snap['tables'][ $t ] = $wpdb->get_results( 'SELECT * FROM ' . self::t( $t ), ARRAY_A ); // phpcs:ignore
			}
			header( 'Content-Type: application/json; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="moraba-tasks-backup-' . MP_Util::today() . '.json"' );
			echo wp_json_encode( $snap ); // phpcs:ignore
			exit;
		}
		if ( ! empty( $_GET['snapshot'] ) ) {
			self::send_snapshot( sanitize_key( wp_unslash( $_GET['snapshot'] ) ) );
		}
		// phpcs:enable
		$today = MP_Util::today();
		$where = array( '1=1' );
		$args  = array();
		if ( 'month' === $range ) {
			list( $from, $to ) = MP_Jalali::month_range( $today );
		} elseif ( 'week' === $range ) {
			$from = MP_Util::week_start( $today );
			$to   = MP_Util::add_days( $from, 6 );
		}
		if ( isset( $from ) ) {
			$where[] = 'task_date BETWEEN %s AND %s';
			$args[]  = $from;
			$args[]  = $to;
		}
		if ( $only ) {
			$where[] = 'user_id = %d';
			$args[]  = $only;
		}
		$sql  = 'SELECT * FROM ' . self::t( 'tasks' ) . ' WHERE ' . implode( ' AND ', $where ) . " ORDER BY user_id, task_date, task_time = '', task_time, id";
		$rows = $args ? $wpdb->get_results( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_results( $sql ); // phpcs:ignore

		$names = array();
		foreach ( $wpdb->get_results( 'SELECT id, name FROM ' . self::t( 'projects' ) ) as $p ) {
			$names[ (int) $p->id ] = $p->name;
		}
		$by   = array();
		$team = array( array( 'نفر', 'شناسه', 'تاریخ', 'روز', 'پروژه', 'ریزتسک', 'زمان (دقیقه)', 'خروجی / معیار انجام', 'ددلاین امروز', 'وضعیت', 'درصد پیشرفت' ) );
		foreach ( $rows as $t ) {
			list( $meta, $notes ) = self::split_description( $t->description );
			$proj = isset( $names[ (int) $t->project_id ] ) ? $names[ (int) $t->project_id ] : '';
			if ( ! $proj && preg_match( '/^پروژه: (.+)$/m', $notes, $pm ) ) {
				$proj  = $pm[1];
				$notes = trim( preg_replace( '/^پروژه: .+$\n?/m', '', $notes, 1 ) );
			}
			$status = 'done' === $t->status ? 'انجام شد' : ( 'doing' === $t->status ? 'در حال انجام' : ( isset( $meta['وضعیت'] ) && 'مسدود' === $meta['وضعیت'] ? 'مسدود' : 'انجام نشده' ) );
			$pct    = 'done' === $t->status ? 100 : ( isset( $meta['درصد پیشرفت'] ) && is_numeric( $meta['درصد پیشرفت'] ) ? (int) $meta['درصد پیشرفت'] : 0 );
			$min    = isset( $meta['زمان (دقیقه)'] ) && is_numeric( $meta['زمان (دقیقه)'] ) ? (int) $meta['زمان (دقیقه)'] : ( isset( $meta['زمان (دقیقه)'] ) ? $meta['زمان (دقیقه)'] : '' );
			$pri    = isset( $meta['اولویت'] ) ? $meta['اولویت'] : array( 'high' => 'فوری', 'medium' => 'متوسط', 'low' => 'کم' )[ $t->priority ] ?? '';
			$code   = isset( $meta['شناسه'] ) ? $meta['شناسه'] : '#' . $t->id;
			$day    = self::DAYS[ (int) gmdate( 'w', strtotime( $t->task_date . ' UTC' ) ) ];
			$items  = $wpdb->get_results( $wpdb->prepare( 'SELECT text, done FROM ' . self::t( 'task_items' ) . ' WHERE task_id = %d ORDER BY sort, id', $t->id ) );
			if ( $items ) {
				// A task with a checklist goes out as one row per checklist item, like the sheet it came from.
				$info = array();
				$rest = array();
				foreach ( preg_split( '/\n/', $notes ) as $line ) {
					if ( preg_match( '/^• (?:([A-Za-z]+-\d+) )?(.+?)(?: — (.*))?$/u', $line, $bm ) ) {
						$info[ trim( $bm[2] ) ] = array( $bm[1], isset( $bm[3] ) ? $bm[3] : '' );
					} else {
						$rest[] = $line;
					}
				}
				$rest = trim( implode( "\n", $rest ) );
				foreach ( $items as $n => $it ) {
					$bi   = isset( $info[ $it->text ] ) ? $info[ $it->text ] : array( '', '' );
					$imin = preg_match( '/(\d+) دقیقه/u', $bi[1], $mm ) ? (int) $mm[1] : '';
					$iout = preg_match( '/خروجی: ([^·]+)/u', $bi[1], $om ) ? trim( $om[1] ) : '';
					$by[ (int) $t->user_id ][] = array(
						'' !== $bi[0] ? $bi[0] : ( 0 === $n ? $code : '' ),
						self::jalali( $t->task_date ),
						$day,
						$t->task_date,
						isset( $meta['هفته'] ) ? $meta['هفته'] : '',
						isset( $meta['هدف روز'] ) ? $meta['هدف روز'] : '',
						$proj ? $proj : $t->title,
						$pri,
						$it->text,
						$imin,
						$iout,
						isset( $meta['ددلاین پروژه'] ) ? $meta['ددلاین پروژه'] : '',
						isset( $meta['ددلاین امروز'] ) ? $meta['ددلاین امروز'] : '',
						$it->done ? 'انجام شد' : ( 'مسدود' === $status ? 'مسدود' : 'انجام نشده' ),
						$it->done ? 100 : 0,
						0 === $n ? $rest : '',
						(string) $t->task_time,
					);
				}
				continue;
			}
			$by[ (int) $t->user_id ][] = array(
				$code,
				self::jalali( $t->task_date ),
				$day,
				$t->task_date,
				isset( $meta['هفته'] ) ? $meta['هفته'] : '',
				isset( $meta['هدف روز'] ) ? $meta['هدف روز'] : '',
				$proj,
				$pri,
				$t->title,
				$min,
				isset( $meta['خروجی / معیار انجام'] ) ? $meta['خروجی / معیار انجام'] : '',
				isset( $meta['ددلاین پروژه'] ) ? $meta['ددلاین پروژه'] : '',
				isset( $meta['ددلاین امروز'] ) ? $meta['ددلاین امروز'] : '',
				$status,
				$pct,
				$notes,
				(string) $t->task_time,
			);
		}
		$sheets = array();
		$used   = array();
		foreach ( $by as $uid => $list ) {
			$u    = get_userdata( $uid );
			$name = $u ? $u->display_name : 'کاربر ' . $uid;
			$name = mb_substr( str_replace( array( '/', '\\', '?', '*', '[', ']', ':' ), ' ', $name ), 0, 28 );
			while ( isset( $used[ $name ] ) ) {
				$name .= ' ';
			}
			$used[ $name ] = 1;
			foreach ( $list as $x ) {
				$team[] = array( $name, $x[0], $x[1], $x[2], $x[6], $x[8], $x[9], $x[10], $x[12], $x[13], $x[14] );
			}
			$sheets[] = array(
				'name'   => $name,
				'rows'   => array_merge( array( self::HEAD ), $list ),
				'widths' => array( 9, 11, 9, 11, 18, 40, 28, 14, 60, 10, 26, 24, 10, 12, 10, 40, 8 ),
			);
		}
		if ( ! $sheets ) {
			$sheets[] = array( 'name' => 'تسک‌ها', 'rows' => array( self::HEAD ), 'widths' => array_fill( 0, 17, 16 ) );
		} else {
			// The overview goes last; import prefers the per-person sheets and ignores it.
			$sheets[] = array( 'name' => 'برنامه تیمی', 'rows' => $team, 'widths' => array( 14, 9, 11, 9, 28, 60, 10, 26, 10, 12, 10 ) );
		}
		MP_Export::workbook( $sheets, 'moraba-tasks-' . ( 'all' === $range ? 'all' : $range ) . '-' . $today . '.xlsx' );
	}
}

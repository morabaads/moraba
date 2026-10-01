<?php
defined( 'ABSPATH' ) || exit;

/**
 * Accounting export: ?mp_export=ledger&format=xlsx|print&from=&to=&_wpnonce=
 * xlsx is a real Excel workbook (right-to-left sheet); print is a clean page that opens the print dialog
 * so it can be saved as PDF with the panel font.
 */
class MP_Export {

	public static function handle( $what ) {
		if ( ! in_array( $what, array( 'ledger', 'payroll', 'tasks', 'meeting' ), true ) || ! is_user_logged_in() || ! current_user_can( in_array( $what, array( 'ledger', 'meeting' ), true ) ? 'mp_access_panel' : 'mp_manage_panel' ) ) {
			status_header( 403 );
			exit( 'Forbidden' );
		}
		$nonce = isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'mp_export' ) ) {
			status_header( 403 );
			exit( 'Expired link; reload the panel.' );
		}
		if ( 'tasks' === $what ) {
			MP_Task_IO::export();
		}
		if ( 'meeting' === $what ) {
			MP_Meet::export( isset( $_GET['id'] ) ? (int) $_GET['id'] : 0 ); // phpcs:ignore WordPress.Security.NonceVerification
		}
		if ( 'payroll' === $what ) {
			$p = MP_Payroll::sheets( isset( $_GET['month'] ) ? sanitize_text_field( wp_unslash( $_GET['month'] ) ) : '' ); // phpcs:ignore WordPress.Security.NonceVerification
			self::workbook( $p['sheets'], $p['file'] );
		}
		// phpcs:disable WordPress.Security.NonceVerification
		$from   = isset( $_GET['from'] ) && MP_Util::valid_date( wp_unslash( $_GET['from'] ) ) ? sanitize_text_field( wp_unslash( $_GET['from'] ) ) : MP_Jalali::month_range( MP_Util::today() )[0];
		$to     = isset( $_GET['to'] ) && MP_Util::valid_date( wp_unslash( $_GET['to'] ) ) ? sanitize_text_field( wp_unslash( $_GET['to'] ) ) : MP_Jalali::month_range( MP_Util::today() )[1];
		$format = isset( $_GET['format'] ) ? sanitize_key( wp_unslash( $_GET['format'] ) ) : 'xlsx';
		// phpcs:enable
		$data = MP_Rest::ledger_rows( $from, $to );
		$rows = array( array( 'تاریخ', 'ساعت', 'نوع', 'بابت', 'دسته', 'دخل (تومان)', 'خرج (تومان)', 'مانده (تومان)', 'ثبت‌کننده', 'توضیحات' ) );
		$rows[] = array( '', '', '', 'مانده از قبل', '', '', '', $data['opening'], '', '' );
		foreach ( $data['items'] as $x ) {
			$rows[] = array(
				MP_Jalali::format( $x['date'] ),
				$x['time'],
				'income' === $x['type'] ? 'دخل' : 'خرج',
				$x['title'],
				$x['category'],
				'income' === $x['type'] ? $x['amount'] : '',
				'expense' === $x['type'] ? $x['amount'] : '',
				$x['balance'],
				$x['author'],
				$x['note'],
			);
		}
		$rows[] = array( '', '', '', 'جمع', '', $data['income'], $data['expense'], $data['opening'] + $data['income'] - $data['expense'], '', '' );
		$title  = 'حسابداری ' . MP_Jalali::format( $from ) . ' تا ' . MP_Jalali::format( $to );
		if ( 'print' === $format ) {
			self::print_page( $title, $rows );
		}
		self::xlsx( $title, $rows, 'moraba-ledger-' . $from . '_' . $to . '.xlsx' );
	}

	private static function esc_xml( $s ) {
		return htmlspecialchars( (string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8' );
	}

	private static function col( $i ) {
		$s = '';
		for ( ++$i; $i > 0; $i = intdiv( $i - 1, 26 ) ) {
			$s = chr( 65 + ( $i - 1 ) % 26 ) . $s;
		}
		return $s;
	}

	private static function xlsx( $title, array $rows, $filename ) {
		self::workbook( array( array( 'name' => 'حسابداری', 'rows' => $rows, 'widths' => array( 16, 8, 7, 34, 16, 16, 16, 18, 16, 40 ) ) ), $filename );
	}

	/** Writes a real .xlsx with one right-to-left sheet per entry ({name, rows, widths}) and exits. */
	public static function workbook( array $sheets, $filename ) {
		$rows = $sheets[0]['rows'];
		if ( ! class_exists( 'ZipArchive' ) ) {
			// Fallback: UTF-8 CSV that Excel opens correctly.
			header( 'Content-Type: text/csv; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename="' . str_replace( '.xlsx', '.csv', $filename ) . '"' );
			echo "\xEF\xBB\xBF"; // phpcs:ignore
			$out = fopen( 'php://output', 'w' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			foreach ( $rows as $r ) {
				fputcsv( $out, $r );
			}
			exit;
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		$tmp = wp_tempnam( 'mp-xlsx' );
		$zip = new ZipArchive();
		$zip->open( $tmp, ZipArchive::OVERWRITE );
		$over = '';
		$rels = '';
		$list = '';
		foreach ( $sheets as $si => $sh ) {
			$n     = $si + 1;
			$over .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
			$rels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
			$name  = mb_substr( str_replace( array( '/', '\\', '?', '*', '[', ']', ':' ), ' ', $sh['name'] ), 0, 31 );
			$list .= '<sheet name="' . self::esc_xml( $name ) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
			$sheet = '';
			$last  = count( $sh['rows'] ) - 1;
			foreach ( $sh['rows'] as $ri => $row ) {
				$sheet .= '<row r="' . ( $ri + 1 ) . '">';
				foreach ( $row as $ci => $v ) {
					$ref   = self::col( $ci ) . ( $ri + 1 );
					$style = 0 === $ri ? ' s="1"' : ( is_int( $v ) ? ' s="2"' : '' );
					if ( is_int( $v ) ) {
						$sheet .= '<c r="' . $ref . '"' . $style . '><v>' . $v . '</v></c>';
					} elseif ( '' !== $v ) {
						$sheet .= '<c r="' . $ref . '" t="inlineStr"' . $style . '><is><t>' . self::esc_xml( $v ) . '</t></is></c>';
					}
				}
				$sheet .= '</row>';
			}
			$cols = '';
			foreach ( $sh['widths'] as $i => $w ) {
				$cols .= '<col min="' . ( $i + 1 ) . '" max="' . ( $i + 1 ) . '" width="' . $w . '" customWidth="1"/>';
			}
			$zip->addFromString( 'xl/worksheets/sheet' . $n . '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1"' . ( 0 === $si ? ' tabSelected="1"' : '' ) . ' workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' . $cols . '</cols><sheetData>' . $sheet . '</sheetData>' . ( $last > 0 ? '<autoFilter ref="A1:' . self::col( count( $sh['rows'][0] ) - 1 ) . ( $last + 1 ) . '"/>' : '' ) . '</worksheet>' );
		}
		$n = count( $sheets ) + 1;
		$zip->addFromString( '[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' . $over . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' );
		$zip->addFromString( '_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' );
		$zip->addFromString( 'xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' );
		$zip->addFromString( 'xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' . $list . '</sheets></workbook>' );
		$zip->addFromString( 'xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Dana"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Dana"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF161616"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>' );
		$zip->close();
		if ( defined( 'MP_TESTING' ) ) {
			return $tmp;
		}
		header( 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
		header( 'Content-Length: ' . filesize( $tmp ) );
		readfile( $tmp ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		wp_delete_file( $tmp );
		exit;
	}

	private static function print_page( $title, array $rows ) {
		$money = function ( $v ) {
			return is_int( $v ) ? MP_Jalali::digits( number_format( $v ) ) : esc_html( MP_Jalali::digits( $v ) );
		};
		?><!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title><?php echo esc_html( $title ); ?></title>
<style>
@font-face{font-family:Dana;src:url(<?php echo esc_url( MP_URL . 'assets/fonts/dana.woff2' ); ?>) format('woff2'),url(<?php echo esc_url( MP_URL . 'assets/fonts/dana.ttf' ); ?>) format('truetype');font-weight:10 990}
body{font:12px Dana,Tahoma,sans-serif;color:#161616;margin:24px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #161616;padding-bottom:12px;margin-bottom:16px}
header img{height:34px}h1{font-size:18px;margin:0}
table{width:100%;border-collapse:collapse}th{background:#161616;color:#fff;font-weight:700}
th,td{padding:7px 8px;border-bottom:1px solid #e5e5e5;text-align:right;vertical-align:top}
tr:nth-child(even) td{background:#fafafa}tr:last-child td{font-weight:700;border-top:2px solid #161616}
.in{color:#1f7a45}.out{color:#b33}@page{size:A4 landscape;margin:12mm}
</style></head><body onload="window.print()">
<header><h1><?php echo esc_html( $title ); ?></h1><img src="<?php echo esc_url( MP_URL . 'assets/img/logo.png' ); ?>" alt="MORABA"></header>
<table><thead><tr><?php foreach ( $rows[0] as $h ) : ?><th><?php echo esc_html( $h ); ?></th><?php endforeach; ?></tr></thead><tbody>
<?php foreach ( array_slice( $rows, 1 ) as $r ) : ?>
<tr><?php foreach ( $r as $i => $v ) : ?><td class="<?php echo 5 === $i ? 'in' : ( 6 === $i ? 'out' : '' ); ?>"><?php echo $money( $v ); // phpcs:ignore ?></td><?php endforeach; ?></tr>
<?php endforeach; ?>
</tbody></table></body></html>
		<?php
		exit;
	}
}

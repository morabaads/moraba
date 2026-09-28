<?php
defined( 'ABSPATH' ) || exit;

/** Change history: who changed what, and when. Managers read it in Reports. */
class MP_Audit {

	const TYPES = array(
		'task'       => 'تسک',
		'ledger'     => 'حسابداری',
		'leave'      => 'مرخصی',
		'attendance' => 'حضور',
		'project'    => 'پروژه',
		'meeting'    => 'جلسه',
		'member'     => 'عضو پروژه',
	);

	public static function log( $action, $type, $id, $summary ) {
		global $wpdb;
		$wpdb->insert(
			MP_Install::table( 'audit' ),
			array(
				'user_id'     => get_current_user_id(),
				'action'      => substr( $action, 0, 20 ),
				'object_type' => substr( $type, 0, 20 ),
				'object_id'   => (int) $id,
				'summary'     => MP_Util::text( $summary, 300 ),
				'created_at'  => MP_Util::now(),
			)
		);
	}

	public static function query( $type = '', $user = 0, $page = 1 ) {
		global $wpdb;
		$where = array( '1=1' );
		$args  = array();
		if ( $type && isset( self::TYPES[ $type ] ) ) {
			$where[] = 'object_type = %s';
			$args[]  = $type;
		}
		if ( $user ) {
			$where[] = 'user_id = %d';
			$args[]  = $user;
		}
		$args[] = 50;
		$args[] = max( 0, ( $page - 1 ) * 50 );
		$rows   = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM ' . MP_Install::table( 'audit' ) . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY id DESC LIMIT %d OFFSET %d', $args )
		);
		$out = array();
		foreach ( $rows as $r ) {
			$u     = get_userdata( $r->user_id );
			$out[] = array(
				'id'         => (int) $r->id,
				'user'       => $u ? $u->display_name : '—',
				'action'     => $r->action,
				'type'       => $r->object_type,
				'type_label' => isset( self::TYPES[ $r->object_type ] ) ? self::TYPES[ $r->object_type ] : $r->object_type,
				'summary'    => $r->summary,
				'created_at' => $r->created_at,
			);
		}
		return $out;
	}
}

<?php
defined( 'ABSPATH' ) || exit;

/**
 * Client portal on the client-group link: project progress, delivered files, designs to approve and
 * the project's invoices, next to the existing chat.
 *
 * Designs: the team uploads an image (a new version replaces the previous one). The client clicks any
 * point of the image and writes a note there (a pin at x%/y%); the team replies in the same thread and
 * marks it resolved. The client approves the design or asks for changes. Every client action notifies
 * the project's members.
 */
class MP_Portal {

	const STATUS = array( 'pending' => 'در انتظار نظر مشتری', 'approved' => 'تأیید شد', 'changes' => 'نیاز به تغییر', 'delivered' => 'تحویل شد', 'superseded' => 'نسخه قبلی' );

	public static function register() {
		$auth  = array( 'MP_Rest', 'can_access' );
		$id    = '(?P<id>\d+)';
		$tok   = 'client/(?P<token>[A-Za-z0-9]{32})';
		$routes = array(
			array( 'portal/items', 'GET', 'items', $auth ),
			array( 'portal/items', 'POST', 'create', $auth ),
			array( "portal/items/$id", 'POST', 'update', $auth ),
			array( "portal/items/$id", 'DELETE', 'archive', $auth ),
			array( "portal/items/$id/pins", 'POST', 'team_pin', $auth ),
			array( "portal/pins/$id/resolve", 'POST', 'resolve', $auth ),
			array( "$tok/portal", 'GET', 'public_portal', '__return_true' ),
			array( "$tok/items/$id/pins", 'POST', 'client_pin', '__return_true' ),
			array( "$tok/items/$id/decision", 'POST', 'client_decision', '__return_true' ),
		);
		foreach ( $routes as $r ) {
			register_rest_route( MP_Rest::NS, '/' . $r[0], array( 'methods' => $r[1], 'callback' => array( __CLASS__, $r[2] ), 'permission_callback' => $r[3] ) );
		}
	}

	private static function t( $n ) {
		return MP_Install::table( $n );
	}

	private static function err( $m, $s = 400 ) {
		return new WP_Error( 'mp_error', $m, array( 'status' => $s ) );
	}

	private static function channel( $token ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND token = %s AND archived_at IS NULL", $token ) );
	}

	private static function get( $id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_items' ) . ' WHERE id = %d AND archived_at IS NULL', $id ) );
	}

	/* ------------------------------------------------------------------ Payloads */

	private static function file_url( $file_id, $token ) {
		$p = MP_Files::payload( MP_Files::get( $file_id ) );
		if ( $p && $token ) {
			$p['url'] = add_query_arg( 't', $token, $p['url'] );
		}
		return $p;
	}

	private static function pins( $item_id ) {
		global $wpdb;
		$out = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'design_pins' ) . ' WHERE item_id = %d ORDER BY id', $item_id ) ) as $p ) {
			$u     = $p->user_id ? get_userdata( $p->user_id ) : null;
			$out[] = array(
				'id'         => (int) $p->id,
				'parent_id'  => (int) $p->parent_id,
				'x'          => (float) $p->x,
				'y'          => (float) $p->y,
				'body'       => $p->body,
				'author'     => $u ? $u->display_name : ( $p->author_name ? $p->author_name : 'مشتری' ),
				'team'       => (bool) $p->user_id,
				'resolved'   => (bool) $p->resolved,
				'created_at' => $p->created_at,
			);
		}
		return $out;
	}

	private static function payload( $x, $token = '' ) {
		return array(
			'id'            => (int) $x->id,
			'project_id'    => (int) $x->project_id,
			'kind'          => $x->kind,
			'title'         => $x->title,
			'note'          => (string) $x->note,
			'version'       => (int) $x->version,
			'status'        => $x->status,
			'file'          => $x->file_id ? self::file_url( $x->file_id, $token ) : null,
			'decision_note' => (string) $x->decision_note,
			'decided_by'    => (string) $x->decided_by,
			'decided_at'    => $x->decided_at,
			'pins'          => 'design' === $x->kind ? self::pins( $x->id ) : array(),
			'created_at'    => $x->created_at,
		);
	}

	/** Every panel member of the project hears about the client's action (the notification opens the project's portal). */
	private static function notify( $pid, $title, $detail, $item_id ) {
		foreach ( MP_Util::project_members( $pid ) as $u ) {
			MP_Notify::send( $u, 'portal', $title, $detail, 'portal', $pid, true );
		}
	}

	/* ------------------------------------------------------------------ Team side */

	/** GET portal/items?project_id= — current and previous versions, newest first. */
	public static function items( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['project_id'];
		if ( ! $pid || ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'پروژه پیدا نشد.', 404 );
		}
		$rows  = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_items' ) . ' WHERE project_id = %d AND archived_at IS NULL ORDER BY id DESC', $pid ) );
		$links = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, title, token, client_id FROM ' . self::t( 'channels' ) . " WHERE type = 'client' AND project_id = %d AND archived_at IS NULL", $pid ) ) as $c ) {
			$links[] = array( 'id' => (int) $c->id, 'title' => $c->title, 'url' => MP_Client::url( $c->token ), 'client_id' => (int) $c->client_id );
		}
		$customers = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT c.id, c.name, c.phone FROM ' . self::t( 'clients' ) . ' c JOIN ' . self::t( 'client_projects' ) . ' cp ON cp.client_id = c.id WHERE cp.project_id = %d AND c.archived_at IS NULL ORDER BY c.name', $pid ) ) as $c ) {
			$customers[] = array( 'id' => (int) $c->id, 'name' => $c->name, 'phone' => $c->phone );
		}
		return array( 'items' => array_map( array( __CLASS__, 'payload' ), $rows ), 'links' => $links, 'customers' => $customers, 'project' => MP_Client::project_summary( $pid ) );
	}

	/** POST portal/items {project_id, kind: design|file, title, note, file_id, replaces?} */
	public static function create( WP_REST_Request $r ) {
		global $wpdb;
		$pid = (int) $r['project_id'];
		if ( ! $pid || ! MP_Util::can_see_project( $pid ) ) {
			return self::err( 'پروژه پیدا نشد.', 404 );
		}
		$kind  = 'design' === $r['kind'] ? 'design' : 'file';
		$title = MP_Util::text( $r['title'], 200 );
		$file  = MP_Files::get( (int) $r['file_id'] );
		if ( ! $file || 'client_item' !== $file->context || (int) $file->context_id !== $pid ) {
			return self::err( 'اول فایل را بارگذاری کنید.' );
		}
		if ( 'design' === $kind && 0 !== strpos( $file->mime, 'image/' ) ) {
			return self::err( 'طرح برای تأیید باید تصویر باشد (JPG، PNG یا WebP).' );
		}
		$version = 1;
		$old     = (int) $r['replaces'] ? self::get( (int) $r['replaces'] ) : null;
		if ( $old && (int) $old->project_id === $pid ) {
			$version = (int) $old->version + 1;
			$title   = '' !== $title ? $title : $old->title;
			$wpdb->update( self::t( 'client_items' ), array( 'status' => 'superseded' ), array( 'id' => $old->id ) );
		}
		if ( '' === $title ) {
			$title = preg_replace( '/\.[^.]+$/', '', $file->name );
		}
		$wpdb->insert(
			self::t( 'client_items' ),
			array(
				'project_id' => $pid,
				'kind'       => $kind,
				'title'      => $title,
				'note'       => MP_Util::long_text( $r['note'], 2000 ),
				'file_id'    => (int) $file->id,
				'version'    => $version,
				'parent_id'  => $old ? (int) ( $old->parent_id ? $old->parent_id : $old->id ) : 0,
				'status'     => 'design' === $kind ? 'pending' : 'delivered',
				'created_by' => get_current_user_id(),
				'created_at' => MP_Util::now(),
			)
		);
		$id = (int) $wpdb->insert_id;
		// The client sees it in the conversation too, with a button that opens it.
		MP_Client::system(
			0,
			$pid,
			'design' === $kind
				? ( $version > 1 ? 'نسخه ' . MP_Jalali::digits( (string) $version ) . ' طرح «' . $title . '» برای بررسی ارسال شد.' : 'طرح «' . $title . '» برای بررسی و تأیید ارسال شد.' )
				: 'فایل «' . $title . '» تحویل داده شد.',
			array( 't' => $kind, 'id' => $id )
		);
		MP_Audit::log( 'create', 'portal', $id, ( 'design' === $kind ? 'طرح «' : 'فایل تحویلی «' ) . $title . '»' . ( $version > 1 ? ' نسخه ' . $version : '' ) );
		return self::payload( self::get( $id ) );
	}

	public static function update( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x || ! MP_Util::can_see_project( $x->project_id ) ) {
			return self::err( 'مورد پیدا نشد.', 404 );
		}
		$f = array();
		if ( null !== $r['title'] ) {
			$f['title'] = MP_Util::text( $r['title'], 200 );
		}
		if ( null !== $r['note'] ) {
			$f['note'] = MP_Util::long_text( $r['note'], 2000 );
		}
		if ( null !== $r['status'] ) {
			$f['status'] = MP_Util::pick( $r['status'], array_keys( self::STATUS ), $x->status );
		}
		if ( $f ) {
			$wpdb->update( self::t( 'client_items' ), $f, array( 'id' => $x->id ) );
		}
		return self::payload( self::get( $x->id ) );
	}

	public static function archive( WP_REST_Request $r ) {
		global $wpdb;
		$x = self::get( (int) $r['id'] );
		if ( ! $x || ! MP_Util::can_see_project( $x->project_id ) ) {
			return self::err( 'مورد پیدا نشد.', 404 );
		}
		$wpdb->update( self::t( 'client_items' ), array( 'archived_at' => MP_Util::now() ), array( 'id' => $x->id ) );
		MP_Audit::log( 'archive', 'portal', $x->id, '«' . $x->title . '»' );
		return array( 'archived' => true );
	}

	private static function add_pin( $x, $r, $user_id, $name ) {
		global $wpdb;
		$body = MP_Util::long_text( $r['body'], 1000 );
		if ( '' === trim( $body ) ) {
			return self::err( 'نظر را بنویسید.' );
		}
		$parent = (int) $r['parent_id'];
		if ( $parent && ! $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'design_pins' ) . ' WHERE id = %d AND item_id = %d AND parent_id = 0', $parent, $x->id ) ) ) {
			$parent = 0;
		}
		$wpdb->insert(
			self::t( 'design_pins' ),
			array(
				'item_id'     => (int) $x->id,
				'parent_id'   => $parent,
				'x'           => $parent ? 0 : max( 0, min( 100, (float) $r['x'] ) ),
				'y'           => $parent ? 0 : max( 0, min( 100, (float) $r['y'] ) ),
				'body'        => $body,
				'user_id'     => $user_id,
				'author_name' => MP_Util::text( $name, 80 ),
				'created_at'  => MP_Util::now(),
			)
		);
		if ( $parent ) {
			// A new message in a resolved thread opens it again.
			$wpdb->update( self::t( 'design_pins' ), array( 'resolved' => 0 ), array( 'id' => $parent ) );
		}
		return null;
	}

	/** POST portal/items/{id}/pins {body, x, y, parent_id} — the team's own pin or reply. */
	public static function team_pin( WP_REST_Request $r ) {
		$x = self::get( (int) $r['id'] );
		if ( ! $x || 'design' !== $x->kind || ! MP_Util::can_see_project( $x->project_id ) ) {
			return self::err( 'طرح پیدا نشد.', 404 );
		}
		$e = self::add_pin( $x, $r, get_current_user_id(), '' );
		return $e ? $e : self::payload( $x );
	}

	public static function resolve( WP_REST_Request $r ) {
		global $wpdb;
		$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'design_pins' ) . ' WHERE id = %d', (int) $r['id'] ) );
		$x = $p ? self::get( $p->item_id ) : null;
		if ( ! $x || ! MP_Util::can_see_project( $x->project_id ) ) {
			return self::err( 'نظر پیدا نشد.', 404 );
		}
		$wpdb->update( self::t( 'design_pins' ), array( 'resolved' => $p->resolved ? 0 : 1 ), array( 'id' => $p->id ) );
		return self::payload( $x );
	}

	/* ------------------------------------------------------------------ Client side (token) */

	/** GET client/{token}/portal — everything the client may see for the group's project. */
	public static function public_portal( WP_REST_Request $r ) {
		global $wpdb;
		$ch   = self::channel( $r['token'] );
		$gate = MP_Client::gate( $ch );
		if ( $gate ) {
			return $gate;
		}
		$pid = (int) $ch->project_id;
		$out = array( 'project' => null, 'designs' => array(), 'files' => array(), 'invoices' => array() );
		if ( ! $pid ) {
			return $out;
		}
		$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'projects' ) . ' WHERE id = %d', $pid ) );
		if ( ! $p ) {
			return $out;
		}
		$counts = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) total, SUM(status = 'done') done FROM " . self::t( 'tasks' ) . ' WHERE project_id = %d AND archived_at IS NULL', $pid ) );
		$miles  = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT title, start_date, end_date, status FROM ' . self::t( 'milestones' ) . ' WHERE project_id = %d ORDER BY start_date, id', $pid ) ) as $m ) {
			$miles[] = array( 'title' => $m->title, 'start' => $m->start_date, 'end' => $m->end_date, 'status' => $m->status );
		}
		$sections = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( "SELECT s.title, s.status, COUNT(t.id) total, SUM(t.status = 'done') done FROM " . self::t( 'sections' ) . ' s LEFT JOIN ' . self::t( 'tasks' ) . ' t ON t.section_id = s.id AND t.archived_at IS NULL WHERE s.project_id = %d GROUP BY s.id ORDER BY s.sort, s.id', $pid ) ) as $s ) {
			$sections[] = array( 'title' => $s->title, 'status' => $s->status, 'total' => (int) $s->total, 'done' => (int) $s->done );
		}
		$out['project'] = array(
			'name'       => $p->name,
			'status'     => $p->status,
			'start'      => $p->start_date,
			'end'        => $p->end_date,
			'progress'   => $counts && $counts->total ? (int) round( $counts->done / $counts->total * 100 ) : ( 'done' === $p->status ? 100 : 0 ),
			'milestones' => $miles,
			'sections'   => $sections,
		);
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'client_items' ) . " WHERE project_id = %d AND archived_at IS NULL AND status <> 'superseded' ORDER BY id DESC", $pid ) ) as $x ) {
			$out[ 'design' === $x->kind ? 'designs' : 'files' ][] = self::payload( $x, $ch->token );
		}
		if ( class_exists( 'MP_Invoices' ) ) {
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::t( 'invoices' ) . " WHERE project_id = %d AND archived_at IS NULL AND status <> 'draft' ORDER BY id DESC", $pid ) ) as $inv ) {
				$pay               = MP_Invoices::payload( $inv );
				$out['invoices'][] = array( 'kind' => $pay['kind'], 'number' => $pay['number'], 'title' => $pay['title'], 'total' => $pay['total'], 'status' => $pay['status'], 'date' => $pay['issue_date'], 'url' => $pay['url'] );
			}
		}
		return $out;
	}

	private static function client_item( WP_REST_Request $r ) {
		$ch = self::channel( $r['token'] );
		$x  = $ch && ! MP_Client::gate( $ch ) ? self::get( (int) $r['id'] ) : null;
		if ( ! $x || (int) $x->project_id !== (int) $ch->project_id || 'design' !== $x->kind ) {
			return array( null, null );
		}
		return array( $ch, $x );
	}

	/** POST client/{token}/items/{id}/pins {x, y, body, name, parent_id} */
	public static function client_pin( WP_REST_Request $r ) {
		list( $ch, $x ) = self::client_item( $r );
		if ( ! $x ) {
			return self::err( 'طرح پیدا نشد.', 404 );
		}
		if ( ! MP_Rest::client_rate_ok( $ch->id ) ) {
			return self::err( 'کمی صبر کنید و دوباره بفرستید.', 429 );
		}
		$name = MP_Client::author( $ch, $r['name'] );
		$e    = self::add_pin( $x, $r, 0, $name );
		if ( $e ) {
			return $e;
		}
		self::notify( $x->project_id, ( '' !== $name ? $name : $ch->client_name ) . ' روی طرح «' . $x->title . '» نظر داد', wp_trim_words( (string) $r['body'], 14 ), $x->id );
		return self::payload( $x, $ch->token );
	}

	/** POST client/{token}/items/{id}/decision {decision: approved|changes, note, name} */
	public static function client_decision( WP_REST_Request $r ) {
		global $wpdb;
		list( $ch, $x ) = self::client_item( $r );
		if ( ! $x || 'superseded' === $x->status ) {
			return self::err( 'طرح پیدا نشد.', 404 );
		}
		$d    = 'approved' === $r['decision'] ? 'approved' : 'changes';
		$name = MP_Util::text( $r['name'], 80 );
		$note = MP_Util::long_text( $r['note'], 1000 );
		if ( 'changes' === $d && '' === trim( $note ) && ! $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::t( 'design_pins' ) . ' WHERE item_id = %d AND user_id = 0 AND resolved = 0', $x->id ) ) ) {
			return self::err( 'بنویسید چه چیزی باید تغییر کند، یا روی طرح نظر بگذارید.' );
		}
		$wpdb->update( self::t( 'client_items' ), array( 'status' => $d, 'decision_note' => $note, 'decided_by' => '' !== $name ? $name : $ch->client_name, 'decided_at' => MP_Util::now() ), array( 'id' => $x->id ) );
		MP_Client::system( 0, $x->project_id, ( '' !== $name ? $name : $ch->client_name ) . ( 'approved' === $d ? ' طرح «' . $x->title . '» را تأیید کرد ✓' : ' برای طرح «' . $x->title . '» درخواست تغییر داد.' ), array( 't' => 'design', 'id' => (int) $x->id ) );
		self::notify( $x->project_id, ( '' !== $name ? $name : $ch->client_name ) . ( 'approved' === $d ? ' طرح «' . $x->title . '» را تأیید کرد' : ' برای طرح «' . $x->title . '» تغییر خواست' ), $note, $x->id );
		MP_Audit::log( 'update', 'portal', $x->id, '«' . $x->title . '»: ' . self::STATUS[ $d ] . ' توسط مشتری' );
		return self::payload( self::get( $x->id ), $ch->token );
	}
}

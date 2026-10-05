<?php
defined( 'ABSPATH' ) || exit;

/**
 * Serves the panel as a full page at /{slug} (default /panel) or on any page that contains [moraba_panel].
 * The panel has its own design, so it is rendered without the theme.
 */
class MP_Frontend {

	/** Panel scripts, in load order (also pre-cached by the service worker). */
	const SCRIPTS = array( 'jalali.js', 'core.js', 'voice.js', 'tasks.js', 'templates.js', 'taskio.js', 'daily.js', 'invoices.js', 'pins.js', 'portal.js', 'digest.js', 'assistant.js', 'costs.js', 'payroll.js', 'dashboard.js', 'calendar.js', 'projects.js', 'messages.js', 'clients.js', 'contracts.js', 'meetings.js', 'work.js', 'money.js', 'reports.js', 'app.js' );

	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_rewrite' ) );
		add_filter( 'query_vars', array( __CLASS__, 'query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ), 1 );
		add_shortcode( 'moraba_panel', array( __CLASS__, 'shortcode' ) );
	}

	public static function slug() {
		$slug = sanitize_title( get_option( 'mp_slug', 'panel' ) );
		return $slug ? $slug : 'panel';
	}

	public static function add_rewrite() {
		add_rewrite_rule( '^' . self::slug() . '/?$', 'index.php?mp_panel=1', 'top' );
		// Short public links for clients: /c/{token} (portal) and /i/{token} (invoice).
		add_rewrite_rule( '^c/([A-Za-z0-9]{32})/?$', 'index.php?mp_client=$matches[1]', 'top' );
		add_rewrite_rule( '^i/([A-Za-z0-9]{32})/?$', 'index.php?mp_invoice=$matches[1]', 'top' );
		add_rewrite_rule( '^k/([A-Za-z0-9]{32})/?$', 'index.php?mp_contract=$matches[1]', 'top' );
		add_rewrite_rule( '^m/([A-Za-z0-9]{32})/?$', 'index.php?mp_meet=$matches[1]', 'top' );
		if ( did_action( 'init' ) && get_option( 'mp_flush_rewrite' ) ) {
			delete_option( 'mp_flush_rewrite' );
			flush_rewrite_rules( false );
		}
	}

	public static function query_vars( $vars ) {
		$vars[] = 'mp_panel';
		$vars[] = 'mp_client';
		$vars[] = 'mp_contract';
		$vars[] = 'mp_meet';
		$vars[] = 'mp_file';
		$vars[] = 'mp_manifest';
		$vars[] = 'mp_sw';
		$vars[] = 'mp_export';
		$vars[] = 'mp_invoice';
		$vars[] = 'mp_push_feed';
		return $vars;
	}

	public static function panel_url() {
		$page = (int) get_option( 'mp_page_id' );
		if ( $page && 'publish' === get_post_status( $page ) ) {
			return get_permalink( $page );
		}
		return get_option( 'permalink_structure' ) ? home_url( '/' . self::slug() . '/' ) : add_query_arg( 'mp_panel', 1, home_url( '/' ) );
	}

	public static function shortcode() {
		// The page is taken over in template_redirect; this only shows in excerpts, widgets and feeds.
		return '<a href="' . esc_url( self::panel_url() ) . '">ورود به پنل کارمندان</a>';
	}

	public static function maybe_render() {
		if ( get_query_var( 'mp_file' ) ) {
			MP_Files::serve( (int) get_query_var( 'mp_file' ) );
		}
		$mf = get_query_var( 'mp_manifest' );
		if ( is_string( $mf ) && preg_match( '/^[A-Za-z0-9]{32}$/', $mf ) ) {
			self::client_manifest( $mf );
		}
		if ( $mf ) {
			self::manifest();
		}
		if ( 'client' === get_query_var( 'mp_sw' ) ) {
			self::client_service_worker();
		}
		if ( get_query_var( 'mp_sw' ) ) {
			self::service_worker();
		}
		if ( get_query_var( 'mp_push_feed' ) ) {
			MP_Push::feed();
		}
		if ( get_query_var( 'mp_export' ) ) {
			MP_Export::handle( (string) get_query_var( 'mp_export' ) );
		}
		// The address itself, too: works before rewrite rules are refreshed and when a cache or a
		// messenger drops the query string.
		$path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_parse_url( esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ), PHP_URL_PATH ) : '';
		if ( preg_match( '#/s/([A-Za-z0-9]{6})/?$#', $path, $pm ) ) {
			MP_Messages::redirect( $pm[1] );
		}
		if ( preg_match( '#/(c|i|k|m)/([A-Za-z0-9]{32})/?$#', $path, $pm ) ) {
			status_header( 200 );
			if ( 'c' === $pm[1] ) {
				self::render_client( $pm[2] );
			}
			if ( 'k' === $pm[1] ) {
				MP_Contracts::render_public( $pm[2] );
			}
			if ( 'm' === $pm[1] ) {
				MP_Meet::render_public( $pm[2] );
			}
			MP_Invoices::render_public( $pm[2] );
		}
		$inv = get_query_var( 'mp_invoice' );
		if ( is_string( $inv ) && preg_match( '/^[A-Za-z0-9]{32}$/', $inv ) ) {
			MP_Invoices::render_public( $inv );
		}
		$kt = get_query_var( 'mp_contract' );
		if ( is_string( $kt ) && preg_match( '/^[A-Za-z0-9]{32}$/', $kt ) ) {
			MP_Contracts::render_public( $kt );
		}
		$mt = get_query_var( 'mp_meet' );
		if ( is_string( $mt ) && preg_match( '/^[A-Za-z0-9]{32}$/', $mt ) ) {
			MP_Meet::render_public( $mt );
		}
		$token = get_query_var( 'mp_client' );
		if ( is_string( $token ) && preg_match( '/^[A-Za-z0-9]{32}$/', $token ) ) {
			self::render_client( $token );
		}
		$is_panel = (bool) get_query_var( 'mp_panel' );
		if ( ! $is_panel && is_singular() ) {
			$post     = get_queried_object();
			$is_panel = $post instanceof WP_Post && has_shortcode( $post->post_content, 'moraba_panel' );
			if ( $is_panel && (int) get_option( 'mp_page_id' ) !== $post->ID ) {
				update_option( 'mp_page_id', $post->ID );
			}
		}
		if ( ! $is_panel ) {
			return;
		}
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		if ( ! is_user_logged_in() ) {
			self::template( 'login' );
		} elseif ( ! current_user_can( 'mp_access_panel' ) ) {
			status_header( 403 );
			self::template( 'no-access' );
		} else {
			update_user_meta( get_current_user_id(), 'mp_last_seen', time() );
			self::template( 'panel' );
		}
		exit;
	}

	private static function render_client( $token ) {
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		if ( ! MP_Client::channel( $token ) ) {
			status_header( 404 );
		}
		self::template( 'client', array( 'token' => $token ) );
		exit;
	}

	/** Path part of the panel URL, used as the PWA scope. */
	public static function scope() {
		$path = wp_parse_url( self::panel_url(), PHP_URL_PATH );
		return trailingslashit( $path ? $path : '/' );
	}

	private static function manifest() {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode(
			array(
				'name'             => 'پنل کارمندان مربع',
				'short_name'       => 'مربع',
				'lang'             => 'fa',
				'dir'              => 'rtl',
				'start_url'        => self::panel_url(),
				'scope'            => self::scope(),
				'id'               => self::scope(),
				'display'          => 'standalone',
				'display_override' => array( 'standalone', 'minimal-ui' ),
				'orientation'      => 'any',
				'categories'       => array( 'productivity', 'business' ),
				'description'      => 'تقویم، تسک‌ها، پیام‌ها، حضور و حسابداری تیم مربع',
				'shortcuts'        => array(
					array( 'name' => 'تسک جدید', 'url' => self::panel_url() . '#new-task', 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
					array( 'name' => 'ثبت ورود و خروج', 'url' => self::panel_url() . '#punch', 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
					array( 'name' => 'تقویم', 'url' => self::panel_url() . '#calendar', 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
					array( 'name' => 'پیام‌ها', 'url' => self::panel_url() . '#messages', 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
				),
				'background_color' => '#f3f3f1',
				'theme_color'      => '#161616',
				'icons'            => array(
					array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any maskable' ),
					array( 'src' => MP_URL . 'assets/img/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any maskable' ),
				),
			),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
		);
		exit;
	}

	/** Service worker served from the site root so it may control the panel URL. Caches static assets only. */
	private static function service_worker() {
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: ' . self::scope() );
		header( 'Cache-Control: no-cache' );
		$assets = array();
		foreach ( array_merge( array( 'css/app.css', 'fonts/dana.woff2', 'img/logo.png', 'img/symbol.png', 'img/icon-192.png', 'img/icon-180.png', 'js/pwa.js' ), array_map( function ( $s ) { return 'js/' . $s; }, self::SCRIPTS ) ) as $a ) {
			$assets[] = MP_URL . 'assets/' . $a . ( 0 === strpos( $a, 'fonts/' ) ? '' : '?ver=' . MP_VERSION ); // app.css asks for the font without ?ver
		}
		$cache = 'mp-' . MP_VERSION;
		echo "const CACHE=" . wp_json_encode( $cache ) . ",ASSETS=" . wp_json_encode( $assets ) . ',FEED=' . wp_json_encode( add_query_arg( 'mp_push_feed', 1, home_url( '/' ) ) ) . ',START=' . wp_json_encode( self::panel_url() ) . ',ICON=' . wp_json_encode( MP_URL . 'assets/img/icon-192.png' ) . ',FONT=' . wp_json_encode( MP_URL . 'assets/fonts/dana.woff2' ) . ";\n"; // phpcs:ignore
		echo <<<'JS'
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n.startsWith('mp-')&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.pathname.includes('/wp-json/')||u.search.includes('mp_file')||u.search.includes('rest_route'))return;
  if(ASSETS.includes(r.url)){e.respondWith(caches.match(r).then(m=>m||fetch(r)));return;}
  if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><style>@font-face{font-family:Dana;src:url('+FONT+') format("woff2");font-weight:10 990}body{font-family:Dana,Tahoma,sans-serif;direction:rtl;text-align:center;padding:40px}</style><body>اتصال اینترنت برقرار نیست؛ دوباره تلاش کنید.</body>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));}
});
// Push without payload: read the newest notification with the user's own session, then show it.
self.addEventListener('push',e=>{
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const focused=list.find(c=>c.focused&&c.visibilityState==='visible');
    if(focused){focused.postMessage({type:'refresh'});return;}
    return fetch(FEED,{credentials:'include',cache:'no-store'}).then(r=>r.json()).then(n=>{
      if(!n||!n.title)return self.registration.showNotification('پنل مربع',{body:'اعلان جدید دارید',icon:ICON,badge:ICON,dir:'rtl',lang:'fa',data:{url:START}});
      if(self.navigator&&self.navigator.setAppBadge)self.navigator.setAppBadge(n.count).catch(()=>{});
      return self.registration.showNotification(n.title,{body:n.body,icon:ICON,badge:ICON,tag:n.tag,renotify:true,dir:'rtl',lang:'fa',data:{url:n.url}});
    }).catch(()=>self.registration.showNotification('پنل مربع',{body:'اعلان جدید دارید',icon:ICON,dir:'rtl',data:{url:START}}));
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||START;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const c=list.find(x=>x.url.split('#')[0]===START.split('#')[0]);
    if(c){c.postMessage({type:'open',url:url});return c.focus();}
    return self.clients.openWindow(url);
  }));
});
JS;
		exit;
	}

	/* ------------------------------------------------------------------ Client portal as an app */

	/** Scope of a client portal: its own /c/{token}/ path, so each client installs their own app. */
	public static function client_scope( $token ) {
		$path = wp_parse_url( MP_Client::url( $token ), PHP_URL_PATH );
		return trailingslashit( $path ? $path : '/' );
	}

	private static function client_manifest( $token ) {
		$ch = MP_Client::channel( $token );
		if ( ! $ch ) {
			status_header( 404 );
			exit;
		}
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		$url   = MP_Client::url( $token );
		$icons = array(
			array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any maskable' ),
			array( 'src' => MP_URL . 'assets/img/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any maskable' ),
		);
		$name = $ch->client_name ? $ch->client_name : $ch->title;
		echo wp_json_encode(
			array(
				'name'             => $name . ' | مربع استودیو',
				'short_name'       => function_exists( 'mb_substr' ) ? mb_substr( $name, 0, 12 ) : $name,
				'description'      => 'پرتال پروژه «' . $ch->title . '»: پیشرفت، طرح‌ها، فایل‌ها، فاکتورها و گفت‌وگو با تیم مربع',
				'lang'             => 'fa',
				'dir'              => 'rtl',
				'start_url'        => $url,
				'scope'            => self::client_scope( $token ),
				'id'               => self::client_scope( $token ),
				'display'          => 'standalone',
				'display_override' => array( 'standalone', 'minimal-ui' ),
				'orientation'      => 'any',
				'categories'       => array( 'business', 'productivity' ),
				'background_color' => '#111213',
				'theme_color'      => '#111213',
				'icons'            => $icons,
				'shortcuts'        => array(
					array( 'name' => 'گفت‌وگو', 'url' => $url . '#chat', 'icons' => array( $icons[0] ) ),
					array( 'name' => 'طرح‌ها', 'url' => $url . '#designs', 'icons' => array( $icons[0] ) ),
					array( 'name' => 'فاکتورها', 'url' => $url . '#invoices', 'icons' => array( $icons[0] ) ),
				),
			),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
		);
		exit;
	}

	/**
	 * Service worker of the client portal: static files from cache (instant start), the page itself
	 * network-first with the last copy as offline fallback. API calls always go to the network.
	 */
	private static function client_service_worker() {
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: /' );
		header( 'Cache-Control: no-cache' );
		$assets = array();
		foreach ( array( 'css/app.css', 'fonts/dana.woff2', 'img/logo.png', 'img/symbol.png', 'img/icon-192.png', 'img/icon-180.png', 'js/pwa.js', 'js/pins.js', 'js/client.js' ) as $a ) {
			$assets[] = MP_URL . 'assets/' . $a . ( 0 === strpos( $a, 'fonts/' ) ? '' : '?ver=' . MP_VERSION );
		}
		echo 'const CACHE=' . wp_json_encode( 'mpc-' . MP_VERSION ) . ',ASSETS=' . wp_json_encode( $assets ) . ',FONT=' . wp_json_encode( MP_URL . 'assets/fonts/dana.woff2' ) . ";\n"; // phpcs:ignore
		echo <<<'JS'
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n.startsWith('mpc-')&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.pathname.includes('/wp-json/')||u.search.includes('rest_route')||u.search.includes('mp_file'))return;
  if(ASSETS.includes(r.url)){e.respondWith(caches.match(r).then(m=>m||fetch(r)));return;}
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(u.origin+u.pathname,c));}return res;})
      .catch(()=>caches.match(u.origin+u.pathname).then(m=>m||new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><style>@font-face{font-family:Dana;src:url('+FONT+') format("woff2");font-weight:10 990}body{font-family:Dana,Tahoma,sans-serif;direction:rtl;text-align:center;padding:40px;background:#111213;color:#eee}</style><body>اتصال اینترنت برقرار نیست؛ دوباره تلاش کنید.</body>',{headers:{'Content-Type':'text/html; charset=utf-8'}}))));
  }
});
JS;
		exit;
	}

	/** Head tags of the client portal: its own manifest, icons and theme. */
	public static function client_head( $token, $title ) {
		printf(
			'<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="%1$s"><meta name="application-name" content="%1$s"><meta name="format-detection" content="telephone=no"><link rel="manifest" href="%2$s"><link rel="apple-touch-icon" sizes="180x180" href="%3$s"><link rel="preload" href="%4$s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_attr( function_exists( 'mb_substr' ) ? mb_substr( $title, 0, 20 ) : $title ),
			esc_url( add_query_arg( 'mp_manifest', $token, home_url( '/' ) ) ),
			esc_url( self::asset( 'img/icon-180.png' ) ),
			esc_url( MP_URL . 'assets/fonts/dana.woff2' )
		);
	}

	/** Install banner + service worker for the client portal (only with its own /c/ scope). */
	public static function client_pwa_script( $token, $title ) {
		$pretty = (bool) get_option( 'permalink_structure' );
		return sprintf(
			'<script src="%s" data-sw="%s" data-scope="%s" data-icon="%s" data-login="1" data-app="%s" defer></script>',
			esc_url( self::asset( 'js/pwa.js' ) ),
			$pretty ? esc_url( add_query_arg( 'mp_sw', 'client', home_url( '/' ) ) ) : '',
			esc_attr( self::client_scope( $token ) ),
			esc_url( self::asset( 'img/icon-180.png' ) ),
			esc_attr( $title )
		);
	}

	public static function asset( $path ) {
		return esc_url( MP_URL . 'assets/' . $path . '?ver=' . MP_VERSION );
	}

	private static function template( $name, array $vars = array() ) {
		extract( $vars, EXTR_SKIP ); // phpcs:ignore WordPress.PHP.DontExtract
		include MP_DIR . 'templates/' . $name . '.php';
	}

	/** Install helper: iPhone banner everywhere, plus Android install button and SW on the login page. */
	public static function pwa_script( $login = false ) {
		return sprintf(
			'<script src="%s" data-sw="%s" data-scope="%s" data-icon="%s" data-login="%s" defer></script>',
			esc_url( self::asset( 'js/pwa.js' ) ),
			esc_url( add_query_arg( 'mp_sw', 1, home_url( '/' ) ) ),
			esc_attr( self::scope() ),
			esc_url( self::asset( 'img/icon-180.png' ) ),
			$login ? '1' : ''
		);
	}

	public static function config() {
		return array(
			'root'   => esc_url_raw( rest_url( MP_Rest::NS . '/' ) ),
			'nonce'  => wp_create_nonce( 'wp_rest' ),
			'assets' => MP_URL . 'assets/',
			'sw'     => add_query_arg( 'mp_sw', 1, home_url( '/' ) ),
			'scope'  => self::scope(),
			'export' => add_query_arg( array( 'mp_export' => 'ledger', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
			'tasksExport' => add_query_arg( array( 'mp_export' => 'tasks', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
			'payrollExport' => add_query_arg( array( 'mp_export' => 'payroll', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
		);
	}
}

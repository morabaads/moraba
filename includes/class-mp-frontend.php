<?php
defined( 'ABSPATH' ) || exit;

/**
 * Serves the panel as a full page at /{slug} (default /panel) or on any page that contains [moraba_panel].
 * The panel has its own design, so it is rendered without the theme.
 */
class MP_Frontend {

	/** Version of the Windows app (apps/windows/moraba-chat.c APP_VERSION); installed copies update themselves to it. */
	const CHAT_EXE_VERSION = '2.2.0';

	/** Panel scripts, in load order (also pre-cached by the service worker). */
	const SCRIPTS = array( 'jalali.js', 'emoji-map.js', 'core.js', 'viewer.js', 'voice.js', 'tasks.js', 'templates.js', 'taskio.js', 'daily.js', 'invoices.js', 'pins.js', 'portal.js', 'digest.js', 'assistant.js', 'costs.js', 'payroll.js', 'dashboard.js', 'calendar.js', 'projects.js', 'chat-kit.js', 'messages.js', 'chat-desktop.js', 'chat-shell.js', 'clients.js', 'contracts.js', 'meetings.js', 'work.js', 'money.js', 'reports.js', 'widgets.js', 'app.js' );

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
		// «مربع چت»: the staff chat on its own, as a separate app (PWA, Android, Windows).
		add_rewrite_rule( '^' . self::chat_slug() . '/?$', 'index.php?mp_panel=chat', 'top' );
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

	public static function chat_slug() {
		$slug = sanitize_title( get_option( 'mp_chat_slug', 'chat' ) );
		return $slug ? $slug : 'chat';
	}

	/** «مربع چت»: the staff chat as its own app. */
	public static function chat_url() {
		return get_option( 'permalink_structure' ) ? home_url( '/' . self::chat_slug() . '/' ) : add_query_arg( 'mp_panel', 'chat', home_url( '/' ) );
	}

	/** Is this request the chat app (its page, login, manifest or service worker)? */
	public static function is_chat() {
		return 'chat' === get_query_var( 'mp_panel' );
	}

	public static function chat_scope() {
		$path = wp_parse_url( self::chat_url(), PHP_URL_PATH );
		return trailingslashit( $path ? $path : '/' );
	}

	/** Windows and Android downloads of «مربع چت» (shipped inside the plugin). */
	public static function chat_downloads() {
		return array(
			'apk' => MP_URL . 'assets/app/moraba-chat.apk?ver=' . MP_VERSION,
			'exe' => add_query_arg( 'mp_chat_exe', MP_VERSION, home_url( '/' ) ),
		);
	}

	/**
	 * ?mp_chat_exe — the Windows app with this site's chat address written into it (the build carries a
	 * UTF-16 placeholder of 300 characters; see apps/windows/moraba-chat.c), so one build serves every site.
	 */
	private static function chat_exe() {
		$bytes = (string) file_get_contents( MP_DIR . 'assets/app/MorabaChat.exe' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		$mark  = mb_convert_encoding( '@@MORABA_CHAT_URL@@', 'UTF-16LE', 'UTF-8' );
		$at    = strpos( $bytes, $mark );
		if ( '' === $bytes || false === $at ) {
			status_header( 404 );
			exit( 'Not found' );
		}
		$url   = mb_convert_encoding( substr( self::chat_url(), 0, 290 ), 'UTF-16LE', 'UTF-8' );
		$bytes = substr_replace( $bytes, str_pad( $url, 600, "\0" ), $at, 600 );
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		nocache_headers();
		header( 'Content-Type: application/vnd.microsoft.portable-executable' );
		header( 'Content-Disposition: attachment; filename="MorabaChat.exe"' );
		header( 'Content-Length: ' . strlen( $bytes ) );
		header( 'X-Content-Type-Options: nosniff' );
		echo $bytes; // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
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
		if ( 'chat' === $mf ) {
			self::chat_manifest();
		}
		if ( $mf ) {
			self::manifest();
		}
		if ( 'client' === get_query_var( 'mp_sw' ) ) {
			self::client_service_worker();
		}
		if ( 'chat' === get_query_var( 'mp_sw' ) ) {
			self::service_worker( true );
		}
		if ( get_query_var( 'mp_sw' ) ) {
			self::service_worker();
		}
		if ( isset( $_GET['mp_chat_exe'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			self::chat_exe();
		}
		if ( get_query_var( 'mp_push_feed' ) ) {
			MP_Push::feed();
		}
		if ( isset( $_GET['mp_client_feed'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			MP_App::client_feed();
		}
		if ( isset( $_GET['mp_app'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			MP_App::render();
		}
		if ( get_query_var( 'mp_export' ) ) {
			MP_Export::handle( (string) get_query_var( 'mp_export' ) );
		}
		// The address itself, too: works before rewrite rules are refreshed and when a cache or a
		// messenger drops the query string.
		$path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_parse_url( esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ), PHP_URL_PATH ) : '';
		// The Android app's entry (staff and clients).
		if ( preg_match( '#/mp-app/?$#', $path ) ) {
			status_header( 200 );
			MP_App::render();
		}
		if ( get_option( 'permalink_structure' ) && preg_match( '#/' . preg_quote( self::chat_slug(), '#' ) . '/?$#', $path ) && ! get_query_var( 'mp_panel' ) ) {
			status_header( 200 );
			set_query_var( 'mp_panel', 'chat' );
		}
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
		self::no_page_cache();
		header( 'X-Frame-Options: SAMEORIGIN' );
		$chat = self::is_chat();
		if ( ! is_user_logged_in() ) {
			self::template( 'login', array( 'mp_chat_app' => $chat ) );
		} elseif ( ! current_user_can( 'mp_access_panel' ) ) {
			status_header( 403 );
			self::template( 'no-access' );
		} else {
			update_user_meta( get_current_user_id(), 'mp_last_seen', time() );
			self::template( 'panel', array( 'mp_chat_app' => $chat ) );
		}
		exit;
	}

	/** The panel must never come from a cache plugin or the host's cache (LiteSpeed, etc.), or an update would not show. */
	private static function no_page_cache() {
		nocache_headers();
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
		header( 'Cache-Control: no-cache, no-store, must-revalidate, max-age=0' );
	}

	private static function render_client( $token ) {
		self::no_page_cache();
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
				// Windows 11 widgets board (Edge): templates are Adaptive Cards, data comes from the service worker.
				'widgets'          => array(
					array( 'name' => 'مربع · تسک‌ها', 'short_name' => 'تسک‌ها', 'description' => 'تسک‌های امروز، این هفته و عقب‌افتاده؛ تیک بزنید یا تسک تازه بسازید', 'tag' => 'mp-tasks', 'template' => 'mp-tasks', 'ms_ac_template' => MP_URL . 'assets/app/win-tasks.json', 'data' => rest_url( 'moraba-panel/v1/widget' ), 'type' => 'application/json', 'auth' => false, 'update' => 900, 'screenshots' => array( array( 'src' => MP_URL . 'assets/app/shot-tasks.png', 'sizes' => '600x450', 'label' => 'ویجت تسک‌ها' ) ), 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
					array( 'name' => 'مربع · خلاصه امروز', 'short_name' => 'خلاصه امروز', 'description' => 'حضور و ثبت ورود/خروج، تسک‌ها، پیام‌های نخوانده و جلسه بعدی', 'tag' => 'mp-summary', 'template' => 'mp-summary', 'ms_ac_template' => MP_URL . 'assets/app/win-summary.json', 'data' => rest_url( 'moraba-panel/v1/widget' ), 'type' => 'application/json', 'auth' => false, 'update' => 900, 'screenshots' => array( array( 'src' => MP_URL . 'assets/app/shot-summary.png', 'sizes' => '600x450', 'label' => 'ویجت خلاصه امروز' ) ), 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
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

	/** «مربع چت»: its own name, icon, scope and start page, so it installs as a second app beside the panel. */
	private static function chat_manifest() {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		$icons = array(
			array( 'src' => MP_URL . 'assets/img/chat-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any maskable' ),
			array( 'src' => MP_URL . 'assets/img/chat-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any maskable' ),
		);
		echo wp_json_encode(
			array(
				'name'             => 'مربع چت',
				'short_name'       => 'مربع چت',
				'lang'             => 'fa',
				'dir'              => 'rtl',
				'start_url'        => self::chat_url(),
				'scope'            => self::chat_scope(),
				'id'               => self::chat_scope(),
				'display'          => 'standalone',
				'display_override' => array( 'standalone', 'minimal-ui' ),
				'orientation'      => 'any',
				'categories'       => array( 'social', 'business', 'productivity' ),
				'description'      => 'پیام‌رسان تیم مربع: گفت‌وگوهای تیم، خصوصی و مشتری‌ها',
				'background_color' => '#161616',
				'theme_color'      => '#161616',
				'icons'            => $icons,
				'shortcuts'        => array(
					array( 'name' => 'پیام‌های ذخیره‌شده', 'url' => self::chat_url() . '#saved', 'icons' => array( $icons[0] ) ),
					array( 'name' => 'پنل مربع', 'url' => self::panel_url(), 'icons' => array( array( 'src' => MP_URL . 'assets/img/icon-192.png', 'sizes' => '192x192' ) ) ),
				),
			),
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
		);
		exit;
	}

	/**
	 * Service worker served from the site root so it may control the panel URL (or, with $chat, the chat app's
	 * /chat/). Caches static assets only. The chat app's one shows message notifications only.
	 */
	private static function service_worker( $chat = false ) {
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: ' . ( $chat ? self::chat_scope() : self::scope() ) );
		header( 'Cache-Control: no-cache' );
		$assets = array();
		foreach ( array_merge( array( 'css/app.css', 'fonts/dana.woff2', 'img/logo.png', 'img/symbol.png', 'img/icon-192.png', 'img/icon-180.png', 'img/chat-192.png', 'js/pwa.js' ), array_map( function ( $s ) { return 'js/' . $s; }, self::SCRIPTS ) ) as $a ) {
			$assets[] = MP_URL . 'assets/' . $a . ( 0 === strpos( $a, 'fonts/' ) ? '' : '?ver=' . MP_VERSION ); // app.css asks for the font without ?ver
		}
		$cache = ( $chat ? 'mp-chat-' : 'mp-' ) . MP_VERSION;
		$feed  = add_query_arg( $chat ? array( 'mp_push_feed' => 1, 'chat' => 1 ) : array( 'mp_push_feed' => 1 ), home_url( '/' ) );
		echo "const CACHE=" . wp_json_encode( $cache ) . ",ASSETS=" . wp_json_encode( $assets ) . ',FEED=' . wp_json_encode( $feed ) . ',START=' . wp_json_encode( $chat ? self::chat_url() : self::panel_url() ) . ',ICON=' . wp_json_encode( MP_URL . 'assets/img/' . ( $chat ? 'chat-192.png' : 'icon-192.png' ) ) . ',APPNAME=' . wp_json_encode( $chat ? 'مربع چت' : 'پنل مربع' ) . ',FONT=' . wp_json_encode( MP_URL . 'assets/fonts/dana.woff2' ) . ',WAPI=' . wp_json_encode( rest_url( 'moraba-panel/v1/widget' ) ) . ";\n"; // phpcs:ignore
		echo <<<'JS'
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>/^mp-(chat-)?[\d.]+$/.test(n)&&n.startsWith('mp-chat-')===CACHE.startsWith('mp-chat-')&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.pathname.includes('/wp-json/')||u.search.includes('mp_file')||u.search.includes('rest_route'))return;
  if(ASSETS.includes(r.url)){e.respondWith(caches.match(r).then(m=>m||fetch(r)));return;}
  // The panel page itself: from the network, and the last copy when there is no internet (chats open offline).
  if(r.mode==='navigate'&&u.pathname===new URL(START).pathname&&!u.search){e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open('shell-panel').then(x=>x.put(START,c)).catch(()=>{});}return res;}).catch(()=>caches.open('shell-panel').then(x=>x.match(START)).then(m=>m||Response.error())));return;}
  if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><style>@font-face{font-family:Dana;src:url('+FONT+') format("woff2");font-weight:10 990}body{font-family:Dana,Tahoma,sans-serif;direction:rtl;text-align:center;padding:40px}</style><body>اتصال اینترنت برقرار نیست؛ دوباره تلاش کنید.</body>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));}
});
// Push without payload: read the newest notification with the user's own session, then show it.
self.addEventListener('push',e=>{
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const focused=list.find(c=>c.focused&&c.visibilityState==='visible');
    if(focused){focused.postMessage({type:'refresh'});return;}
    return fetch(FEED,{credentials:'include',cache:'no-store'}).then(r=>r.json()).then(n=>{
      if(!n||!n.title)return self.registration.showNotification(APPNAME,{body:'اعلان جدید دارید',icon:ICON,badge:ICON,dir:'rtl',lang:'fa',data:{url:START}});
      if(self.navigator&&self.navigator.setAppBadge)self.navigator.setAppBadge(n.count).catch(()=>{});
      const o={body:n.body,icon:ICON,badge:ICON,tag:n.tag,renotify:true,dir:'rtl',lang:'fa',data:{url:n.url,channel:n.channel||0}};
      if(n.channel)o.actions=[{action:'reply',title:'پاسخ'},{action:'read',title:'خوانده شد'}];
      return self.registration.showNotification(n.title,o);
    }).catch(()=>self.registration.showNotification(APPNAME,{body:'اعلان جدید دارید',icon:ICON,dir:'rtl',data:{url:START}}));
  }));
});
// Windows 11 widgets (Edge-installed app): the summary is read with the user's own session.
const FA=s=>String(s).replace(/\d/g,c=>'۰۱۲۳۴۵۶۷۸۹'[c]);
const wstate=()=>caches.open('mp-widget').then(c=>c.match('tab')).then(r=>r?r.text():'today').catch(()=>'today');
const wsave=t=>caches.open('mp-widget').then(c=>c.put('tab',new Response(t))).catch(()=>{});
function wcall(body){
  return fetch(WAPI,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:Object.assign({'X-MP-Widget':'1','Accept':'application/json'},body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),body:body||undefined}).then(r=>r.json());
}
function wdata(tag,d,tab){
  if(!d||!d.ok)return {tab:tab,list:[],more:0,more_text:'',urls:{},today_fa:'برای دیدن ویجت، اپ مربع را باز کنید و وارد شوید',attendance:{open:false,since:'',worked:''},tasks:{overdue:{count:0}},messages:{unread:0,items:[]},tasks_today:'',tasks_overdue:'',unread:'',meeting_text:'',meeting_url:START,meeting_live:false};
  if(tag==='mp-tasks'){const all=d.tasks[tab].items,max=6;return {tab:tab,list:all.slice(0,max),more:all.length-max,more_text:'و '+FA(all.length-max)+' تسک دیگر',urls:d.urls};}
  const m=d.meeting;
  return Object.assign({},d,{tasks_today:FA(d.tasks.today.open)+' باز از '+FA(d.tasks.today.count),tasks_overdue:FA(d.tasks.overdue.count),unread:FA(d.messages.unread),meeting_text:m?m.when+' · '+m.title:'جلسه‌ای پیش رو ندارید',meeting_url:m?m.url:d.urls.meetings,meeting_live:!!(m&&m.live)});
}
function wpaint(widget,d){
  const tag=widget.definition.tag;
  return Promise.all([fetch(widget.definition.msAcTemplate).then(r=>r.text()),d?Promise.resolve(d):wcall().catch(()=>null),wstate()]).then(([tpl,data,tab])=>
    self.widgets.updateByTag(tag,{template:tpl,data:JSON.stringify(wdata(tag,data,tab))}));
}
function wall(d){
  if(!self.widgets)return Promise.resolve();
  return Promise.all(['mp-tasks','mp-summary'].map(t=>self.widgets.getByTag(t).then(w=>w&&w.instances&&w.instances.length?wpaint(w,d):null).catch(()=>null)));
}
self.addEventListener('widgetinstall',e=>{e.waitUntil((self.registration.periodicSync?self.registration.periodicSync.register(e.widget.definition.tag,{minInterval:(e.widget.definition.update||900)*1000}).catch(()=>{}):Promise.resolve()).then(()=>wpaint(e.widget)));});
self.addEventListener('widgetresume',e=>{e.waitUntil(wpaint(e.widget));});
self.addEventListener('widgetuninstall',e=>{if(e.widget.instances.length<=1&&self.registration.periodicSync)e.waitUntil(self.registration.periodicSync.unregister(e.widget.definition.tag).catch(()=>{}));});
self.addEventListener('periodicsync',e=>{if(e.tag==='mp-tasks'||e.tag==='mp-summary')e.waitUntil(wall());});
self.addEventListener('widgetclick',e=>{
  const v=e.action||'';
  let data=e.data;
  try{if(typeof data==='string')data=JSON.parse(data);}catch(x){data={};}
  const id=data&&(data.id||(data.data&&data.data.id));
  if(v.indexOf('tab-')===0){e.waitUntil(wsave(v.slice(4)).then(()=>wall()));return;}
  if(v==='punch'){e.waitUntil(wcall('action=punch').then(d=>wall(d.ok?d:null)));return;}
  if((v==='done'||v==='undo')&&id){e.waitUntil(wcall('action='+v+'&id='+encodeURIComponent(id)).then(d=>wall(d.ok?d:null)));return;}
  e.waitUntil(self.clients.openWindow(START));
});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='widgets')e.waitUntil(wall());});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const d=e.notification.data||{};
  // «خوانده شد»: marks the chat read without opening the panel.
  if(e.action==='read'&&d.channel){e.waitUntil(fetch(FEED+'&read='+d.channel,{credentials:'include',cache:'no-store',headers:{'X-MP-Push':'1'}}).then(()=>self.navigator&&self.navigator.clearAppBadge?null:null).catch(()=>{}));return;}
  // «پاسخ»: opens the chat with the keyboard ready.
  const url=e.action==='reply'&&d.channel?START.split('#')[0]+'#chat-'+d.channel+'-reply':(d.url||START);
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
		foreach ( array( 'css/app.css', 'fonts/dana.woff2', 'img/logo.png', 'img/symbol.png', 'img/icon-192.png', 'img/icon-180.png', 'js/pwa.js', 'js/pins.js', 'js/viewer.js', 'js/emoji-map.js', 'js/client-chat.js', 'js/client.js' ) as $a ) {
			$assets[] = MP_URL . 'assets/' . $a . ( 0 === strpos( $a, 'fonts/' ) ? '' : '?ver=' . MP_VERSION );
		}
		echo 'const CACHE=' . wp_json_encode( 'mpc-' . MP_VERSION ) . ',ASSETS=' . wp_json_encode( $assets ) . ',FONT=' . wp_json_encode( MP_URL . 'assets/fonts/dana.woff2' ) . ',WAPI=' . wp_json_encode( rest_url( 'moraba-panel/v1/widget' ) ) . ";\n"; // phpcs:ignore
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
			'<script src="%s" data-sw="%s" data-scope="%s" data-icon="%s" data-login="1" data-app="%s" data-apk="%s" defer></script>',
			esc_url( self::asset( 'js/pwa.js' ) ),
			$pretty ? esc_url( add_query_arg( 'mp_sw', 'client', home_url( '/' ) ) ) : '',
			esc_attr( self::client_scope( $token ) ),
			esc_url( self::asset( 'img/icon-180.png' ) ),
			esc_attr( $title ),
			esc_url( self::apk_url() )
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
		$chat = self::is_chat();
		$dl   = self::chat_downloads();
		return sprintf(
			'<script src="%s" data-sw="%s" data-scope="%s" data-icon="%s" data-login="%s" data-apk="%s"%s defer></script>',
			esc_url( self::asset( 'js/pwa.js' ) ),
			esc_url( add_query_arg( 'mp_sw', $chat ? 'chat' : 1, home_url( '/' ) ) ),
			esc_attr( $chat ? self::chat_scope() : self::scope() ),
			esc_url( self::asset( $chat ? 'img/chat-180.png' : 'img/icon-180.png' ) ),
			$login ? '1' : '',
			esc_url( $chat ? $dl['apk'] : self::apk_url() ),
			$chat ? ' data-chat="1" data-exe="' . esc_url( $dl['exe'] ) . '"' : ''
		);
	}

	/** The Android app (shipped inside the plugin). */
	public static function apk_url() {
		return MP_URL . 'assets/app/moraba.apk?ver=' . MP_VERSION;
	}

	public static function config() {
		return array(
			'root'   => esc_url_raw( rest_url( MP_Rest::NS . '/' ) ),
			'nonce'  => wp_create_nonce( 'wp_rest' ),
			'user'   => get_current_user_id(),
			'apk'    => self::apk_url(),
			'chatApp' => self::is_chat(),
			'pop'    => self::is_chat() && isset( $_GET['pop'] ) ? (int) $_GET['pop'] : 0, // phpcs:ignore WordPress.Security.NonceVerification
			'panel'  => self::panel_url(),
			'chat'   => array( 'url' => self::chat_url(), 'feed' => add_query_arg( array( 'mp_push_feed' => 1, 'chat' => 1 ), home_url( '/' ) ) ) + self::chat_downloads(),
			'appEntry' => MP_App::url(),
			'assets' => MP_URL . 'assets/',
			'version' => MP_VERSION,
			'emoji'  => array( MP_Chat::emoji_url(), home_url( '/' ) . ( false === strpos( home_url( '/' ), '?' ) ? '?' : '&' ) . 'mp_emoji=' ),
			'sw'     => add_query_arg( 'mp_sw', self::is_chat() ? 'chat' : 1, home_url( '/' ) ),
			'scope'  => self::is_chat() ? self::chat_scope() : self::scope(),
			'export' => add_query_arg( array( 'mp_export' => 'ledger', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
			'tasksExport' => add_query_arg( array( 'mp_export' => 'tasks', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
			'payrollExport' => add_query_arg( array( 'mp_export' => 'payroll', '_wpnonce' => wp_create_nonce( 'mp_export' ) ), home_url( '/' ) ),
		);
	}
}

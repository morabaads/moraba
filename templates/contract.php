<?php
/**
 * Public contract page (/k/{token}/): the A4 document, print / save as PDF, and online signing.
 * Variables available: $c, $s, $vars, $studio, $intact, $client, $agent, $otp, $token.
 */
defined( 'ABSPATH' ) || exit;
$mp_status = array( 'draft' => 'پیش‌نویس', 'sent' => 'منتظر امضا', 'signed' => 'امضاشده', 'cancelled' => 'لغوشده' );
$mp_date   = function ( $dt ) {
	return $dt ? MP_Jalali::format( substr( $dt, 0, 10 ) ) . ' ساعت ' . MP_Jalali::digits( substr( $dt, 11, 5 ) ) : '';
};
?><!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title><?php echo esc_html( 'قرارداد ' . $c->number . ' — ' . $c->title ); ?></title>
<link rel="icon" type="image/png" href="<?php echo MP_Frontend::asset( 'img/symbol.png' ); // phpcs:ignore ?>">
<style>
@font-face{font-family:Dana;src:url(<?php echo esc_url( MP_URL . 'assets/fonts/dana.woff2' ); ?>) format('woff2');font-weight:10 990}
:root{--a:<?php echo esc_html( $s['accent'] ); ?>;--a22:<?php echo esc_html( vsprintf( 'rgba(%d,%d,%d,.22)', sscanf( $s['accent'], '#%02x%02x%02x' ) ) ); ?>;--ink:#1b1b1b;--muted:#6f6f6f;--line:#e8e6e2;--bg:#efeeeb;--paper:#fff;--ok:#1f7a45}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);font:14px/2.05 Dana,Tahoma,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(20,20,20,.92);color:#fff;backdrop-filter:blur(10px)}
.bar b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;padding:10px 18px;font:inherit;font-weight:800;font-size:13px;cursor:pointer;text-decoration:none;line-height:1.4}
.btn-a{background:var(--a);color:#fff}.btn-g{background:rgba(255,255,255,.12);color:#fff}.btn-l{background:#f1efec;color:var(--ink)}.btn-ok{background:var(--ok);color:#fff}
.btn:disabled{opacity:.5;cursor:default}
.page{max-width:820px;margin:28px auto;padding:0 14px}
.sheet{position:relative;background:var(--paper);box-shadow:0 18px 60px rgba(0,0,0,.08);padding:54px 60px 46px;overflow:hidden}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line)}
.head img{height:34px}
.kicker{font-size:12px;font-weight:800;color:var(--a);letter-spacing:.3px}
h1.title{margin:2px 0 6px;font-size:25px;line-height:1.5}
.meta{font-size:12px;color:var(--muted)}
.meta span+span:before{content:' · '}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 0 26px}
.party{border:1px solid var(--line);border-radius:16px;padding:14px 18px;line-height:1.9}
.party small{display:block;color:var(--a);font-weight:800;font-size:11px}
.party strong{font-size:15px}.party p{margin:2px 0 0;font-size:12.5px;color:#555}
.doc h1{font-size:20px}
.doc h2{font-size:16px;margin:26px 0 8px;display:flex;align-items:center;gap:10px}
.doc h3{font-size:14px;margin:14px 0 4px;color:#333}
.doc p{margin:0 0 8px;text-align:justify}
.doc ul{margin:4px 0 12px;padding:0 22px 0 0}
.doc li{margin:2px 0}
.doc li::marker{color:var(--a)}
.doc .note{background:#faf8f5;border-right:3px solid var(--a);padding:8px 14px;border-radius:0 0 0 0;font-size:13px}
.doc .v{font-weight:800;color:var(--ink);background:linear-gradient(transparent 62%,var(--a22) 0);padding:0 2px}
.doc .blank{display:inline-block;min-width:120px;border-bottom:1.5px dotted #b9b4ad;color:#b9b4ad;font-size:11px;line-height:1.6;text-align:center}
/* styles */
.s-modern .sheet:before{content:'';position:absolute;inset:0 0 auto 0;height:8px;background:var(--a)}
.s-modern .doc h2:before{content:'';width:8px;height:8px;border-radius:3px;background:var(--a);flex-shrink:0}
.s-classic .sheet{border:1px solid #d9d4cc;outline:6px double #e3ddd3;outline-offset:-18px;padding:66px 72px 56px}
.s-classic .head{flex-direction:column;align-items:center;text-align:center;border-bottom:2px solid var(--ink)}
.s-classic .doc h2{justify-content:center;border-bottom:1px solid var(--line);padding-bottom:6px}
.s-classic .party{border-radius:4px}
.s-minimal .sheet{box-shadow:0 2px 14px rgba(0,0,0,.05)}
.s-minimal .head{border-bottom:0}
.s-minimal .party{border:0;background:#f7f6f3}
.s-minimal .doc h2{font-size:15px;color:var(--a)}
/* signatures */
.signs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:34px;page-break-inside:avoid}
.sign{border:1px solid var(--line);border-radius:16px;padding:14px 18px;min-height:170px;display:flex;flex-direction:column}
.sign small{color:var(--a);font-weight:800;font-size:11px}
.sign strong{font-size:14px}
.sign .img{flex:1;display:grid;place-items:center;min-height:86px}
.sign .img img{max-height:90px;max-width:100%}
.sign .wait{color:#b9b4ad;font-size:12px;border:1.5px dashed #ddd8d0;border-radius:12px;padding:18px;text-align:center;width:100%}
.sign .when{font-size:11px;color:var(--muted)}
.cert{margin-top:18px;border:1.5px solid #b9dcc8;background:#f3faf6;border-radius:16px;padding:12px 16px;font-size:12px;line-height:1.9;page-break-inside:avoid}
.cert b{color:var(--ok)}.cert code{font-family:ui-monospace,monospace;direction:ltr;display:inline-block;letter-spacing:1px}
.cert.bad{background:#fdf1f1;border-color:#f0c9c9}.cert.bad b{color:#b33}
.foot{margin-top:24px;text-align:center;font-size:11px;color:var(--muted);overflow-wrap:anywhere}
.stamp{position:absolute;top:118px;left:44px;transform:rotate(-12deg);border:3px solid;border-radius:12px;padding:4px 14px;font-weight:900;font-size:15px;opacity:.85}
.stamp.signed{color:var(--ok)}.stamp.draft,.stamp.cancelled{color:#b33}.stamp.sent{color:var(--a)}
.water{position:absolute;inset:0;display:grid;place-items:center;font-size:110px;font-weight:900;color:rgba(0,0,0,.035);transform:rotate(-25deg);pointer-events:none}
/* signing panel */
.signbox{position:fixed;inset:auto 0 0 0;z-index:20;max-width:820px;margin:0 auto;padding:0 10px calc(10px + env(safe-area-inset-bottom))}
.dock{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:20px;background:#161616;color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.25)}
.dock div{flex:1;min-width:0;line-height:1.6}.dock b{display:block;font-size:14px}.dock small{font-size:11px;opacity:.7}
.dock .btn{padding:12px 22px}
.signbox .panel{display:none;max-height:calc(100dvh - 40px);overflow:auto;border-radius:22px 22px 18px 18px}
.signbox.open .panel{display:block;animation:up .25s ease}.signbox.open .dock{display:none}
.signbox .x{float:left;background:#f1efec;border:0;border-radius:10px;width:34px;height:34px;font-size:18px;cursor:pointer}
@keyframes up{from{transform:translateY(40px);opacity:0}}
body.has-dock .page{padding-bottom:110px}
.panel{background:#fff;border-radius:22px;box-shadow:0 18px 60px rgba(0,0,0,.08);padding:24px}
.panel h2{margin:0 0 4px;font-size:18px}.panel .sub{color:var(--muted);font-size:13px;margin:0 0 16px}
.field{display:block;margin-bottom:14px}.field span{display:block;font-size:12px;font-weight:800;margin-bottom:4px}
.field input{width:100%;height:48px;border:1.5px solid #ddd8d0;border-radius:14px;padding:0 14px;font:inherit;font-size:15px}
.field input:focus{outline:0;border-color:var(--a)}
.pad{position:relative;border:1.5px dashed #cfc9c0;border-radius:16px;background:#fbfaf8;touch-action:none}
.pad canvas{display:block;width:100%;height:180px;cursor:crosshair}
.pad .hint{position:absolute;inset:0;display:grid;place-items:center;color:#bdb7ae;pointer-events:none;font-size:13px}.pad .hint[hidden]{display:none}
.pad button{position:absolute;top:8px;left:8px}
.check{display:flex;gap:10px;align-items:flex-start;font-size:13px;margin:14px 0;cursor:pointer}
.check input{width:20px;height:20px;accent-color:var(--a);margin-top:4px}
.otp{display:flex;gap:10px;align-items:flex-end}
.otp .field{flex:1;margin:0}
.otp input{letter-spacing:8px;text-align:center;direction:ltr}
.msg{margin-top:12px;font-size:13px;font-weight:700}.msg.bad{color:#b33}.msg.ok{color:var(--ok)}
.done{text-align:center;padding:30px}
.done .ico{width:64px;height:64px;border-radius:50%;background:#e7f6ed;color:var(--ok);display:grid;place-items:center;margin:0 auto 10px;font-size:32px}
@media (max-width:640px){.sheet{padding:34px 20px 30px}.s-classic .sheet{padding:44px 26px 34px;outline-offset:-10px}.parties,.signs{grid-template-columns:1fr}.stamp{position:static;display:inline-block;transform:none;font-size:12px;margin:0 0 8px}h1.title{font-size:20px}.bar .t{display:none}}
@page{size:A4;margin:14mm 14mm 16mm}
@media print{body{background:#fff}.bar,.signbox,.noprint{display:none!important}.page{margin:0;max-width:none;padding:0}.sheet{box-shadow:none;padding:0}.s-classic .sheet{border:0;outline:0;padding:0}.s-modern .sheet:before{display:none}.doc h2{page-break-after:avoid}}
.annex{margin-top:34px;padding-top:26px;border-top:2px dashed var(--line);page-break-before:always}
.annex-kicker{font-size:12px;font-weight:800;color:var(--a)}
.parent{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:99px;background:#f4f1ec;font-size:11px;font-weight:700}
.deadline{display:inline-block;margin-top:6px;margin-inline-start:6px;padding:2px 10px;border-radius:99px;background:#fff3e6;color:#b45f0a;font-size:11px;font-weight:700}
.deadline.over{background:#fdecec;color:#b33}
.signs{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.sign .role{color:var(--muted);font-size:11px;font-weight:600}
.sign.next{border-color:var(--a);box-shadow:0 0 0 3px var(--a22)}
.idcard{display:block;margin-top:4px}.cardbtn{width:100%;border:1.5px dashed #cfc9c0;padding:14px}
.idprev{max-width:180px;max-height:110px;border-radius:10px;margin-top:6px;display:none}
.who{display:inline-block;padding:2px 10px;border-radius:99px;background:var(--a22);font-size:12px;font-weight:800;margin-bottom:6px}
.expired{padding:14px 18px;border-radius:18px;background:#fdecec;color:#b33;font-weight:700;text-align:center;box-shadow:0 14px 40px rgba(0,0,0,.15)}
.busy{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(255,255,255,.85);font-weight:800;font-size:15px}
</style></head>
<body class="s-<?php echo esc_attr( $s['style'] ); ?>">
<div class="bar noprint"><b><?php echo esc_html( $s['studio'] . ' · ' . ( 'amendment' === $c->kind ? 'الحاقیه ' : 'قرارداد ' ) . "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" ); ?></b>
<?php if ( 'sent' === $c->status && ! $expired ) : ?><button class="btn btn-a" type="button" onclick="document.getElementById('k-open').click()">امضای قرارداد</button><?php endif; ?>
<?php if ( $s['f_pdf'] ) : ?><button class="btn btn-g" type="button" id="k-pdf">دانلود PDF</button><?php endif; ?>
<button class="btn btn-g" type="button" onclick="window.print()">چاپ</button></div>

<div class="page"><article class="sheet" id="sheet">
<?php if ( 'draft' === $c->status ) : ?><div class="water">پیش‌نویس</div><?php endif; ?>
<span class="stamp <?php echo esc_attr( $c->status ); ?>"><?php echo esc_html( $expired ? 'مهلت تمام شده' : $mp_status[ $c->status ] ); ?></span>
<header class="head">
<div><div class="kicker"><?php echo esc_html( $s['studio'] ); ?></div>
<h1 class="title"><?php echo esc_html( $c->title ); ?></h1>
<div class="meta"><span>شماره <?php echo esc_html( "\u{2066}" . MP_Jalali::digits( $c->number ) . "\u{2069}" ); ?></span><span>تاریخ <?php echo esc_html( MP_Jalali::format( substr( $c->created_at, 0, 10 ) ) ); ?></span></div>
<?php if ( $parent ) : ?><span class="parent">الحاقیه قرارداد شماره <?php echo esc_html( "\u{2066}" . MP_Jalali::digits( $parent->number ) . "\u{2069}" ); ?></span><?php endif; ?>
<?php if ( $s['f_expiry'] && 'sent' === $c->status && $c->expires_at ) : ?><span class="deadline<?php echo $expired ? ' over' : ''; ?> noprint">مهلت امضا تا <?php echo esc_html( MP_Jalali::format( $c->expires_at ) ); ?></span><?php endif; ?>
</div>
<?php if ( $s['logo'] ) : ?><img src="<?php echo esc_url( MP_URL . 'assets/img/logo.png' ); ?>" alt="<?php echo esc_attr( $s['studio'] ); ?>"><?php endif; ?>
</header>
<section class="parties">
<div class="party"><small>مجری</small><strong><?php echo esc_html( $s['studio'] ); ?></strong><p>به نمایندگی <?php echo esc_html( $agent ); ?></p><p><?php echo esc_html( $s['address'] ); ?></p></div>
<div class="party"><small>کارفرما</small><strong><?php echo esc_html( $client ); ?></strong>
<?php foreach ( $vars as $k => $v ) : if ( $v && in_array( MP_Contracts::kind( $k ), array( 'national', 'phone' ), true ) ) : ?><p><?php echo esc_html( preg_replace( '/\s*(مشتری|کارفرما)$/u', '', $k ) . ': ' . MP_Jalali::digits( $v ) ); ?></p><?php endif; endforeach; ?></div>
</section>
<div class="doc"><?php echo MP_Contracts::render_body( $c->body, $vars, $c ); // phpcs:ignore -- escaped inside ?></div>
<?php if ( $s['f_annex'] && trim( (string) $c->annex ) ) : ?>
<section class="annex doc"><div class="annex-kicker">پیوست ۱</div><h2><?php echo esc_html( $c->annex_title ? $c->annex_title : 'فهرست امکانات و مشخصات فنی' ); ?></h2><?php echo MP_Contracts::render_body( $c->annex, $vars, $c ); // phpcs:ignore ?></section>
<?php endif; ?>

<section class="signs">
<div class="sign"><small>امضای مجری</small><strong><?php echo esc_html( $agent ); ?></strong><span class="role"><?php echo esc_html( $s['studio'] ); ?></span>
<div class="img"><?php if ( 'draft' !== $c->status && $s['signature'] ) : ?><img src="<?php echo esc_attr( $s['signature'] ); ?>" alt="امضای مجری"><?php else : ?><div class="wait"><?php echo 'draft' === $c->status ? 'پس از ارسال قرارداد' : 'امضای مجری'; ?></div><?php endif; ?></div>
<div class="when"><?php echo $c->sent_at ? 'تاریخ: ' . esc_html( $mp_date( $c->sent_at ) ) : ''; ?></div></div>
<?php foreach ( $signers as $i => $sg ) : ?>
<div class="sign<?php echo 'sent' === $c->status && $i === $next ? ' next' : ''; ?>"><small>امضای <?php echo esc_html( ! empty( $sg['role'] ) ? $sg['role'] : 'کارفرما' ); ?></small><strong><?php echo esc_html( $sg['name'] ); ?></strong>
<div class="img"><?php if ( ! empty( $sg['sig'] ) ) : ?><img src="<?php echo esc_attr( $sg['sig'] ); ?>" alt="امضا"><?php else : ?><div class="wait"><?php echo 'sent' === $c->status && $i === $next ? 'نوبت امضا' : 'منتظر امضا'; ?></div><?php endif; ?></div>
<div class="when"><?php echo ! empty( $sg['signed_at'] ) ? 'تاریخ: ' . esc_html( $mp_date( $sg['signed_at'] ) ) : ''; ?></div></div>
<?php endforeach; ?>
</section>
<?php if ( 'signed' === $c->status ) : ?>
<div class="cert<?php echo $intact ? '' : ' bad'; ?>">
<b><?php echo $intact ? '✓ امضای الکترونیکی معتبر' : '⚠ متن قرارداد پس از امضا تغییر کرده است'; ?></b><br>
<?php foreach ( $signers as $sg ) : ?>
<?php echo esc_html( $sg['name'] ); ?><?php echo ! empty( $sg['mobile'] ) && 'otp' === ( isset( $sg['method'] ) ? $sg['method'] : '' ) ? ' · تأیید با کد پیامکی به ' . esc_html( MP_Jalali::digits( substr( $sg['mobile'], 0, 4 ) . '•••' . substr( $sg['mobile'], -4 ) ) ) : ' · امضای دستی'; ?><?php echo ! empty( $sg['signed_at'] ) ? ' · ' . esc_html( $mp_date( $sg['signed_at'] ) ) : ''; ?><?php echo ! empty( $sg['ip'] ) ? ' · IP ' . esc_html( $sg['ip'] ) : ''; ?><br>
<?php endforeach; ?>
اثر انگشت سند (SHA-256): <code><?php echo esc_html( strtoupper( implode( ' ', str_split( substr( $c->doc_hash, 0, 32 ), 4 ) ) ) ); ?></code>
</div>
<?php endif; ?>
<?php if ( $s['footer'] ) : ?><div class="foot"><?php echo esc_html( $s['footer'] ); ?> · <?php echo esc_html( MP_Contracts::url( $c->token ) ); ?></div><?php endif; ?>
</article></div>

<?php $mp_sg = $next >= 0 ? $signers[ $next ] : null; ?>
<?php if ( 'sent' === $c->status ) : ?>
<div class="signbox noprint" id="sign">
<?php if ( $expired ) : ?>
<div class="expired">مهلت امضای این قرارداد در <?php echo esc_html( MP_Jalali::format( $c->expires_at ) ); ?> تمام شده است؛ برای تمدید با <?php echo esc_html( $s['studio'] ); ?> تماس بگیرید.</div>
<?php else : ?>
<div class="dock"><div><b><?php echo count( $signers ) > 1 ? esc_html( 'نوبت امضای ' . $mp_sg['name'] . ( ! empty( $mp_sg['role'] ) ? ' (' . $mp_sg['role'] . ')' : '' ) ) : 'این قرارداد منتظر امضای شماست'; ?></b><small>بعد از مطالعه، همین‌جا امضا کنید<?php echo $otp ? ' و با کد پیامکی تأیید کنید' : ''; ?><?php echo $s['f_expiry'] && $c->expires_at ? ' · مهلت تا ' . esc_html( MP_Jalali::format( $c->expires_at ) ) : ''; ?></small></div><button class="btn btn-a" type="button" id="k-open">امضای قرارداد</button></div>
<div class="panel" id="panel"><button class="x" type="button" id="k-close" aria-label="بستن">×</button>
<h2>امضای قرارداد</h2>
<?php if ( count( $signers ) > 1 ) : ?><span class="who">امضاکننده <?php echo esc_html( MP_Jalali::digits( (string) ( $next + 1 ) ) . ' از ' . MP_Jalali::digits( (string) count( $signers ) ) . ( ! empty( $mp_sg['role'] ) ? ' · ' . $mp_sg['role'] : '' ) ); ?></span><?php endif; ?>
<p class="sub">متن قرارداد را کامل بخوانید، نام خود را بنویسید، امضا کنید<?php echo $otp ? ' و با کد پیامکی تأیید کنید' : ''; ?>.</p>
<label class="field"><span>نام و نام خانوادگی امضاکننده</span><input id="k-name" autocomplete="name" maxlength="120" value="<?php echo esc_attr( $mp_sg['name'] ); ?>"></label>
<div class="field"><span>امضا</span><div class="pad"><canvas id="k-pad"></canvas><div class="hint" id="k-hint">با انگشت یا ماوس اینجا امضا کنید</div><button class="btn btn-l" type="button" id="k-clear">پاک کردن</button></div></div>
<?php if ( $s['f_idcard'] ) : ?>
<div class="field idcard"><span>تصویر کارت ملی</span><label class="btn btn-l cardbtn"><input type="file" id="k-card" accept="image/*" hidden>📷 عکس یا انتخاب تصویر کارت ملی</label><img class="idprev" id="k-card-prev" alt=""></div>
<?php endif; ?>
<label class="check"><input type="checkbox" id="k-agree"><span>تمام مفاد این قرارداد<?php echo $s['f_annex'] && trim( (string) $c->annex ) ? ' و پیوست آن' : ''; ?> را خوانده‌ام و می‌پذیرم؛ امضای الکترونیکی من به منزله امضای تمامی صفحات قرارداد است.</span></label>
<?php if ( $otp ) : ?>
<div class="otp"><label class="field"><span id="k-code-label">کد تأیید پیامکی</span><input id="k-code" inputmode="numeric" maxlength="5" autocomplete="one-time-code" placeholder="•••••"></label><button class="btn btn-l" type="button" id="k-send">دریافت کد</button></div>
<?php endif; ?>
<button class="btn btn-a" type="button" id="k-submit" style="width:100%;margin-top:14px;padding:14px">امضا و ثبت نهایی</button>
<div class="msg" id="k-msg" role="alert"></div>
</div>
<?php endif; ?>
</div>
<?php endif; ?>
<?php if ( 'signed' === $c->status && $team && $s['f_pdf'] && ! $c->pdf_file_id ) : ?>
<div class="signbox noprint"><div class="dock"><div><b>نسخه PDF این قرارداد هنوز بایگانی نشده</b><small>فایل PDF ساخته و در فایل‌های پروژه و گفت‌وگوی مشتری قرار می‌گیرد.</small></div><button class="btn btn-a" type="button" id="k-archive">بایگانی PDF</button></div></div>
<?php endif; ?>

<script>
(function(){
var API=<?php echo wp_json_encode( esc_url_raw( rest_url( MP_Rest::NS . '/contract/' . $token ) ) ); ?>,OTP=<?php echo $otp ? 'true' : 'false'; ?>,NONCE=<?php echo wp_json_encode( $nonce ); ?>;
var V=<?php echo wp_json_encode( MP_URL . 'assets/vendor/' ); ?>,NAME=<?php echo wp_json_encode( ( 'amendment' === $c->kind ? 'amendment-' : 'contract-' ) . $c->number . '.pdf' ); ?>;
function post(p,b,keep){var h={'Content-Type':'application/json'};if(NONCE)h['X-WP-Nonce']=NONCE;return fetch(API+p,{method:'POST',credentials:'same-origin',keepalive:!!keep,headers:h,body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.message||'خطا');return d;});});}

/* ---- PDF: rendered by the browser itself (correct Persian), cut into A4 pages between paragraphs */
function load(src){return new Promise(function(ok,no){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=no;document.head.appendChild(s);});}
function makePdf(){
  var sheet=document.getElementById('sheet'),busy=document.createElement('div');busy.className='busy';busy.textContent='در حال ساخت PDF…';document.body.appendChild(busy);
  return (window.htmlToImage?Promise.resolve():load(V+'html-to-image.js')).then(function(){return window.jspdf?0:load(V+'jspdf.umd.min.js');}).then(function(){
    var W=sheet.offsetWidth,top=sheet.getBoundingClientRect().top,pageH=W*277/190,cuts=[],forced=[];
    sheet.querySelectorAll('.head,.parties,.doc>*,.doc li,.annex,.annex>*,.signs,.cert,.foot').forEach(function(n){var r=n.getBoundingClientRect();cuts.push(r.bottom-top+6);if(n.classList.contains('annex'))forced.push(r.top-top-4);});
    cuts.sort(function(a,b){return a-b;});
    return htmlToImage.toCanvas(sheet,{pixelRatio:2,backgroundColor:'#ffffff',filter:function(n){return !(n.classList&&n.classList.contains('noprint'));}}).then(function(cv){
      var H=sheet.offsetHeight,k=cv.width/W,pdf=new jspdf.jsPDF({unit:'mm',format:'a4'}),y=0,page=0;
      while(y<H-2){
        var limit=y+pageH,end=H,hard=false;
        forced.forEach(function(f){if(f>y+2&&f<limit){limit=f;hard=true;}});
        if(hard)end=limit; // the attachment starts on its own page
        else if(limit<H){end=y;cuts.forEach(function(c){if(c>y+20&&c<=limit)end=c;});if(end<=y)end=limit;}
        var part=document.createElement('canvas');part.width=cv.width;part.height=Math.ceil((end-y)*k);
        part.getContext('2d').drawImage(cv,0,y*k,cv.width,part.height,0,0,cv.width,part.height);
        if(page)pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg',0.92),'JPEG',10,10,190,(end-y)*190/W);
        y=end;page++;
      }
      return pdf;
    });
  }).finally(function(){busy.remove();});
}
var pb=document.getElementById('k-pdf');
if(pb)pb.onclick=function(){makePdf().then(function(p){p.save(NAME);}).catch(function(){alert('ساخت PDF انجام نشد؛ از «چاپ» و گزینه Save as PDF استفاده کنید.');});};
function archive(){return makePdf().then(function(p){return post('/pdf',{pdf:p.output('datauristring').replace(/;filename=[^;]*/,'')});});}
var ab=document.getElementById('k-archive');
if(ab)ab.onclick=function(){ab.disabled=true;archive().then(function(){location.reload();}).catch(function(e){ab.disabled=false;alert(e.message);});};

<?php if ( $s['f_track'] && 'draft' !== $c->status ) : ?>
/* ---- how far it was read */
var seenMax=0,sentAt=0;
function pct(){var d=document.getElementById('sheet'),r=d.getBoundingClientRect();return Math.max(0,Math.min(100,Math.round((innerHeight-r.top)/r.height*100)));}
post('/seen',{open:1,pct:pct()}).catch(function(){});
addEventListener('scroll',function(){var p=pct();if(p>seenMax)seenMax=p;if(seenMax-sentAt>=20){sentAt=seenMax;post('/seen',{pct:seenMax}).catch(function(){});}},{passive:true});
addEventListener('pagehide',function(){if(seenMax>sentAt)post('/seen',{pct:seenMax},true).catch(function(){});});
<?php endif; ?>

var box=document.getElementById('sign'),cv=document.getElementById('k-pad');
if(!box||!cv)return;
document.body.classList.add('has-dock');
var ctx=cv.getContext('2d'),drawn=false,down=false,last=null;
document.getElementById('k-open').onclick=function(){box.classList.add('open');setTimeout(size,30);};
document.getElementById('k-close').onclick=function(){box.classList.remove('open');};
function size(){var r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1,img=drawn?cv.toDataURL():null;cv.width=r.width*d;cv.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#1a2a6c';if(img){var i=new Image();i.onload=function(){ctx.drawImage(i,0,0,r.width,r.height)};i.src=img;}}
size();addEventListener('resize',size);
function pos(e){var r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
cv.addEventListener('pointerdown',function(e){down=true;last=pos(e);cv.setPointerCapture(e.pointerId);document.getElementById('k-hint').hidden=true;});
cv.addEventListener('pointermove',function(e){if(!down)return;var p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;drawn=true;});
['pointerup','pointercancel','pointerleave'].forEach(function(t){cv.addEventListener(t,function(){down=false;});});
document.getElementById('k-clear').onclick=function(){ctx.clearRect(0,0,cv.width,cv.height);drawn=false;document.getElementById('k-hint').hidden=false;};
var msg=document.getElementById('k-msg');function say(t,ok){msg.textContent=t;msg.className='msg '+(ok?'ok':'bad');}
/* ID card: shrunk to a JPEG in the browser before sending */
var card='',ci=document.getElementById('k-card');
if(ci)ci.onchange=function(){var f=ci.files[0];if(!f)return;var img=new Image();img.onload=function(){var m=1400,s=Math.min(1,m/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=img.width*s;c.height=img.height*s;c.getContext('2d').drawImage(img,0,0,c.width,c.height);card=c.toDataURL('image/jpeg',0.82);var pv=document.getElementById('k-card-prev');pv.src=card;pv.style.display='block';URL.revokeObjectURL(img.src);};img.src=URL.createObjectURL(f);};
var send=document.getElementById('k-send');
if(send)send.onclick=function(){send.disabled=true;post('/code').then(function(d){say('کد به '+d.to+' ارسال شد.',true);document.getElementById('k-code').focus();var s=d.wait||60,t=setInterval(function(){s--;send.textContent=s>0?'ارسال دوباره ('+s+')':'ارسال دوباره';if(s<=0){clearInterval(t);send.disabled=false;}},1000);}).catch(function(e){send.disabled=false;say(e.message);});};
document.getElementById('k-submit').onclick=function(){
  var name=document.getElementById('k-name').value.trim(),agree=document.getElementById('k-agree').checked,code=OTP?document.getElementById('k-code').value.replace(/[۰-۹]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)}):'';
  if(!name)return say('نام خود را بنویسید.');if(!drawn)return say('امضای خود را در کادر بکشید.');if(ci&&!card)return say('تصویر کارت ملی را بارگذاری کنید.');if(!agree)return say('پذیرش مفاد قرارداد را تأیید کنید.');if(OTP&&code.length<5)return say('کد تأیید پیامکی را وارد کنید.');
  var b=this;b.disabled=true;b.textContent='در حال ثبت…';
  post('/sign',{name:name,agree:true,code:code,signature:cv.toDataURL('image/png'),id_card:card}).then(function(d){
    document.getElementById('panel').innerHTML='<div class="done"><div class="ico">✓</div><h2>'+(d.complete?'قرارداد امضا شد':'امضای شما ثبت شد')+'</h2><p class="sub">'+(d.complete?'نسخه نهایی با همه امضاها آماده است.':'امضاکننده بعدی با پیامک خبردار شد.')+'</p></div>';
    // The signed PDF is made here, once, and kept in the project.
    var after=d.complete&&d.pdf?new Promise(function(r){setTimeout(r,300);}).then(function(){location.hash='';return fetch(location.href,{credentials:'same-origin'}).then(function(r){return r.text();}).then(function(h){var doc=new DOMParser().parseFromString(h,'text/html');document.getElementById('sheet').replaceWith(doc.getElementById('sheet'));return archive();});}).catch(function(){}):Promise.resolve();
    after.then(function(){setTimeout(function(){location.reload()},800);});
  }).catch(function(e){b.disabled=false;b.textContent='امضا و ثبت نهایی';say(e.message);});
};
})();
</script>
<?php if ( isset( $_GET['print'] ) ) : // phpcs:ignore ?><script>addEventListener('load',function(){setTimeout(print,400)})</script><?php endif; ?>
<?php if ( isset( $_GET['pdf'] ) && $s['f_pdf'] ) : // phpcs:ignore ?><script>addEventListener('load',function(){setTimeout(function(){document.getElementById('k-pdf').click()},500)})</script><?php endif; ?>
</body></html>

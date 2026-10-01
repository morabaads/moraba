import json
SP='/tmp/kooch-work/'
items=json.load(open(SP+'items.json'));sprite=open(SP+'sprite.html').read()
def fa(n): return str(n).translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))
spans=[7,5,5,7,7,5,5,7]
themes=['','','','hot','','cream','','']
tags=['۳ مرحله','۹۸٪ اطمینان','۴ منبع','نگهبان قیمت','همیشه به‌روز','یک‌بار برگشت','۴ کانال','RTL']
cards=''
for i,(ico,h,p,bar,body) in enumerate(items):
    cards+=f'''<section class="row {'alt' if i%2 else ''}">
  <div class="dot">{'۰'+fa(i+1)}</div>
  <div class="txt">
    <div class="num">{'۰'+fa(i+1)}</div>
    <div class="ico">{ico}</div>
    <h2>{h}</h2>
    <p>{p}</p>
  </div>
  <div class="stage"><div class="stack"></div><div class="panel"><div class="bar"><i></i><i></i><i></i><b>{bar}</b></div><div class="body">{body}</div></div><div class="tag">{tags[i]}</div></div>
</section>
'''
html=f'''<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>کوچ | انتقال و همگام‌سازی محصولات ووکامرس</title>
<style>
@font-face{{font-family:Dana;src:url(DanaVF.ttf);font-weight:100 1000}}
:root{{--o:#ff5a1f;--o2:#ff8a3d;--bg:#100d0a;--card:#191510;--card2:#221d16;--line:#332b21;--tx:#f6f1ea;--mu:#a39a8c;--ok:#3ddc84;--wn:#f5b942;--cream:#f2eadf}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--tx);font-family:Dana,Tahoma,sans-serif;overflow-x:hidden}}
.poster{{width:1080px;margin:0 auto;position:relative;overflow:hidden;padding-bottom:70px;background:
 radial-gradient(700px 480px at 85% 0,rgba(255,90,31,.28),transparent 70%),
 radial-gradient(600px 500px at 0 55%,rgba(255,138,61,.10),transparent 70%),
 radial-gradient(rgba(255,255,255,.055) 1.2px,transparent 1.4px) 0 0/26px 26px,var(--bg)}}
@media(max-width:1079px){{.poster{{zoom:.36}}}}
.i{{width:1.15em;height:1.15em;vertical-align:-.22em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}}

/* hero */
.top{{display:flex;align-items:center;gap:14px;padding:46px 60px 0;font-size:24px;font-weight:700;color:var(--mu)}}
.top img{{height:46px}}
.top span{{margin-inline-start:auto;border:1px solid var(--line);border-radius:99px;padding:6px 20px;font-size:20px;color:var(--o2)}}
.hero{{padding:70px 60px 0;position:relative}}
.kicker{{font-size:30px;font-weight:700;color:var(--o2);letter-spacing:.5px}}
.hero h1{{font-size:250px;font-weight:950;line-height:.95;margin:6px 0 0 -6px;color:transparent;-webkit-text-stroke:3px var(--tx);position:relative;display:inline-block}}
.hero h1::after{{content:"کوچ";position:absolute;inset:0;transform:translate(-14px,12px);color:var(--o);-webkit-text-stroke:0;z-index:-1;opacity:.95}}
.hero h2{{font-size:46px;font-weight:800;line-height:1.5;margin-top:26px;max-width:720px}}
.hero h2 em{{font-style:normal;color:var(--o2)}}
.hero p{{font-size:24px;color:var(--mu);margin-top:14px}}

/* route */
.route{{margin:56px 60px 0;display:flex;align-items:center;gap:0;position:relative}}
.node{{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:20px 24px;min-width:230px;text-align:center;position:relative;z-index:2}}
.node small{{display:block;color:var(--mu);font-size:16px;margin-bottom:4px}}
.node b{{font-size:26px}}
.node.k{{background:linear-gradient(140deg,var(--o2),var(--o));border:0;color:#fff;box-shadow:0 0 70px rgba(255,90,31,.55);padding:26px 34px;min-width:200px}}
.node.k small{{color:rgba(255,255,255,.85)}}
.node.k b{{font-size:44px;font-weight:900}}
.path{{flex:1;height:0;border-top:3px dashed rgba(255,138,61,.7);position:relative;margin:0 -6px}}
.path::after{{content:"";position:absolute;top:-11px;left:50%;width:18px;height:18px;border-radius:5px;background:var(--o2);transform:rotate(45deg);box-shadow:0 0 20px var(--o)}}
.path span{{position:absolute;top:-46px;left:0;right:0;text-align:center;font-size:17px;color:var(--mu)}}

/* ribbon */
.ribbon{{margin:64px -40px 0;background:var(--o);color:#150b04;font-weight:900;font-size:30px;padding:16px 0;transform:rotate(-2.2deg);white-space:nowrap;text-align:center;letter-spacing:.3px;box-shadow:0 20px 70px rgba(255,90,31,.35)}}
.ribbon i{{display:inline-block;width:12px;height:12px;background:#150b04;transform:rotate(45deg);margin:0 22px}}

/* rows */
.rows{{position:relative;padding:20px 40px 0}}
.rows::before{{content:"";position:absolute;left:50%;top:0;bottom:60px;border-left:3px dashed rgba(255,138,61,.55);transform:translateX(-1.5px)}}
.row{{display:flex;align-items:center;gap:90px;margin-top:80px;position:relative}}
.row.alt{{flex-direction:row-reverse}}
.row>.txt,.row>.stage{{flex:1;min-width:0}}
.dot{{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:70px;height:70px;border-radius:50%;background:linear-gradient(140deg,var(--o2),var(--o));color:#150b04;font-size:26px;font-weight:900;display:grid;place-items:center;box-shadow:0 0 0 10px var(--bg),0 0 50px rgba(255,90,31,.6);z-index:3}}
.txt{{position:relative}}
.num{{font-size:150px;font-weight:950;line-height:.9;color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.18);margin-bottom:-24px}}
.ico{{width:76px;height:76px;border-radius:24px;display:grid;place-items:center;background:rgba(255,90,31,.14);border:1px solid rgba(255,90,31,.5);color:var(--o2);margin-bottom:22px;position:relative}}
.ico .i{{width:38px;height:38px;stroke-width:1.8}}
.txt h2{{font-size:36px;font-weight:900;line-height:1.35;white-space:nowrap}}
.txt p{{font-size:22px;color:var(--mu);line-height:2;margin-top:12px}}
.stage{{position:relative;padding:14px}}
.stack{{position:absolute;inset:0;border-radius:30px;border:2px solid rgba(255,138,61,.55);transform:translate(-22px,22px) rotate(-2deg);background:linear-gradient(140deg,rgba(255,90,31,.22),transparent)}}
.alt .stack{{transform:translate(22px,22px) rotate(2deg)}}
.stage .panel{{transform:rotate(1.6deg)}}
.alt .stage .panel{{transform:rotate(-1.6deg)}}
.tag{{position:absolute;top:-14px;right:-10px;background:var(--o);color:#150b04;font-weight:900;font-size:19px;padding:7px 18px;border-radius:14px;transform:rotate(5deg);box-shadow:0 12px 40px rgba(255,90,31,.5);z-index:4}}
.alt .tag{{right:auto;left:-10px;transform:rotate(-5deg)}}

/* panel mock */
.panel{{margin-top:auto;background:#0f0c09;border:1px solid #3a3126;border-radius:22px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.55);position:relative}}
.bar{{display:flex;align-items:center;gap:7px;padding:12px 16px;background:#15110d;border-bottom:1px solid var(--line);font-size:13px;color:var(--mu)}}
.bar i{{width:10px;height:10px;border-radius:50%;background:#3a3126}}.bar i:first-child{{background:var(--o)}}
.bar b{{margin-inline-start:auto;font-weight:600}}
.body{{padding:20px;display:flex;flex-direction:column;gap:12px;font-size:15px;color:var(--tx)}}
.steps{{display:flex;gap:7px}}
.steps div{{flex:1;text-align:center;font-size:13px;padding:8px 0;border-radius:10px;background:var(--card2);color:var(--mu);border:1px solid var(--line)}}
.steps div.on{{background:rgba(255,90,31,.15);color:var(--o2);border-color:var(--o)}}.steps div.done{{color:var(--ok)}}
.input{{background:#0a0806;border:1px solid var(--line);border-radius:12px;padding:12px 14px;color:var(--mu);font-size:14px;direction:ltr;text-align:left}}
.btn{{background:linear-gradient(135deg,var(--o2),var(--o));color:#fff;font-weight:800;text-align:center;padding:12px;border-radius:12px;font-size:15px}}
.btn.g{{background:var(--card2);border:1px solid var(--line);color:var(--tx)}}
.chips{{display:flex;flex-wrap:wrap;gap:7px}}
.chip{{background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--tx)}}
.chip.ok{{color:var(--ok);border-color:rgba(61,220,132,.4)}}.chip.o{{color:var(--o2);border-color:rgba(255,90,31,.5)}}
.fld{{display:flex;align-items:center;gap:10px;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:10px 13px}}
.fld span.l{{color:var(--mu);font-size:12.5px;width:60px}}.fld span.l .i{{color:var(--o2)}}
.fld span.v{{flex:1;font-size:14px;font-weight:600}}
.conf{{font-size:12px;font-weight:800;padding:3px 9px;border-radius:8px}}
.conf.h{{background:rgba(61,220,132,.15);color:var(--ok)}}.conf.m{{background:rgba(245,185,66,.15);color:var(--wn)}}
.prod{{display:flex;gap:12px;background:var(--card2);border-radius:14px;padding:12px;border:1px solid var(--line)}}
.prod .im{{width:74px;height:74px;border-radius:12px;background:linear-gradient(135deg,#3a3128,#221c15);flex:none;display:grid;place-items:center}}
.prod .im .i{{width:36px;height:36px;color:var(--mu);stroke-width:1.6}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.tile{{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:14px;text-align:center}}
.tile b{{display:block;font-size:24px;color:var(--o2)}}.tile span{{font-size:12.5px;color:var(--mu)}}
.tgl{{width:42px;height:23px;border-radius:99px;background:var(--o);position:relative;flex:none}}
.tgl::after{{content:"";position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff}}
.tgl.off{{background:#3a3126}}.tgl.off::after{{left:22px}}
.line{{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--line);font-size:14.5px}}
.ltr{{direction:ltr;unicode-bidi:isolate}}
</style>
</head>
<body>
{sprite}<div class="poster">

<header class="hero">
  <h1>کوچ</h1>
  <h2>محصول را <em>ببین</em>، تأیید کن؛<br>بقیه‌اش را کوچ <em>منتقل می‌کند</em></h2>
  <p>انتقال و همگام‌سازی محصول، قیمت و موجودی — فارسی‌محور و برگشت‌پذیر</p>
</header>

<div class="route">
  <div class="node"><small>مبدأ</small><b>فروشگاه منبع</b></div>
  <div class="path"><span>پیش‌نمایش و تأیید</span></div>
  <div class="node k"><small>انتقال</small><b>کوچ</b></div>
  <div class="path"><span>قیمت و موجودی زنده</span></div>
  <div class="node"><small>مقصد</small><b>فروشگاه شما</b></div>
</div>

<div class="ribbon">برگشت‌پذیر<i></i>فارسی‌محور<i></i>پیش‌نمایش قبل از انتقال<i></i>همگام‌سازی خودکار<i></i>برگشت‌پذیر</div>

<main class="rows">
{cards}</main>

</div>
</body>
</html>
'''
open('/home/user/moraba/kooch-showcase/index.html','w',encoding='utf-8').write(html)

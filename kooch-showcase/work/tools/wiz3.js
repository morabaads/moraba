const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const S='/tmp/kooch-work/shots/';
const CSS=`#wpadminbar,#adminmenumain,#adminmenuback,#adminmenuwrap,#wpfooter,.notice,.update-nag{display:none!important}html.wp-toolbar{padding-top:0!important}#wpcontent,#wpfooter{margin-right:0!important;margin-left:0!important;padding:0!important}`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--host-resolver-rules=MAP shop.example.ir 45.10.10.2']});
const ctx=await b.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2,locale:'fa-IR'});
const p=await ctx.newPage();p.setDefaultTimeout(30000);p.on('response',async r=>{if(r.status()>=400&&r.url().includes('wp-json')){try{console.log('HTTPERR',r.status(),r.request().method(),r.url(),(await r.text()).slice(0,800))}catch(e){}}});
let k=0;const dump=async(n,txt)=>{await p.waitForTimeout(2500);await p.addStyleTag({content:CSS});await p.waitForTimeout(400);await p.screenshot({path:S+n+'.png',fullPage:true});if(txt){console.log('---',n,'\n',(await p.evaluate(()=>document.querySelector('#wpbody-content').innerText)).slice(0,txt));}};
await p.goto('http://127.0.0.1:8080/wp-login.php');await p.fill('#user_login','admin');await p.fill('#user_pass','admin');await p.click('#wp-submit');await p.waitForLoadState('networkidle');
await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page=kooch-new',{waitUntil:'networkidle'});await p.waitForTimeout(1500);
await p.fill('input[placeholder*="انتقال محصولات"]','انتقال محصولات فروشگاه نمونه');
await p.click('text=ساخت کوچ و شروع تنظیمات');await p.waitForTimeout(2500);
await dump('s1_type');
await p.click('text=ادامه با دسته‌بندی یا کل فروشگاه');await p.waitForTimeout(1500);
await p.locator('input[type="url"], input[placeholder*="https"]').first().fill('http://shop.example.ir/');
await p.waitForTimeout(9000);await dump('s2_source');
const fa=n=>String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);
const next=async(n)=>{for(let i=0;i<4;i++){await p.locator('button:has-text("ادامه")').last().click();try{await p.waitForSelector('text=مرحله '+fa(n)+' از ۶',{timeout:15000});break;}catch(e){console.log('retry',n)}}await p.waitForTimeout(3000);};
await next(3);await dump('s3_fields');
await next(4);await dump('s4_ai');
await next(5);await p.waitForTimeout(2000);
try{const inp=p.locator('xpath=//*[normalize-space(text())="سود (٪)"]/following::input[1]');await inp.fill("12",{timeout:8000});}catch(e){console.log('profit fail',e.message)}
try{await p.click('text=پایان ۹۰۰ (مثلاً ۱۳۹٬۹۰۰)');}catch(e){try{await p.selectOption('select:has(option:has-text("پایان ۹۰۰"))',{label:'پایان ۹۰۰ (مثلاً ۱۳۹٬۹۰۰)'});}catch(e2){console.log('round fail')}}
try{await p.click("text=هر روز",{timeout:5000});}catch(e){console.log('day fail')}
try{await p.click("text=هر ۳ ساعت",{timeout:5000});}catch(e){console.log('3h fail')}
await dump('s5_settings');
await p.locator('button:has-text("ذخیره تنظیمات")').last().click();try{await p.waitForSelector('text=مرحله ۶ از ۶',{timeout:30000})}catch(e){console.log('no6')}await p.waitForTimeout(20000);await dump('s6_preview',3000);
await p.locator('button:has-text("تأیید و شروع انتقال")').last().click();
await p.waitForTimeout(45000);try{await p.click('text=جزئیات فنی',{timeout:3000});await p.waitForTimeout(800);console.log('DETAILS',(await p.evaluate(()=>document.body.innerText)).split('جزئیات فنی')[1].slice(0,800));}catch(e){console.log('nodetails')}await dump('s7_run',300);
await b.close();})();

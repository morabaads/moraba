const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const S='/tmp/kooch-work/shots/';
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,locale:'fa-IR'});
const p=await ctx.newPage();p.setDefaultTimeout(20000);
const dump=async(n)=>{await p.waitForTimeout(2500);await p.screenshot({path:S+n+'.png',fullPage:true});console.log('---',n,'\n',(await p.evaluate(()=>document.querySelector('#wpbody-content').innerText)).slice(0,1800));};
await p.goto('http://127.0.0.1:8080/wp-login.php');await p.fill('#user_login','admin');await p.fill('#user_pass','admin');await p.click('#wp-submit');await p.waitForLoadState('networkidle');
await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page=kooch-new',{waitUntil:'networkidle'});await p.waitForTimeout(1500);
await p.fill('input[placeholder*="انتقال محصولات"]','انتقال محصولات فروشگاه نمونه');
await p.click('text=ساخت کوچ و شروع تنظیمات');await p.waitForTimeout(2500);
await p.click('text=ادامه با دسته‌بندی یا کل فروشگاه');
await dump('w2');
const inp=p.locator('input[type="url"], input[placeholder*="https"]').first();await inp.fill('http://shop.example.ir/');
await dump('w2b');
const steps=JSON.parse(process.argv[2]||'[]');
for(const [i,s] of steps.entries()){ if(s.click) await p.click(s.click); if(s.wait) await p.waitForTimeout(s.wait); await dump('w3_'+i);}
await b.close();})();

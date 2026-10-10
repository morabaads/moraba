const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2,locale:'fa-IR'});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8080/wp-login.php');await p.fill('#user_login','admin');await p.fill('#user_pass','admin');await p.click('#wp-submit');await p.waitForLoadState('networkidle');
const pages=process.argv.slice(2);
for(const slug of pages){await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page='+slug,{waitUntil:'networkidle'});await p.waitForTimeout(2500);
 await p.screenshot({path:process.env.OUT+'/'+slug+'.png',fullPage:true});console.log('ok',slug);}
await b.close();})();

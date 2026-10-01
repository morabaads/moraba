const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const S='/tmp/kooch-work/shots/';
const CSS=`#wpadminbar,#adminmenumain,#adminmenuback,#adminmenuwrap,#wpfooter,.notice,.update-nag,.woocommerce-layout__header,.woocommerce-store-alerts{display:none!important}html.wp-toolbar{padding-top:0!important}#wpcontent{margin-right:0!important;margin-left:0!important}`;
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--host-resolver-rules=MAP shop.example.ir 45.10.10.2']});
const ctx=await b.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2,locale:'fa-IR'});
const p=await ctx.newPage();p.setDefaultTimeout(20000);
const shot=async(n,full=true)=>{await p.addStyleTag({content:CSS});await p.waitForTimeout(800);await p.screenshot({path:S+n+'.png',fullPage:full});console.log('ok',n);};
await p.goto('http://127.0.0.1:8080/wp-login.php');await p.fill('#user_login','admin');await p.fill('#user_pass','admin');await p.click('#wp-submit');await p.waitForLoadState('networkidle');
await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page=kooch',{waitUntil:'networkidle'});await p.waitForTimeout(3000);await shot('m_manage');
await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page=kooch-settings',{waitUntil:'networkidle'});await p.waitForTimeout(2500);
await p.locator('button:has-text("اطلاع‌رسانی"), [role=tab]:has-text("اطلاع‌رسانی")').first().click();await p.waitForTimeout(2000);await shot('m_notify');
await p.locator('button:has-text("هوش مصنوعی"), [role=tab]:has-text("هوش مصنوعی")').first().click();await p.waitForTimeout(2000);await shot('m_ai');

await p.goto('http://127.0.0.1:8080/wp-admin/admin.php?page=kooch-cargo',{waitUntil:'networkidle'});await p.waitForTimeout(2500);await shot('m_cargo');
await b.close();})();

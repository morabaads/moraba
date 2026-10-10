const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1080,height:1000}});
await p.goto('file:///home/user/moraba/kooch-showcase/index.html');await p.waitForTimeout(800);
await p.screenshot({path:'kooch-showcase.png',fullPage:true});await b.close();})();

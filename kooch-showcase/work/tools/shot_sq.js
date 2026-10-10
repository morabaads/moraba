const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:320,height:320},deviceScaleFactor:1});
await p.goto('file:///home/user/moraba/kooch-showcase/square.html');await p.waitForTimeout(600);
await p.screenshot({path:'kooch-thumb-320.png',clip:{x:0,y:0,width:320,height:320}});await b.close();})();

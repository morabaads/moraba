const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1050,height:520},deviceScaleFactor:2});
await p.goto('file:///home/user/moraba/kooch-showcase/thumbnail.html');await p.waitForTimeout(700);
await p.screenshot({path:'kooch-thumbnail.png',clip:{x:0,y:0,width:1050,height:520}});await b.close();})();

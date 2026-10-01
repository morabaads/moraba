const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:960,height:1000},deviceScaleFactor:1});
await p.goto('file:///home/user/moraba/kooch-showcase/infographic.html');await p.waitForTimeout(1500);
const el=await p.$('.w');let chosen=null;
for(const q of [92,88,85,80,75,70]){const buf=await el.screenshot({type:'jpeg',quality:q});console.log(q,buf.length);if(buf.length<990000){fs.writeFileSync('/home/user/moraba/kooch-showcase/kooch-infographic-960.jpg',buf);chosen=q;break;}}
console.log('chosen',chosen);await b.close();})();

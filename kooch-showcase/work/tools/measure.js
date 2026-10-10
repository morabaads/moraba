const {chromium}=require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1080,height:1000}});
await p.goto('file:///home/user/moraba/kooch-showcase/index.html');await p.waitForTimeout(600);
console.log(JSON.stringify(await p.$$eval('.txt h2',e=>e.map(x=>[x.textContent,x.scrollWidth,x.parentElement.clientWidth,x.getBoundingClientRect().height]))));await b.close();})();

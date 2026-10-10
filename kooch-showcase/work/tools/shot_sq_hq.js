const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:320,height:320},deviceScaleFactor:4});
await p.goto('file:///home/user/moraba/kooch-showcase/square.html');await p.waitForTimeout(600);
const big=await p.screenshot({clip:{x:0,y:0,width:320,height:320}});
fs.writeFileSync('kooch-thumb-1280.png',big);
const q=await b.newPage({viewport:{width:320,height:320}});
const out=await q.evaluate(async(d)=>{const img=new Image();img.src='data:image/png;base64,'+d;await img.decode();
 let c=document.createElement('canvas'),w=img.width;c.width=w;c.height=w;c.getContext('2d').drawImage(img,0,0);
 while(w>320){const n=Math.max(320,w/2);const c2=document.createElement('canvas');c2.width=n;c2.height=n;const x=c2.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(c,0,0,n,n);c=c2;w=n;}
 return c.toDataURL('image/png').split(',')[1];},big.toString('base64'));
fs.writeFileSync('kooch-thumb-320.png',Buffer.from(out,'base64'));await b.close();})();

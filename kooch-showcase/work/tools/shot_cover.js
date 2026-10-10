const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1050,height:520},deviceScaleFactor:3});
await p.goto('file:///home/user/moraba/kooch-showcase/thumbnail.html');await p.waitForTimeout(700);
const big=await p.screenshot({clip:{x:0,y:0,width:1050,height:520}});
const q=await b.newPage();
const out=await q.evaluate(async(d)=>{const img=new Image();img.src='data:image/png;base64,'+d;await img.decode();
 let c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);let w=img.width,h=img.height;
 while(w>1050){const nw=Math.max(1050,Math.round(w/2)),nh=Math.round(h*nw/w);const c2=document.createElement('canvas');c2.width=nw;c2.height=nh;const x=c2.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(c,0,0,nw,nh);c=c2;w=nw;h=nh;}
 return c.toDataURL('image/png').split(',')[1];},big.toString('base64'));
fs.writeFileSync('kooch-cover-1050x520.png',Buffer.from(out,'base64'));await b.close();})();

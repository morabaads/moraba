const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const D='/home/user/moraba/kooch-showcase/';const src=process.argv[2]||'cover2.html';
for(const [dpr,name] of [[4,'big'],[2,'2x']]){const p=await b.newPage({viewport:{width:1050,height:520},deviceScaleFactor:dpr});
await p.goto('file://'+D+src);await p.waitForTimeout(900);const buf=await p.screenshot({clip:{x:0,y:0,width:1050,height:520}});
if(name==='2x'){fs.writeFileSync(D+'kooch-cover-2100x1040.png',buf);}
else{const q=await b.newPage();const out=await q.evaluate(async(d)=>{const img=new Image();img.src='data:image/png;base64,'+d;await img.decode();
 let c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);let w=img.width,h=img.height;
 while(w>1050){const nw=Math.max(1050,w/2),nh=h*nw/w;const c2=document.createElement('canvas');c2.width=nw;c2.height=nh;const x=c2.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(c,0,0,nw,nh);c=c2;w=nw;h=nh;}
 return c.toDataURL('image/png').split(',')[1];},buf.toString('base64'));fs.writeFileSync(D+'kooch-cover-1050x520.png',Buffer.from(out,'base64'));}
await p.close();}
await b.close();})();

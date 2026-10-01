const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1080,height:1000},deviceScaleFactor:2});
await p.goto('file:///home/user/moraba/kooch-showcase/index.html');await p.waitForTimeout(800);
const big=await p.screenshot({fullPage:true});
const q=await b.newPage({viewport:{width:400,height:400}});
const res=await q.evaluate(async(d)=>{const img=new Image();img.src='data:image/png;base64,'+d;await img.decode();
 const W=960,H=Math.round(img.height*W/img.width);
 let c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
 let w=img.width,h=img.height;
 while(w>W){const nw=Math.max(W,Math.round(w/2)),nh=Math.round(h*nw/w);const c2=document.createElement('canvas');c2.width=nw;c2.height=nh;const x=c2.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(c,0,0,nw,nh);c=c2;w=nw;h=nh;}
 const out={};for(const qq of [0.9,0.85,0.8,0.75]){out[qq]=c.toDataURL('image/jpeg',qq).split(',')[1];}
 return {out,w,h};},big.toString('base64'));
let chosen=null;for(const qq of ['0.9','0.85','0.8','0.75']){const buf=Buffer.from(res.out[qq],'base64');console.log(qq,buf.length);if(!chosen&&buf.length<950000){chosen=qq;fs.writeFileSync('kooch-infographic-960.jpg',buf);}}
console.log('chosen',chosen,res.w,res.h);await b.close();})();

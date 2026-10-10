const {chromium}=require('/opt/node22/lib/node_modules/playwright');
const items={
phone:'<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
headphone:'<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>',
watch:'<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4M12 9v3l2 1"/>',
laptop:'<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20l-2-4H4z"/>',
speaker:'<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6.5" r="1.3"/>',
tablet:'<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/>'};
const colors={phone:['#dfe7f2','#9fb3cf'],headphone:['#f3e6dc','#c99a78'],watch:['#e3efe6','#86b394'],laptop:['#e9e6f2','#a197c7'],speaker:['#f2e1e1','#cc8b8b'],tablet:['#e6eef0','#8eb0b8']};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage({viewport:{width:800,height:800}});
for(const [k,path] of Object.entries(items)){const [c1,c2]=colors[k];
await p.setContent(`<body style="margin:0"><div style="width:800px;height:800px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#fff,${c1} 70%)"><svg width="440" height="440" viewBox="0 0 24 24" fill="${c2}" fill-opacity=".25" stroke="${c2}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 30px 30px rgba(0,0,0,.18))">${path}</svg></div></body>`);
await p.screenshot({path:'/tmp/kooch-work/pimg/'+k+'.jpg',type:'jpeg',quality:88});}
await b.close();})();

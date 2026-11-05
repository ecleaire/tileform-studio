import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'node:net';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const chrome=[process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser']
  .filter(Boolean).find(bin=>spawnSync(bin,['--version'],{stdio:'ignore'}).status===0);
assert.ok(chrome,'Chrome/Chromium is required for browser tests');
const port=await new Promise((resolve,reject)=>{
  const server=createServer();server.on('error',reject);
  server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
const dir=mkdtempSync(join(tmpdir(),'tileform-browser-'));
// Serve long-lived legacy model responses first, then navigate the same browser to
// the current app. Its model requests must escape the warmed HTTP cache.
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const assetRequests=[],root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.stl':'application/octet-stream','.wasm':'application/wasm'};
const server=createHttpServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/warmup.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Cache warmup</title>');return;}
 const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{
  const model=/\/assets\/(?:(?:v2|v3)\/)?(corner|edge|center)\.stl$/.test(url.pathname);
  const body=model&&!url.search?Buffer.from('stale-model:'+url.pathname):readFileSync(path);
  if(model)assetRequests.push(url.pathname+url.search);
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':model?'public, max-age=31536000':'no-cache'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const publicSite=process.env.TILEFORM_SITE_URL;
const origin=publicSite?new URL(publicSite).href.replace(/\/$/,''):'http://127.0.0.1:'+server.address().port;
const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
  '--remote-allow-origins=*','--remote-debugging-port='+port,
  '--user-data-dir='+dir,'about:blank'],{stdio:['ignore','ignore','pipe']});
let ws,inspectPage;
let chromeErrors='';
browser.stderr.on('data',chunk=>{chromeErrors=(chromeErrors+chunk.toString()).slice(-7000);});
async function poll(check,title,timeout=30000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{const result=await check();if(result)return result;}catch{}
    await delay(200);
  }
  throw Error('Timed out waiting for '+title);
}
try{
  if(publicSite){
    await poll(async()=>{
      const response=await fetch(origin+'/?verify='+version,{signal:AbortSignal.timeout(10000),cache:'no-store'});
      return response.ok&&(await response.text()).includes('v'+version);
    },'published version '+version,180000);
    for(const file of ['typography.css','changelog.html','changelog.css','history-dialog.js','history-dialog.css','formats.js','app.js','core.js','settings.js','export-worker.js','solid.js','style.css','assets/corner.stl','assets/edge.stl','assets/center.stl','assets/v2/corner.stl','assets/v2/edge.stl','assets/v2/center.stl','assets/v3/corner.stl','assets/v3/edge.stl','assets/v3/center.stl','vendor/manifold.wasm']){
      const response=await fetch(origin+'/'+file+'?v='+version,{signal:AbortSignal.timeout(15000),cache:'no-store'});
      assert.equal(response.status,200,'published '+file);
      const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
      assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(readFileSync(join(root,file))),'published content mismatch: '+file);
    }
  }else await poll(async()=>(await fetch(origin+'/')).ok,'local server');
  const endpoint=await poll(async()=>{
    const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    return tabs.find(t=>t.type==='page')?.webSocketDebuggerUrl;
  },'Chrome debugger');
  ws=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  let seq=0;
  const pending=new Map();
  ws.addEventListener('message',({data})=>{
    const response=JSON.parse(data);
    if(!response.id||!pending.has(response.id))return;
    const current=pending.get(response.id);pending.delete(response.id);
    response.error?current.reject(Error(response.error.message)):current.resolve(response.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });
  ws.addEventListener('message',({data})=>{const entry=JSON.parse(data);if(entry.method==='Runtime.exceptionThrown')console.error('Browser exception:',entry.params?.exceptionDetails?.exception?.description||entry.params?.exceptionDetails?.text);});
  const evaluate=async expression=>{
    const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);
    return reply.result.value;
  };
  const reloadReady=async title=>{
    const before=await evaluate('performance.timeOrigin');
    await send('Page.reload');
    await poll(()=>evaluate(`performance.timeOrigin!==${before} && document.querySelector('#model-status')?.textContent.includes('自動配置済み') && !document.querySelector('#export')?.disabled`),title);
  };
  inspectPage=evaluate;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    document.addEventListener('click',event=>{if(event.target instanceof HTMLAnchorElement && event.target.download)window.__lastFilename=event.target.download;},true);
    const createObjectURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(blob.type==='model/stl')window.__lastExport=blob;if(['model/stl','text/plain','model/gltf-binary'].includes(blob.type))window.__lastModelBlob=blob;return createObjectURL(blob);};
    window.__tileformScenes=[];window.__THREE_DEVTOOLS__=new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe',event=>{
      if(!event.detail.isScene)return;
      window.__tileformScenes.push(event.detail);
      event.detail.onBeforeRender=(renderer,scene,camera)=>{
        if(scene.children.some(group=>group.children.some(mesh=>mesh.userData.type))){window.__tileformScene=scene;window.__tileformCamera=camera;}
      };
    });
  `});
  await send('Page.enable');
  await send('Runtime.enable');
  if(!publicSite){
  await send('Page.navigate',{url:origin+'/warmup.html'});
  await poll(()=>evaluate("document.title==='Cache warmup'"),'cache warmup page');
  assert.equal(await evaluate("(async()=>{const urls=['corner','edge','center'].map(type=>'/assets/'+type+'.stl');for(const url of urls){const stale=await (await fetch(url)).text();if(!stale.startsWith('stale-model:'))return false;}return true;})()"),true);
  assert.equal(assetRequests.length,3);
  // These repeat requests must hit the browser's cache, proving the fixture is warm.
  await evaluate("Promise.all(['corner','edge','center'].map(type=>fetch('/assets/'+type+'.stl').then(r=>r.text())))");
  assert.equal(assetRequests.length,3,'legacy models should remain in browser HTTP cache');
  }
  await send('Page.navigate',{url:origin+'/?verify='+version});
  await poll(()=>evaluate("document.querySelector('#model-status')?.textContent.includes('自動配置済み') && !document.querySelector('#export')?.disabled"),'3D model initialized',45000);
  if(!publicSite)assert.deepEqual(assetRequests.slice(3).sort(),['corner','edge','center','v2/corner','v2/edge','v2/center','v3/corner','v3/edge','v3/center'].map(type=>`/assets/${type}.stl?v=${version}`).sort(),'current app must bypass the warmed legacy model cache');
  async function verifyReadableText(){
    const small=await evaluate("[...document.querySelectorAll('body *')].filter(el=>el.childElementCount===0&&el.textContent.trim()&&el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&!(el instanceof SVGElement)&&getComputedStyle(el).visibility!=='hidden').map(el=>({text:el.textContent.slice(0,60),size:parseFloat(getComputedStyle(el).fontSize)})).filter(item=>item.size<14)");
    assert.deepEqual(small,[],'visible text should be at least 14px');
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true,'no horizontal page overflow');
  }
  await verifyReadableText();
  const initial=await evaluate("({rows:document.querySelector('#rows').value,cols:document.querySelector('#cols').value,preset:document.querySelector('[data-size].active')?.dataset.size,closed:[...document.querySelectorAll('.collapsible-section')].every(x=>!x.open)})");
  assert.deepEqual(initial,{rows:'2',cols:'4',preset:'2,4',closed:true});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#parts-details')).display"),'none');
  await evaluate("document.querySelector('#parts-toggle').click()");
  assert.equal(await evaluate("document.querySelector('#parts-toggle').getAttribute('aria-expanded')"),'true');
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#parts-details')).display"),'none');
  await evaluate("document.querySelector('#parts-toggle').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#parts-details')).display"),'none');
  assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.step-heading')).fontSize)>=20 && document.querySelector('#export').getBoundingClientRect().height>=58"));
  assert.equal(await evaluate("document.querySelector('#model-version').value"),'v4');
  assert.equal(await evaluate("document.querySelector('#relief-toggle').checked"),true);
  assert.equal(await evaluate("document.querySelector('#other-formats').open"),false);
  assert.equal(await evaluate("(()=>{const title=document.querySelector('.inspector .step-heading').getBoundingClientRect(),unit=document.querySelector('.inspector .unit-tag').getBoundingClientRect();return unit.top>=title.bottom || unit.left>=title.right+4;})()"),true,'desktop heading and unit must be separated');
  await evaluate("localStorage.setItem('tileform.settings.v1',JSON.stringify({version:1,settings:{modelVersion:'v3',rows:2,cols:4}}))");
  await reloadReady('legacy v3 automatically upgrades to v4');
  assert.equal(await evaluate("document.querySelector('#model-version').value"),'v4');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#model-version option')].map(el=>el.value)"),['v4','v3.2','v2']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.part-source')].map(el=>el.textContent)"),['角v4.stl','端v4.stl','中v4.stl']);
  await evaluate("document.querySelector('#model-version').value='v3.2';document.querySelector('#model-version').dispatchEvent(new Event('change'))");
  await reloadReady('explicit v3.2 selection persists after upgrade');
  assert.equal(await evaluate("document.querySelector('#model-version').value"),'v3.2');
  await evaluate("document.querySelector('#model-version').value='v4';document.querySelector('#model-version').dispatchEvent(new Event('change'))");
  // The v3 clearance must increase capacity exactly at a physical-size boundary.
  await evaluate("for(const [id,value] of [['plate-width','31.8'],['plate-depth','47.8']]){const el=document.querySelector('#'+id);el.value=value;el.dispatchEvent(new Event('input'));}document.querySelector('#plate-max').click()");
  assert.deepEqual(await evaluate("[document.querySelector('#rows').value,document.querySelector('#cols').value]"),['6','4']);
  assert.ok((await evaluate("document.querySelector('#plate-capacity').textContent")).includes('31.2 × 47.2'));
  await evaluate("document.querySelector('#model-version').value='v2';document.querySelector('#model-version').dispatchEvent(new Event('change'));document.querySelector('#plate-max').click()");
  assert.deepEqual(await evaluate("[document.querySelector('#rows').value,document.querySelector('#cols').value]"),['5','3']);
  await evaluate("document.querySelector('#settings-reset').click()");
  await evaluate("document.querySelector('#plate-preset').value='custom';document.querySelector('#plate-preset').dispatchEvent(new Event('change'))");
  await reloadReady('custom printer selection saved');
  assert.equal(await evaluate("document.querySelector('#plate-preset').value"),'custom');
  await evaluate("document.querySelector('[data-size=\"4,6\"]').click()");
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_4×6');
  // Raycast the actual rendered meshes, including their Three.js transforms.
  // This catches preview-only rotation errors and mismatched cached source models.
  const orientation=await evaluate(`(async()=>{
    const {Raycaster,Vector3}=await import('./vendor/three.js');
    const scene=window.__tileformScenes.find(scene=>scene.children.some(group=>group.children.some(mesh=>mesh.userData.type)));
    if(!scene)return {ok:false,reason:'Missing preview scene'};
    scene.updateMatrixWorld(true);
    const parts=scene.children.flatMap(group=>group.children.filter(mesh=>mesh.userData.type));
    const ray=new Raycaster(),rows=4,cols=6;
    function height(mesh,x,y){ray.set(new Vector3(mesh.position.x+x,mesh.position.y+y,10),new Vector3(0,0,-1));return ray.intersectObject(mesh,false)[0]?.point.z;}
    for(const mesh of parts){
      const c=Math.round(mesh.position.x/8+(cols-1)/2),r=Math.round((rows-1)/2-mesh.position.y/8);
      for(const [nx,ny,outer] of [[-1,0,c===0],[1,0,c===cols-1],[0,1,r===0],[0,-1,r===rows-1]]){
        if(outer&&![-3.5,-2,0,2,3.5].every(t=>height(mesh,nx?nx*3.5:t,ny?ny*3.5:t)>2.5))return {ok:false,reason:'Broken exterior wall',r,c};
      }
      for(const dx of [-1,1])for(const dy of [-1,1]){
        if((dx===-1&&c===0)||(dx===1&&c===cols-1)||(dy===1&&r===0)||(dy===-1&&r===rows-1))continue;
        const z=height(mesh,dx*3.6,dy*3.6);
        if(!(z>=0.9&&z<1.1))return {ok:false,reason:'Mismatched inner recess',r,c,z};
      }
    }
    return {ok:true,parts:parts.length};
  })()`);
  assert.deepEqual(orientation,{ok:true,parts:24});
  await evaluate("{const el=document.querySelector('#rows');el.value='2.5';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.stepper button[data-axis=\"rows\"][data-delta=\"1\"]').click();}");
  assert.equal(await evaluate("document.querySelector('#rows').value"),'3');
  await evaluate("document.querySelector('[data-view=\"top\"]').click();document.querySelector('#fit').click()");
  assert.equal(await evaluate("document.querySelector('[data-view=\"top\"]').classList.contains('active')"),true);
  await evaluate("document.querySelector('#model-color-hex').closest('details').open=true;{const el=document.querySelector('#model-color-hex');el.value='#abc';el.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelector('#model-color').value"),'#aabbcc');
  assert.equal(await evaluate("document.querySelector('#model-color-hex').value"),'#abc');
  await evaluate("{const el=document.querySelector('#model-color-hex');el.value='#123456';el.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelector('#model-color').value"),'#123456');
  await evaluate("document.querySelector('[data-size=\"2,4\"]').click();document.querySelector('#export').click()");
  assert.equal(await evaluate("document.querySelector('#rows').disabled && document.querySelector('#cols').disabled"),true);
  await poll(()=>evaluate("document.querySelector('#export-status').textContent.includes('保存しました')"),'STL export finished',90000);
  assert.equal(await evaluate("!document.querySelector('#rows').disabled && !document.querySelector('#export').disabled"),true);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(300);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.studio')).order"),'-1');
  await evaluate("document.querySelector('#model-color-hex').closest('details').open=false");
  assert.equal(await evaluate("[...document.querySelectorAll('.collapsible-section')].every(x=>!x.open)"),true);
  // The maximum-size action follows the bed axes and obeys the application cap.
  await evaluate("document.querySelector('#plate-max').closest('details').open=true;document.querySelector('#plate-max').click()");
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_22×22');
  await evaluate("document.querySelector('#plate-preset').value='prusa-mk4s';document.querySelector('#plate-preset').dispatchEvent(new Event('change'));document.querySelector('#plate-max').click()");
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_26×31');
  await evaluate("{const el=document.querySelector('#plate-width');el.value='';el.dispatchEvent(new Event('input'));}");
  assert.equal(await evaluate("document.querySelector('#plate-max').disabled"),true);
  // Save a manageable model plus custom, decimal bed dimensions and color settings.
  await evaluate("document.querySelector('[data-size=\"4,6\"]').click();for(const [id,value] of [['plate-width','179.5'],['plate-depth','120']]){const el=document.querySelector('#'+id);el.value=value;el.dispatchEvent(new Event('input'));}document.querySelector('#color-toggle').checked=true;document.querySelector('#color-toggle').dispatchEvent(new Event('change'));");
  await reloadReady('restored settings');
  assert.deepEqual(await evaluate("({rows:document.querySelector('#rows').value,cols:document.querySelector('#cols').value,width:document.querySelector('#plate-width').value,depth:document.querySelector('#plate-depth').value,preset:document.querySelector('#plate-preset').value,color:document.querySelector('#model-color').value,parts:document.querySelector('#color-toggle').checked})"),{rows:'4',cols:'6',width:'179.5',depth:'120',preset:'custom',color:'#123456',parts:true});
  // A genuinely running large union can be terminated, without producing an STL.
  await evaluate("window.__lastExport=null;for(const id of ['rows','cols']){const el=document.querySelector('#'+id);el.value='32';el.dispatchEvent(new Event('input'));}document.querySelector('#export').click()");
  await poll(()=>evaluate("document.querySelector('#export-progressbar').value>=.45 && !document.querySelector('#export-cancel').hidden"),'union progress',60000);
  await evaluate("document.querySelector('#export-cancel').click()");
  await poll(()=>evaluate("document.querySelector('#export-status').textContent.includes('キャンセル') && !document.querySelector('#export').disabled"),'cancelled worker',5000);
  assert.equal(await evaluate("window.__lastExport==null && !document.querySelector('#rows').disabled && document.querySelector('#export-cancel').hidden"),true);
  await evaluate("document.querySelector('[data-size=\"2,4\"]').click();document.querySelector('#export').click()");
  await poll(()=>evaluate("document.querySelector('#export-status').textContent.includes('保存しました')"),'export after cancellation',90000);
  assert.equal(await evaluate("document.querySelector('#export-progressbar').value"),1);
  const output=await evaluate("(async()=>{const buffer=await window.__lastExport.arrayBuffer(),view=new DataView(buffer),n=view.getUint32(80,true),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<n;i++)for(let j=0;j<9;j++){const x=view.getFloat32(84+i*50+12+j*4,true),axis=j%3;min[axis]=Math.min(min[axis],x);max[axis]=Math.max(max[axis],x);}return {valid:buffer.byteLength===84+50*n,n,size:max.map((v,i)=>Math.round((v-min[i])*100)/100)};})()");
  assert.ok(output.valid&&output.n>0);assert.deepEqual(output.size,[31.2,15.2,3.12]);
  assert.equal(await evaluate("window.__lastFilename"),'tileform_v4_2x4.stl');
  await evaluate("document.querySelector('#other-formats').open=true");
  for(const format of ['obj','glb']){
    await evaluate(`window.__lastModelBlob=null;document.querySelector('[data-export-format="${format}"]').click()`);
    await poll(()=>evaluate("window.__lastModelBlob!=null && !document.querySelector('#export').disabled"),'export '+format,90000);
    assert.equal(await evaluate("window.__lastFilename"),'tileform_v4_2x4.'+format);
    const exported=await evaluate("(async()=>{const b=window.__lastModelBlob;return {type:b.type,size:b.size,head:[...new Uint8Array(await b.slice(0,4).arrayBuffer())],text:b.type==='text/plain'?(await b.text()).slice(0,100):''};})()");
    assert.ok(exported.size>1000);
    if(format==='glb'){assert.equal(exported.type,'model/gltf-binary');assert.deepEqual(exported.head,[103,108,84,70]);}
    else {assert.equal(exported.type,'text/plain');assert.ok(exported.text.includes('units: millimeters'));}
  }
  await evaluate("document.querySelector('#other-formats').open=false");
  const reliefHash=await evaluate("(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__lastExport.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join(''))()");
  await evaluate("document.querySelector('#relief-toggle').checked=false;document.querySelector('#relief-toggle').dispatchEvent(new Event('change'))");
  await reloadReady('relief preference restored');
  assert.equal(await evaluate("document.querySelector('#relief-toggle').checked"),false);
  await poll(()=>evaluate("Boolean(window.__tileformScene)"),'relief preview frame');
  assert.equal(await evaluate("window.__tileformScene.children.flatMap(g=>g.children.filter(m=>m.userData.type)).every(m=>m.material.vertexColors===false)"),true);
  await evaluate("window.__lastExport=null;document.querySelector('#export').click()");
  await poll(()=>evaluate("window.__lastExport!=null && !document.querySelector('#export').disabled"),'export without relief',90000);
  assert.equal(await evaluate("(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__lastExport.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join(''))()"),reliefHash,'relief shading must not change exported STL bytes');

  await evaluate("document.querySelector('#model-version').value='v2';document.querySelector('#model-version').dispatchEvent(new Event('change'))");
  assert.ok((await evaluate("document.querySelector('#size-mm').textContent")).includes('32 mm'));
  await reloadReady('restored v2 model');
  assert.equal(await evaluate("document.querySelector('#model-version').value"),'v2');
  await evaluate("window.__lastExport=null;document.querySelector('#export').click()");
  await poll(()=>evaluate("window.__lastExport!=null && !document.querySelector('#export').disabled"),'v2 STL export',90000);
  const alternateOutput=await evaluate("(async()=>{const buffer=await window.__lastExport.arrayBuffer(),view=new DataView(buffer),n=view.getUint32(80,true),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<n;i++)for(let j=0;j<9;j++){const x=view.getFloat32(84+i*50+12+j*4,true),axis=j%3;min[axis]=Math.min(min[axis],x);max[axis]=Math.max(max[axis],x);}return {valid:buffer.byteLength===84+50*n,n,size:max.map((v,i)=>Math.round((v-min[i])*100)/100)};})()");
  assert.equal(await evaluate("window.__lastFilename"),'tileform_v2_2x4.stl');
  assert.ok(alternateOutput.valid);assert.deepEqual(alternateOutput.size,[32,16,3.12]);

  await evaluate("{const el=document.querySelector('#explode-toggle');el.checked=true;el.dispatchEvent(new Event('change'));}document.querySelector('[data-view=\"bottom\"]').click();document.querySelector('#settings-reset').click()");
  assert.equal(await evaluate("document.querySelector('#explode-toggle').checked"),false);
  assert.equal(await evaluate("document.querySelector('#model-version').value"),'v4');
  assert.equal(await evaluate("document.querySelector('[data-view].active').dataset.view"),'iso');

  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_2×4');
  assert.equal(await evaluate("document.querySelector('#plate-preset').value"),'a1-mini');
  assert.equal(await evaluate("document.querySelector('#model-color').value"),'#adb4bc');
  await verifyReadableText();
  // Check actual on-screen sprite bounds for narrow viewports and wide models.
  await evaluate("for(const [id,value] of [['rows','2'],['cols','32']]){const el=document.querySelector('#'+id);el.value=value;el.dispatchEvent(new Event('input'));}");
  for(const width of [320,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await verifyReadableText();
  for(const view of ['top','bottom','iso']){
    await evaluate(`document.querySelector('[data-view="${view}"]').click();document.querySelector('#fit').click()`);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const fitted=await evaluate(`(async()=>{
      const {Box3,Vector3}=await import('./vendor/three.js'),camera=window.__tileformCamera,wrap=document.querySelector('#canvas-wrap'),rect=wrap.getBoundingClientRect();
      const group=window.__tileformScene.children.find(g=>g.children.some(m=>m.userData.type)),box=new Box3().setFromObject(group),points=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new Vector3(x,y,z).project(camera);points.push([(p.x+1)*rect.width/2,(1-p.y)*rect.height/2]);}
      const tools=document.querySelector('.viewport-tools').getBoundingClientRect();
      return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1])),w:rect.width,h:rect.height,tools:{left:tools.left-rect.left,right:tools.right-rect.left,top:tools.top-rect.top,bottom:tools.bottom-rect.top}};
    })()`);
    assert.ok(fitted.left>=0&&fitted.right<=fitted.w&&fitted.top>=0&&fitted.bottom<=fitted.h,view+': model must fit');
    assert.ok(Math.max((fitted.right-fitted.left)/fitted.w,(fitted.bottom-fitted.top)/fitted.h)>.35,view+': tile must be large enough to inspect');
    const overlapW=Math.min(fitted.right,fitted.tools.right)-Math.max(fitted.left,fitted.tools.left),overlapH=Math.min(fitted.bottom,fitted.tools.bottom)-Math.max(fitted.top,fitted.tools.top);
    assert.ok(overlapW<=0||overlapH<=0,view+': controls must not cover fitted tile');
    await evaluate("for(let i=0;i<4;i++)document.querySelector('#zoom-in').click()");;
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const bounds=await evaluate(`(()=>{
      const camera=window.__tileformCamera,wrap=document.querySelector('#canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;
      return window.__tileformScene.children.flatMap(group=>group.children.filter(mesh=>mesh.isSprite)).map(sprite=>{
        const position=sprite.position.clone().project(camera),width=sprite.scale.x/(camera.right-camera.left)*w*camera.zoom,height=sprite.scale.y/(camera.top-camera.bottom)*h*camera.zoom;
        return {left:(position.x+1)*w/2-width/2,right:(position.x+1)*w/2+width/2,top:(1-position.y)*h/2-height/2,bottom:(1-position.y)*h/2+height/2,w,h};
      });
    })()`);
    assert.equal(bounds.length,2);
    for(const box of bounds)assert.ok(box.left>=-0.1&&box.right<=box.w+.1&&box.top>=-.1&&box.bottom<=box.h+.1,`${view}: cropped label ${JSON.stringify(box)}`);
  }
  }
  await evaluate("localStorage.setItem('tileform.settings.v1','broken JSON')");
  await reloadReady('corrupt settings fallback');
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_2×4');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}});"});
  await reloadReady('disabled storage fallback');
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_2×4');
  assert.equal(await evaluate("document.querySelector('.settings-storage #settings-note')===null && document.querySelector('#help #settings-note')!==null"),true);
  await evaluate("document.querySelector('#help-open').click()");
  assert.equal(await evaluate("document.querySelector('#help section:last-child a').getAttribute('href')"),'./changelog.html');
  for(const width of [320,390,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<760});
    await verifyReadableText();
    assert.equal(await evaluate("document.querySelector('#help').scrollWidth<=document.querySelector('#help').clientWidth+1"),true,'help text must fit');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#help .keep-text')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent)"),[],'semantic phrases must fit');
  }
  const beforeHistory=await evaluate("({url:location.href,name:document.querySelector('#project-name').textContent,scroll:document.querySelector('#help').scrollTop})");
  await evaluate("document.querySelector('.help-history a').click()");
  await poll(()=>evaluate("document.querySelector('#history-dialog').open && document.querySelectorAll('#history-dialog .release').length===16"),'history popup');
  assert.equal(await evaluate("document.querySelector('#help').open"),false);
  assert.equal(await evaluate("location.href"),beforeHistory.url);
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),beforeHistory.name);
  for(const width of [320,390,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<760});
    await verifyReadableText();
    assert.equal(await evaluate("document.querySelector('#history-dialog').scrollWidth<=document.querySelector('#history-dialog').clientWidth+1"),true);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#history-dialog time')].filter(el=>el.getClientRects().length!==1||el.scrollWidth>el.clientWidth+1).map(el=>el.textContent)"),[],'dates must stay together');
  }
  await evaluate("document.querySelector('#history-close').click()");
  await poll(()=>evaluate("document.querySelector('#help').open && !document.querySelector('#history-dialog').open"),'return to help');
  assert.equal(await evaluate("document.activeElement===document.querySelector('.help-history a')"),true);
  await evaluate("document.querySelector('.help-history a').click()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await poll(()=>evaluate("document.querySelector('#help').open && !document.querySelector('#history-dialog').open"),'escape returns to help');
  await send('Page.navigate',{url:origin+'/changelog.html'});
  await poll(()=>evaluate("document.querySelectorAll('.release').length===16"),'release history');
  assert.equal(await evaluate("document.querySelector('.release-version').textContent"),'v'+version);
  assert.equal(await evaluate("[...document.querySelectorAll('time')].every(t=>!Number.isNaN(Date.parse(t.dateTime))&&/\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}/.test(t.textContent))"),true);
  for(const width of [320,390,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<760});
    await verifyReadableText();
  }
  assert.equal(await evaluate("document.querySelectorAll('#upcoming li').length"),6);
  assert.equal(await evaluate("document.querySelector('.back-link').getAttribute('href')"),'./');
  console.log('Browser smoke checks passed (desktop and mobile): asset version consistency, preview orientation, startup, presets, maximum size, persisted custom selection, full reset, visible mobile labels, unavailable storage, progress, cancellation and restart, binary STL export');
}catch(error){
  console.error('Browser test failed:',error?.stack||error);
  if(inspectPage){
    try{
      const status=await inspectPage("({url:location.href,ready:document.readyState,loading:document.querySelector('#loading')?.textContent,modelStatus:document.querySelector('#model-status')?.textContent,exportDisabled:document.querySelector('#export')?.disabled})");
      console.error('Page state:',JSON.stringify(status));
    }catch(e){console.error('Unable to inspect page:',e.message);}
  }
  console.error('Chrome diagnostics:',chromeErrors.slice(-3000));
  throw error;
}finally{
  ws?.close();browser.kill('SIGKILL');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  try{rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:300});}
  catch(e){console.warn('Browser temp cleanup deferred:',e.message);}
}

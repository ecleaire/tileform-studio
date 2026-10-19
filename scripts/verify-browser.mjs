import assert from 'node:assert/strict';
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
  const model=/\/assets\/(corner|edge|center)\.stl$/.test(url.pathname);
  const body=model&&!url.search?Buffer.from('stale-model:'+url.pathname):readFileSync(path);
  if(model)assetRequests.push(url.pathname+url.search);
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':model?'public, max-age=31536000':'no-cache'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
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
  await poll(async()=>(await fetch(origin+'/')).ok,'local server');
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
  inspectPage=evaluate;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__tileformScenes=[];window.__THREE_DEVTOOLS__=new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe',event=>{if(event.detail.isScene)window.__tileformScenes.push(event.detail);});
  `});
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate',{url:origin+'/warmup.html'});
  await poll(()=>evaluate("document.title==='Cache warmup'"),'cache warmup page');
  assert.equal(await evaluate("(async()=>{const urls=['corner','edge','center'].map(type=>'/assets/'+type+'.stl');for(const url of urls){const stale=await (await fetch(url)).text();if(!stale.startsWith('stale-model:'))return false;}return true;})()"),true);
  assert.equal(assetRequests.length,3);
  // These repeat requests must hit the browser's cache, proving the fixture is warm.
  await evaluate("Promise.all(['corner','edge','center'].map(type=>fetch('/assets/'+type+'.stl').then(r=>r.text())))");
  assert.equal(assetRequests.length,3,'legacy models should remain in browser HTTP cache');
  await send('Page.navigate',{url:origin+'/'});
  await poll(()=>evaluate("document.querySelector('#model-status')?.textContent.includes('自動配置済み') && !document.querySelector('#export')?.disabled"),'3D model initialized',45000);
  assert.deepEqual(assetRequests.slice(3).sort(),['corner','edge','center'].map(type=>`/assets/${type}.stl?v=${version}`).sort(),'current app must bypass the warmed legacy model cache');
  const initial=await evaluate("({rows:document.querySelector('#rows').value,cols:document.querySelector('#cols').value,preset:document.querySelector('[data-size].active')?.dataset.size,closed:[...document.querySelectorAll('.collapsible-section')].every(x=>!x.open)})");
  assert.deepEqual(initial,{rows:'2',cols:'4',preset:'2,4',closed:true});
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
        if(outer&&![-3.5,-2,0,2,3.5].every(t=>height(mesh,nx?nx*3.9:t,ny?ny*3.9:t)>2.5))return {ok:false,reason:'Broken exterior wall',r,c};
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
  await evaluate("document.querySelectorAll('.collapsible-section')[1].open=true;{const el=document.querySelector('#model-color-hex');el.value='#abc';el.dispatchEvent(new Event('input',{bubbles:true}));}");
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
  await evaluate("document.querySelectorAll('.collapsible-section')[1].open=false");
  assert.equal(await evaluate("[...document.querySelectorAll('.collapsible-section')].every(x=>!x.open)"),true);
  console.log('Browser smoke checks passed (desktop and mobile): legacy STL cache replacement, preview wall/recess orientation, startup, presets, stepper, view, HEX, STL export');
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

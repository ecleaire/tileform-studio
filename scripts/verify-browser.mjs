import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:'ignore'});
const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader',
  '--remote-allow-origins=*','--remote-debugging-port='+port,
  '--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});
let ws;
async function poll(check,title,timeout=30000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{const result=await check();if(result)return result;}catch{}
    await delay(200);
  }
  throw Error('Timed out waiting for '+title);
}
try{
  await poll(async()=>(await fetch('http://127.0.0.1:4173/')).ok,'local server');
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
  const evaluate=async expression=>{
    const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);
    return reply.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:4173/'});
  await poll(()=>evaluate("document.querySelector('#model-status')?.textContent.includes('自動配置済み') && !document.querySelector('#export')?.disabled"),'3D model initialized',45000);
  const initial=await evaluate("({rows:document.querySelector('#rows').value,cols:document.querySelector('#cols').value,preset:document.querySelector('[data-size].active')?.dataset.size,closed:[...document.querySelectorAll('.collapsible-section')].every(x=>!x.open)})");
  assert.deepEqual(initial,{rows:'2',cols:'4',preset:'2,4',closed:true});
  await evaluate("document.querySelector('[data-size=\"4,6\"]').click()");
  assert.equal(await evaluate("document.querySelector('#project-name').textContent"),'Tile_4×6');
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
  console.log('Browser smoke checks passed (desktop and mobile): startup, presets, stepper, view, HEX, STL export');
}finally{
  ws?.close();browser.kill('SIGKILL');server.kill('SIGKILL');
  rmSync(dir,{recursive:true,force:true});
}

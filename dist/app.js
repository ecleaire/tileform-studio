import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {placements,parseSTL,PITCH,HEIGHT,stepSize,maxTileSize} from './core.js?v=1.2.0';
import {DEFAULT_SETTINGS,SETTINGS_KEY,readSettings,writeSettings} from './settings.js?v=1.2.0';
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
let restored;try{restored=readSettings(localStorage);}catch{restored={...DEFAULT_SETTINGS};}
const state={...restored,explode:false,view:'iso'},sources={},geometries={},materials={},meshes=[];
const platePresets=[
  ['a1-mini','Bambu Lab A1 mini',180,180],
  ['bambu-256','Bambu Lab A1 / P1S / X1C',256,256],
  ['prusa-mk4s','Original Prusa MK4S',250,210],
  ['prusa-mini','Original Prusa MINI+',180,180],
  ['ender-3-v3-se','Creality Ender-3 V3 SE',220,220],
  ['creality-k1','Creality K1',220,220],
  ['neptune-4','ELEGOO Neptune 4',225,225]
];
const colors={corner:0xe5bc5d,edge:0xacc1ae,center:0xd78d6b};
let scene,camera,renderer,controls,group,dimensions,plate,zoomSpan=40,activeExport,loaded=false,busy=false;
function saveSettings(){
  let saved=false;try{saved=writeSettings(localStorage,state);}catch{}
  $('#settings-note').textContent=saved?'サイズ・色・プリンター設定は、このブラウザに自動保存します。':'このブラウザでは設定を保存できません。現在の設定はこの画面で使えます。';
}
function lighting(s){s.add(new THREE.AmbientLight(0xffffff,1.3));const a=new THREE.DirectionalLight(0xffffff,3);a.position.set(-20,-30,65);s.add(a);const b=new THREE.DirectionalLight(0xffffff,1);b.position.set(35,20,15);s.add(b);}
function init(){
  const wrap=$('#canvas-wrap');renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;wrap.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','自動配置されたタイルの3Dモデル');renderer.domElement.setAttribute('role','img');
  scene=new THREE.Scene();lighting(scene);camera=new THREE.OrthographicCamera(-40,40,40,-40,.1,10000);camera.up.set(0,0,1);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.screenSpacePanning=true;controls.addEventListener('change',updateLabelScales);controls.minZoom=.2;controls.maxZoom=10;controls.target.set(0,0,1);
  group=new THREE.Group();scene.add(group);dimensions=new THREE.Group();scene.add(dimensions);
  plate=new THREE.Group();scene.add(plate);updatePlate();
  new ResizeObserver(()=>resize()).observe(wrap);resize();setView('iso');
  renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
}
function updateLabelScales(){
  if(!camera||!dimensions)return;
  const height=$('#canvas-wrap').clientHeight;
  if(!height)return;
  const unit=2*zoomSpan/(height*camera.zoom),width=140*unit,labelHeight=24*unit;
  for(const sprite of dimensions.children.filter(c=>c.isSprite)){
    sprite.scale.set(width,labelHeight,1);
    sprite.position.copy(sprite.userData.anchor);
    if(sprite.userData.side==='right')sprite.position.x+=width/2;
    else sprite.position.y-=labelHeight/2;
  }
}
function resize(){if(!renderer)return;const wrap=$('#canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.left=-zoomSpan*w/h;camera.right=zoomSpan*w/h;camera.top=zoomSpan;camera.bottom=-zoomSpan;camera.updateProjectionMatrix();updateLabelScales();}
function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const dist=1800;if(view==='top'){camera.position.set(0,-.001,dist);camera.up.set(0,1,0);}else if(view==='bottom'){camera.position.set(0,.001,-dist);camera.up.set(0,1,0);}else{camera.position.set(1000,-1400,1650);camera.up.set(0,0,1);}controls.target.set(0,0,1);camera.lookAt(controls.target);controls.update();}
function fit(){
  const pitch=state.explode?10.4:PITCH,tileW=state.cols*pitch,tileH=state.rows*pitch;
  // Keep the tile clearly visible while retaining some context from the print bed.
  const w=Math.max(tileW,Math.min(state.plateWidth,tileW*1.8));
  const h=Math.max(tileH,Math.min(state.plateDepth,tileH*1.8));
  const radius=Math.hypot(w,h)/2+10,wrap=$('#canvas-wrap');
  zoomSpan=Math.max(radius,radius*wrap.clientHeight/wrap.clientWidth);camera.zoom=1;resize();controls.target.set(0,0,1);controls.update();
}
function clear(g){while(g.children.length){const c=g.children[0];g.remove(c);if(c.userData.owned){c.geometry?.dispose();c.material?.map?.dispose();c.material?.dispose();}}}
function label(text,position,side){const c=document.createElement('canvas');c.width=512;c.height=88;const x=c.getContext('2d');x.font='500 42px "Space Grotesk", sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillStyle='#f4f6ee';x.fillRect(0,13,512,62);x.fillStyle='#859375';x.fillText(text,256,46,492);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true,toneMapped:false}));s.position.copy(position);const labelWidth=Math.max(24,Math.max(state.plateWidth,state.plateDepth)*.18);s.scale.set(labelWidth,labelWidth*88/512,1);s.userData.owned=true;s.userData.anchor=position.clone();s.userData.side=side;dimensions.add(s);updateLabelScales();}
function dimensionLines(){clear(dimensions);const w=state.cols*8,h=state.rows*8,pts=[];const add=(a,b)=>pts.push(...a,...b);const gap=state.explode?3:0,x=w/2+7+state.cols*gap/2,y=-h/2-7-state.rows*gap/2;
  add([-w/2,y,0],[w/2,y,0]);add([-w/2,y-1,0],[-w/2,y+1,0]);add([w/2,y-1,0],[w/2,y+1,0]);add([x,-h/2,0],[x,h/2,0]);add([x-1,-h/2,0],[x+1,-h/2,0]);add([x-1,h/2,0],[x+1,h/2,0]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));const l=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xa7b29b,transparent:true,opacity:.8}));l.userData.owned=true;dimensions.add(l);label(`${state.cols}マス, ${w} mm`,new THREE.Vector3(0,y,0));label(`${state.rows}マス, ${h} mm`,new THREE.Vector3(x+3,0,0),'right');}
function assemble(){
  clear(group);meshes.length=0;const parts=placements(state.rows,state.cols),gap=state.explode?2.4:0;
  for(const p of parts){const m=new THREE.Mesh(geometries[p.type],state.color?materials[p.type]:materials.single);m.rotation.z=p.q*Math.PI/2;m.position.set((p.c-(state.cols-1)/2)*(8+gap),((state.rows-1)/2-p.r)*(8+gap),0);m.userData.type=p.type;group.add(m);meshes.push(m);}
  dimensionLines();$('#project-name').textContent=`Tile_${state.rows}×${state.cols}`;$('#size-mm').innerHTML=`<span>横 ${state.cols}マス, ${state.cols*PITCH} mm</span><span>縦 ${state.rows}マス, ${state.rows*PITCH} mm</span>`;$('#size-note').textContent=`横 × 縦 · 厚さ ${state.rows>2&&state.cols>2?'3.15':'3.12'} mm`;$('#total').textContent=parts.length;for(const type of ['corner','edge','center'])$(`#count-${type}`).textContent=parts.filter(p=>p.type===type).length;$('#model-status').textContent=`${state.rows} × ${state.cols} · 自動配置済み`;
  updatePlateStatus();
  $$('[data-size]').forEach(b=>b.classList.toggle('active',b.dataset.size===`${state.rows},${state.cols}`));
}
function thumb(type){const el=$(`#thumb-${type}`),r=new THREE.WebGLRenderer({antialias:true,alpha:true});r.setSize(el.clientWidth||60,el.clientHeight||65);r.setPixelRatio(Math.min(devicePixelRatio,2));r.setClearColor(0,0);r.toneMapping=THREE.ACESFilmicToneMapping;const s=new THREE.Scene();lighting(s);const c=new THREE.OrthographicCamera(-6.5,6.5,7,-7,.1,100);c.up.set(0,0,1);c.position.set(12,-17,25);c.lookAt(0,0,1);const m=new THREE.Mesh(geometries[type],materials[type]);s.add(m);r.render(s,c);const img=document.createElement('img');img.src=r.domElement.toDataURL();img.alt=`${{corner:'角',edge:'端',center:'中'}[type]}パーツの形状`;img.style.cssText='width:100%;height:100%;object-fit:contain';el.append(img);r.dispose();}
function updatePlateStatus(){
  const cols=Math.floor(state.plateWidth/PITCH),rows=Math.floor(state.plateDepth/PITCH);
  $('#plate-capacity').textContent=`${cols} × ${rows}マス / ${cols*PITCH} × ${rows*PITCH} mm`;
  const outside=state.cols*PITCH>state.plateWidth||state.rows*PITCH>state.plateDepth;
  $('#plate-status').textContent=outside?'タイルが造形範囲を超えています。サイズか造形範囲を見直してください。':'タイルは造形範囲内です。';
  $('#plate-status').classList.toggle('outside',outside);
}
function updatePlate(){
  clear(plate);
  const w=state.plateWidth,h=state.plateDepth,gw=Math.floor(w/PITCH)*PITCH,gh=Math.floor(h/PITCH)*PITCH;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:0xe0e7d6,transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false}));
  floor.position.z=-.18;floor.userData.owned=true;plate.add(floor);
  const points=[];
  for(let x=-gw/2;x<=gw/2;x+=PITCH)points.push(x,-gh/2,-.12,x,gh/2,-.12);
  for(let y=-gh/2;y<=gh/2;y+=PITCH)points.push(-gw/2,y,-.12,gw/2,y,-.12);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const grid=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xa9b79b,transparent:true,opacity:.55}));grid.userData.owned=true;plate.add(grid);
  const outlineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w/2,-h/2,-.1),new THREE.Vector3(w/2,-h/2,-.1),new THREE.Vector3(w/2,h/2,-.1),new THREE.Vector3(-w/2,h/2,-.1)]);
  const outline=new THREE.LineLoop(outlineGeometry,new THREE.LineBasicMaterial({color:0x718564}));outline.userData.owned=true;plate.add(outline);
  updatePlateStatus();
}
function applyPlateInput(){
  const width=Number($('#plate-width').value),depth=Number($('#plate-depth').value);
  if(![width,depth].every(n=>Number.isFinite(n)&&n>=16&&n<=1000)){
    $('#plate-error').textContent='横・縦は16〜1000 mmで入力してください。床は直前の有効なサイズを表示しています。';$('#plate-max').disabled=true;return;
  }
  $('#plate-error').textContent='';$('#plate-max').disabled=busy;state.plateWidth=width;state.plateDepth=depth;state.platePreset=$('#plate-preset').value;saveSettings();
  if(plate){updatePlate();if(loaded){dimensionLines();fit();}}
}
for(const [value,name,width,depth] of platePresets){const option=document.createElement('option');option.value=value;option.textContent=`${name} — ${width} × ${depth} mm`;$('#plate-preset').append(option);}
const customOption=document.createElement('option');customOption.value='custom';customOption.textContent='カスタム（mmで手動設定）';$('#plate-preset').append(customOption);
const restoredPreset=platePresets.find(p=>p[0]===state.platePreset&&p[2]===state.plateWidth&&p[3]===state.plateDepth);
state.platePreset=restoredPreset?restoredPreset[0]:'custom';
$('#plate-preset').value=state.platePreset;$('#plate-width').value=state.plateWidth;$('#plate-depth').value=state.plateDepth;
$('#rows').value=state.rows;$('#cols').value=state.cols;$('#color-toggle').checked=state.color;
$('#plate-max').onclick=()=>{
  if(busy||!loaded)return;
  try{const size=maxTileSize(Number($('#plate-width').value),Number($('#plate-depth').value));$('#rows').value=size.rows;$('#cols').value=size.cols;applyInput();}catch(error){$('#plate-error').textContent=error.message;}
};
$('#plate-preset').onchange=e=>{const preset=platePresets.find(p=>p[0]===e.target.value);if(preset){$('#plate-width').value=preset[2];$('#plate-depth').value=preset[3];applyPlateInput();}};
$$('#plate-width,#plate-depth').forEach(input=>input.addEventListener('input',()=>{$('#plate-preset').value='custom';applyPlateInput();}));
function applyInput(){const rows=Number($('#rows').value),cols=Number($('#cols').value);try{placements(rows,cols);$('#input-error').textContent='';state.rows=rows;state.cols=cols;saveSettings();if(loaded){assemble();fit();}$('#export').disabled=!loaded||busy;}catch(e){$('#input-error').textContent=e.message;$('#export').disabled=true;}}
function setSizeInputLocked(locked){$$('#rows,#cols,.stepper button,[data-size],#plate-max,#settings-reset').forEach(el=>{el.disabled=locked;});$('#plate-max').disabled=locked||Boolean($('#plate-error').textContent);}
function showExportProgress(progress){
  const value=Math.max(0,Math.min(1,progress.value));
  $('#export-progressbar').value=value;$('#export-phase').textContent=`${progress.stage} · ${Math.round(value*100)}%`;
}
$('#export-cancel').onclick=()=>{const job=activeExport;if(!job)return;activeExport=null;job.worker?.terminate();job.reject?.(new DOMException('出力をキャンセルしました。','AbortError'));};
async function exportSTL(){
  if(busy||!loaded)return;
  busy=true;const rows=state.rows,cols=state.cols,job={worker:null,reject:null};activeExport=job;
  setSizeInputLocked(true);$('#export').disabled=true;$('#export span').textContent='一体化しています…';
  $('#export-progress').hidden=false;$('#export-cancel').hidden=false;showExportProgress({value:0,stage:'準備中'});$('#export-status').textContent='';
  try{
    const result=await new Promise((resolve,reject)=>{
      job.reject=reject;job.worker=new Worker(new URL('./export-worker.js?v=1.2.0',import.meta.url),{type:'module'});
      job.worker.onmessage=({data})=>{if(activeExport!==job)return;if(data.progress)showExportProgress(data.progress);if(data.error)reject(new Error(data.error));if(data.result)resolve(data.result);};
      job.worker.onerror=e=>reject(new Error(e.message||'出力処理を開始できませんでした。'));job.worker.postMessage({sources,rows,cols});
    });
    const blob=new Blob([result.buffer],{type:'model/stl'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`tileform_${rows}x${cols}_${cols*8}x${rows*8}mm.stl`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    showExportProgress({value:1,stage:'完了'});$('#export-status').textContent=`保存しました · ${result.triangles.toLocaleString()}面 · 単一ソリッド · ${(blob.size/1024).toFixed(0)} KB`;
  }catch(e){
    if(e.name==='AbortError'){$('#export-phase').textContent='キャンセルしました';$('#export-status').textContent='出力をキャンセルしました。サイズを変えて再実行できます。';}
    else{$('#export-phase').textContent='出力に失敗しました';$('#export-status').textContent=`出力できませんでした：${e.message}`;}
  }finally{
    job.worker?.terminate();if(activeExport===job)activeExport=null;busy=false;setSizeInputLocked(false);$('#export-cancel').hidden=true;$('#export span').textContent='STLをダウンロード';applyInput();
  }
}
$('#parts-toggle').onclick=()=>{const expanded=$('#parts-toggle').getAttribute('aria-expanded')!=='true';$('#parts-toggle').setAttribute('aria-expanded',String(expanded));$('#parts-details').classList.toggle('is-expanded',expanded);$('#parts-toggle').innerHTML=expanded?'パーツの内訳を閉じる<span aria-hidden="true">−</span>':'パーツの内訳を表示<span aria-hidden="true">＋</span>';};
$('#help-open').onclick=()=>$('#help').showModal();$('#help-close').onclick=()=>$('#help').close();$('#help').onclick=e=>{if(e.target===$('#help')){const b=$('#help').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('#help').close();}};
$$('.stepper button').forEach(b=>b.onclick=()=>{if(busy)return;const el=$(`#${b.dataset.axis}`);el.value=stepSize(el.value,Number(b.dataset.delta),state[b.dataset.axis]);applyInput();});$$('#rows,#cols').forEach(i=>i.addEventListener('input',applyInput));$$('[data-size]').forEach(b=>b.onclick=()=>{const [r,c]=b.dataset.size.split(',');$('#rows').value=r;$('#cols').value=c;applyInput();});
function setModelColor(hex,preserveHexInput=false){
  state.modelColor=hex.toLowerCase();
  $('#model-color').value=state.modelColor;if(!preserveHexInput)$('#model-color-hex').value=state.modelColor.toUpperCase();
  ['r','g','b'].forEach((channel,i)=>{$(`#color-${channel}`).value=parseInt(state.modelColor.slice(1+i*2,3+i*2),16);});
  $$('[data-color]').forEach(button=>{const active=button.dataset.color===state.modelColor;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  $('#color-error').textContent='';saveSettings();
  if(materials.single){materials.single.color.set(state.modelColor);if(!state.color)for(const mesh of meshes)mesh.material=materials.single;}
}
$('#model-color').addEventListener('input',e=>setModelColor(e.target.value));
function applyHexColor(e,finalize=false){
  let hex=e.target.value.trim().replace(/^#/,'');
  if(!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)){
    $('#color-error').textContent=finalize?'HEXは3桁または6桁の16進数で入力してください。':'';
    return;
  }
  if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');
  setModelColor('#'+hex,!finalize);
}
$('#model-color-hex').addEventListener('change',e=>applyHexColor(e,true));
$('#model-color-hex').addEventListener('input',e=>applyHexColor(e,false));
$$('.rgb-inputs input').forEach(input=>input.addEventListener('input',()=>{
  const values=['r','g','b'].map(channel=>$(`#color-${channel}`).value);
  if(!values.every(value=>value!==''&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=255)){$('#color-error').textContent='RGBはそれぞれ0〜255の整数で入力してください。';return;}
  setModelColor('#'+values.map(value=>Number(value).toString(16).padStart(2,'0')).join(''));
}));
$$('[data-color]').forEach(button=>button.onclick=()=>setModelColor(button.dataset.color));
setModelColor(state.modelColor);
$('#color-toggle').onchange=e=>{state.color=e.target.checked;saveSettings();for(const m of meshes)m.material=state.color?materials[m.userData.type]:materials.single;};$('#explode-toggle').onchange=e=>{state.explode=e.target.checked;if(loaded){assemble();fit();}};$$('[data-view]').forEach(b=>b.onclick=()=>{if(loaded)setView(b.dataset.view);});$('#fit').onclick=()=>{if(loaded)fit();};$('#zoom-in').onclick=()=>{if(camera){camera.zoom=Math.min(10,camera.zoom*1.2);camera.updateProjectionMatrix();updateLabelScales();}};$('#zoom-out').onclick=()=>{if(camera){camera.zoom=Math.max(.2,camera.zoom/1.2);camera.updateProjectionMatrix();updateLabelScales();}};$('#export').onclick=exportSTL;
$('#settings-reset').onclick=()=>{
  if(busy)return;Object.assign(state,DEFAULT_SETTINGS);
  $('#rows').value=state.rows;$('#cols').value=state.cols;$('#plate-width').value=state.plateWidth;$('#plate-depth').value=state.plateDepth;$('#plate-preset').value=state.platePreset;$('#color-toggle').checked=false;
  setModelColor(state.modelColor);applyPlateInput();applyInput();
  try{localStorage.removeItem(SETTINGS_KEY);}catch{}
};
try{
  init();await Promise.all(['corner','edge','center'].map(async type=>{const res=await fetch(`./assets/${type}.stl?v=1.2.0`);if(!res.ok)throw new Error('STLを読み込めませんでした。');sources[type]=parseSTL(await res.arrayBuffer());const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(sources[type].positions,3));g.computeVertexNormals();geometries[type]=g;materials[type]=new THREE.MeshStandardMaterial({color:colors[type],roughness:.7,metalness:0,flatShading:true,side:THREE.DoubleSide});}));materials.single=new THREE.MeshStandardMaterial({color:state.modelColor,roughness:.7,flatShading:true,side:THREE.DoubleSide});loaded=true;applyInput();for(const type of ['corner','edge','center'])thumb(type);$('#loading').remove();
}catch(e){$('#loading').textContent=`プレビューを開始できませんでした：${e.message}`;$('#model-status').textContent='読み込みエラー';console.error(e);}

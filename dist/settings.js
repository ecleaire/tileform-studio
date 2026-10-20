export const SETTINGS_KEY='tileform.settings.v1';
export const DEFAULT_SETTINGS=Object.freeze({rows:2,cols:4,color:false,modelColor:'#d3d5d8',plateWidth:180,plateDepth:180,platePreset:'a1-mini'});
export function readSettings(storage){
 try{
  const saved=JSON.parse(storage.getItem(SETTINGS_KEY));
  if(saved?.version!==1||!saved.settings||typeof saved.settings!=='object')return {...DEFAULT_SETTINGS};
  const input=saved.settings,result={...DEFAULT_SETTINGS};
  for(const key of ['rows','cols'])if(Number.isInteger(input[key])&&input[key]>=2&&input[key]<=32)result[key]=input[key];
  for(const key of ['plateWidth','plateDepth'])if(Number.isFinite(input[key])&&input[key]>=16&&input[key]<=1000)result[key]=input[key];
  if(typeof input.color==='boolean')result.color=input.color;
  if(typeof input.modelColor==='string'&&/^#[0-9a-f]{6}$/i.test(input.modelColor))result.modelColor=input.modelColor.toLowerCase();
  if(typeof input.platePreset==='string')result.platePreset=input.platePreset;
  return result;
 }catch{return {...DEFAULT_SETTINGS};}
}
export function writeSettings(storage,state){
 try{const settings=Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key=>[key,state[key]]));storage.setItem(SETTINGS_KEY,JSON.stringify({version:1,settings}));return true;}catch{return false;}
}

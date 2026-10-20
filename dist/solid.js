import Module from './vendor/manifold.js';
import {indexedMesh,placements,binarySTL,HEIGHT} from './core.js?v=1.2.1';
let ready;
export async function engine(){if(!ready)ready=Module().then(m=>{m.setup();return m});return ready;}
export async function unite(sources,rows,cols,onProgress=()=>{}){
  onProgress({value:0,stage:'計算エンジンを準備中'});
  const {Manifold,Mesh}=await engine(),base={},instances=[];
  onProgress({value:.05,stage:'パーツを読み込み中'});
  try{
    for(const [type,source] of Object.entries(sources)){const mesh=new Mesh(indexedMesh(source.positions));mesh.merge();base[type]=new Manifold(mesh);}
    const parts=placements(rows,cols);
    // A 0.002 mm overlap resolves line-only contacts from source mesh rounding.
    // Clip to the exact envelope so requested outer dimensions remain unchanged.
    for(let i=0;i<parts.length;i++){const p=parts[i],scaled=base[p.type].scale([1.00025,1.00025,1]),rot=scaled.rotate([0,0,p.q*90]);scaled.delete();const moved=rot.translate([p.x+4,p.y+4,0]);rot.delete();instances.push(moved);if(i%32===0||i===parts.length-1)onProgress({value:.1+.3*(i+1)/parts.length,stage:`パーツを配置中 (${i+1}/${parts.length})`});}
    // Leave clearance above the source meshes: only trim XY, avoiding near-coplanar Z cuts.
    onProgress({value:.45,stage:'接合面を結合中'});
    const union=Manifold.union(instances),envelope=Manifold.cube([cols*8,rows*8,Math.max(HEIGHT,...Object.values(sources).map(source=>source.size[2]))+1]),clipped=Manifold.intersection(union,envelope),result=clipped.setTolerance(.00001);union.delete();envelope.delete();clipped.delete();
    onProgress({value:.75,stage:'単一ソリッドを検証中'});
    try{const mesh=result.getMesh(),box=result.boundingBox(),components=result.decompose();const count=components.length;components.forEach(x=>x.delete());if(count!==1)throw new Error('一体化できませんでした。パーツの接続を確認してください。');const volume=result.volume();if(!(volume>0))throw new Error('有効な立体を生成できませんでした。');onProgress({value:.9,stage:'STLデータを作成中'});const buffer=binarySTL(mesh);onProgress({value:1,stage:'完了'});return {buffer,volume,triangles:new DataView(buffer).getUint32(80,true),box,components:count};}finally{result.delete();}
  }finally{instances.forEach(m=>m.delete());Object.values(base).forEach(m=>m.delete());}
}

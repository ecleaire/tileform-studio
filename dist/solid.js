import Module from './vendor/manifold.js';
import {indexedMesh,placements,binarySTL} from './core.js';
let ready;
export async function engine(){if(!ready)ready=Module().then(m=>{m.setup();return m});return ready;}
export async function unite(sources,rows,cols,onProgress=()=>{}){
  const {Manifold,Mesh}=await engine(),base={},instances=[];
  try{
    for(const [type,source] of Object.entries(sources)){const mesh=new Mesh(indexedMesh(source.positions));mesh.merge();base[type]=new Manifold(mesh);}
    const parts=placements(rows,cols);
    // A 0.002 mm overlap resolves line-only contacts from source mesh rounding.
    // Clip to the exact envelope so requested outer dimensions remain unchanged.
    for(let i=0;i<parts.length;i++){const p=parts[i],scaled=base[p.type].scale([1.00025,1.00025,1]),rot=scaled.rotate([0,0,p.q*90]);scaled.delete();const moved=rot.translate([p.x+4,p.y+4,0]);rot.delete();instances.push(moved);if(i%32===0)onProgress(i/parts.length);}
    const union=Manifold.union(instances),envelope=Manifold.cube([cols*8,rows*8,3.25]),clipped=Manifold.intersection(union,envelope),result=clipped.setTolerance(.00001);union.delete();envelope.delete();clipped.delete();
    try{const mesh=result.getMesh(),box=result.boundingBox(),components=result.decompose();const count=components.length;components.forEach(x=>x.delete());if(count!==1)throw new Error('一体化できませんでした。パーツの接続を確認してください。');const volume=result.volume();if(!(volume>0))throw new Error('有効な立体を生成できませんでした。');const buffer=binarySTL(mesh);onProgress(1);return {buffer,volume,triangles:mesh.triVerts.length/3,box,components:count};}finally{result.delete();}
  }finally{instances.forEach(m=>m.delete());Object.values(base).forEach(m=>m.delete());}
}

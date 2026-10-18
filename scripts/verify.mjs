import fs from 'node:fs';
import assert from 'node:assert/strict';
import {placements,parseSTL,indexedMesh} from '../dist/core.js';
import {unite} from '../dist/solid.js';
const sources={};
for(const t of ['corner','edge','center']){const b=fs.readFileSync(`dist/assets/${t}.stl`);sources[t]=parseSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.deepEqual(sources[t].size.map(v=>Math.round(v*100)/100),[8,8,t==='center'?3.15:3.12]);}
for(const [r,c] of [[2,2],[2,4],[4,3],[3,4],[6,6],[2,32],[32,2]]){
 const p=placements(r,c);assert.equal(p.length,r*c);assert.equal(p.filter(x=>x.type==='corner').length,4);assert.equal(p.filter(x=>x.type==='edge').length,2*(r-2)+2*(c-2));assert.equal(p.filter(x=>x.type==='center').length,(r-2)*(c-2));
 const start=performance.now();const out=await unite(sources,r,c);assert.equal(out.components,1);const b=new DataView(out.buffer);assert.equal(out.buffer.byteLength,84+50*b.getUint32(80,true));const stl=parseSTL(out.buffer);assert.deepEqual(stl.size.map(v=>Math.round(v*100)/100),[c*8,r*8,r>2&&c>2?3.15:3.12]);
 // Re-import the exported STL and check every topological edge occurs twice, in opposite directions.
 const m=indexedMesh(stl.positions),edges=new Map();for(let i=0;i<m.triVerts.length;i+=3)for(let j=0;j<3;j++){const a=m.triVerts[i+j],b=m.triVerts[i+(j+1)%3],key=Math.min(a,b)+','+Math.max(a,b);const e=edges.get(key)||{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(key,e);}const bad=[...edges.values()].filter(e=>e.n!==2||e.d!==0);assert.equal(bad.length,0,`${r}x${c}: STL is not watertight`);
 console.log(`${r}x${c}: ${out.triangles} triangles, single watertight solid, ${out.volume.toFixed(2)} mm³, ${Math.round(performance.now()-start)} ms`);
}
for(const [r,c] of [[1,4],[4,1],[0,0],[2.5,4],[33,4],[NaN,4]])assert.throws(()=>placements(r,c));
console.log('All geometry checks passed.');

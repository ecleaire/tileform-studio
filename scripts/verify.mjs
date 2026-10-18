import fs from 'node:fs';
import assert from 'node:assert/strict';
import {placements,parseSTL,indexedMesh} from '../dist/core.js';
import {unite} from '../dist/solid.js';
const sources={};
for(const t of ['corner','edge','center']){const b=fs.readFileSync(`dist/assets/${t}.stl`);sources[t]=parseSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.deepEqual(sources[t].size.map(v=>Math.round(v*100)/100),[8,8,t==='center'?3.15:3.12]);}
// Identify closed walls from the actual source geometry, independent of rotation rules.
const directions=[[1,0],[-1,0],[0,1],[0,-1]],closedWalls={};
for(const type of ['corner','edge']){
 const positions=sources[type].positions;
 const areas=directions.map(([nx,ny])=>{
  const axis=nx?0:1,bound=(nx||ny)*4;let area=0;
  for(let i=0;i<positions.length;i+=9){
   const a=Array.from(positions.subarray(i,i+3)),b=Array.from(positions.subarray(i+3,i+6)),c=Array.from(positions.subarray(i+6,i+9));
   if(![a,b,c].every(v=>Math.abs(v[axis]-bound)<1e-5))continue;
   const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
   area+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
  }
  return area;
 });
 const maximum=Math.max(...areas);closedWalls[type]=directions.filter((_,i)=>Math.abs(areas[i]-maximum)<1e-3);
 assert.equal(closedWalls[type].length,type==='corner'?2:1,`${type}: closed walls must be identifiable`);
}
for(const [r,c] of [[2,2],[2,4],[4,3],[3,4],[6,6],[2,32],[32,2]]){
 const p=placements(r,c);assert.equal(p.length,r*c);assert.equal(p.filter(x=>x.type==='corner').length,4);assert.equal(p.filter(x=>x.type==='edge').length,2*(r-2)+2*(c-2));assert.equal(p.filter(x=>x.type==='center').length,(r-2)*(c-2));
 // Original STL face directions must point toward neighboring tiles rather than outward.
 for(const part of p.filter(part=>part.type!=='center')){
  const expected=[];
  if(part.c===0)expected.push('1,0');if(part.c===c-1)expected.push('-1,0');
  if(part.r===0)expected.push('0,-1');if(part.r===r-1)expected.push('0,1');
  const angle=part.q*Math.PI/2;
  const actual=closedWalls[part.type].map(([x,y])=>`${Math.round(x*Math.cos(angle)-y*Math.sin(angle))||0},${Math.round(x*Math.sin(angle)+y*Math.cos(angle))||0}`);
  assert.deepEqual(actual.sort(),expected.sort(),`${r}x${c}: ${part.type} at row ${part.r}, column ${part.c} faces outward instead of toward the tile center`);
 }
 const start=performance.now();const out=await unite(sources,r,c);assert.equal(out.components,1);const b=new DataView(out.buffer);assert.equal(out.buffer.byteLength,84+50*b.getUint32(80,true));const stl=parseSTL(out.buffer);assert.deepEqual(stl.size.map(v=>Math.round(v*100)/100),[c*8,r*8,r>2&&c>2?3.15:3.12]);
 // Re-import the exported STL and check every topological edge occurs twice, in opposite directions.
 const m=indexedMesh(stl.positions),edges=new Map();for(let i=0;i<m.triVerts.length;i+=3)for(let j=0;j<3;j++){const a=m.triVerts[i+j],b=m.triVerts[i+(j+1)%3],key=Math.min(a,b)+','+Math.max(a,b);const e=edges.get(key)||{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(key,e);}const bad=[...edges.values()].filter(e=>e.n!==2||e.d!==0);assert.equal(bad.length,0,`${r}x${c}: STL is not watertight`);
 console.log(`${r}x${c}: ${out.triangles} triangles, single watertight solid, ${out.volume.toFixed(2)} mm³, ${Math.round(performance.now()-start)} ms`);
}
for(const [r,c] of [[1,4],[4,1],[0,0],[2.5,4],[33,4],[NaN,4]])assert.throws(()=>placements(r,c));
console.log('All geometry checks passed.');

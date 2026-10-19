import fs from 'node:fs';
import assert from 'node:assert/strict';
import {placements,parseSTL,indexedMesh,stepSize} from '../dist/core.js';
import {unite} from '../dist/solid.js';
const sources={};
for(const t of ['corner','edge','center']){const b=fs.readFileSync(`dist/assets/${t}.stl`);sources[t]=parseSTL(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.deepEqual(sources[t].size.map(v=>Math.round(v*100)/100),[8,8,t==='center'?3.15:3.12]);}
// Sample the actual raised structure; a side is closed only if its wall is continuous.
// Also check inward-facing corner recesses, not just total boundary triangle area.
const directions=[[1,0],[-1,0],[0,1],[0,-1]],closedWalls={},heightCache=new Map();
function surfaceHeight(type,x,y){
 const key=`${type}:${x.toFixed(6)}:${y.toFixed(6)}`;
 if(heightCache.has(key))return heightCache.get(key);
 const positions=sources[type].positions;let height=-Infinity;
 for(let i=0;i<positions.length;i+=9){
  const a=positions.subarray(i,i+3),b=positions.subarray(i+3,i+6),c=positions.subarray(i+6,i+9);
  const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(det)<1e-12)continue;
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
  const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det,w=1-u-v;
  if(Math.min(u,v,w)>=-1e-6)height=Math.max(height,u*a[2]+v*b[2]+w*c[2]);
 }
 heightCache.set(key,height);return height;
}
for(const type of ['corner','edge']){
 closedWalls[type]=directions.filter(([nx,ny])=>[-3.5,-2,0,2,3.5].every(t=>surfaceHeight(type,nx?nx*3.9:t,ny?ny*3.9:t)>2.5));
 assert.equal(closedWalls[type].length,type==='corner'?2:1,`${type}: continuous outer walls must be identifiable`);
}
function rotatedHeight(part,x,y){
 const angle=-part.q*Math.PI/2;
 return surfaceHeight(part.type,x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle));
}
for(const [r,c] of [[2,2],[2,4],[4,3],[3,4],[4,6],[6,6],[2,32],[32,2],[32,32]]){
 const p=placements(r,c);assert.equal(p.length,r*c);assert.equal(p.filter(x=>x.type==='corner').length,4);assert.equal(p.filter(x=>x.type==='edge').length,2*(r-2)+2*(c-2));assert.equal(p.filter(x=>x.type==='center').length,(r-2)*(c-2));
 // Every closed wall must face an exterior boundary in preview and STL placements.
 for(const part of p.filter(part=>part.type!=='center')){
  const expected=[];
  if(part.c===0)expected.push('-1,0');if(part.c===c-1)expected.push('1,0');
  if(part.r===0)expected.push('0,1');if(part.r===r-1)expected.push('0,-1');
  const angle=part.q*Math.PI/2;
  const actual=closedWalls[part.type].map(([x,y])=>`${Math.round(x*Math.cos(angle)-y*Math.sin(angle))||0},${Math.round(x*Math.sin(angle)+y*Math.cos(angle))||0}`);
  assert.deepEqual(actual.sort(),expected.sort(),`${r}x${c}: ${part.type} at row ${part.r}, column ${part.c} faces inward`);
 }
 // All four quadrants around each internal grid junction must form a circular recess.
 for(const part of p)for(const dx of [-1,1])for(const dy of [-1,1]){
  if((dx===-1&&part.c===0)||(dx===1&&part.c===c-1)||(dy===1&&part.r===0)||(dy===-1&&part.r===r-1))continue;
  const height=rotatedHeight(part,dx*3.6,dy*3.6);
  assert.ok(height>=0.9&&height<1.1,`${r}x${c}: ${part.type} at ${part.r},${part.c} has a raised wall at an inner recess`);
 }
 const start=performance.now();const out=await unite(sources,r,c);assert.equal(out.components,1);const b=new DataView(out.buffer);assert.equal(out.buffer.byteLength,84+50*b.getUint32(80,true));const stl=parseSTL(out.buffer);assert.deepEqual(stl.size.map(v=>Math.round(v*100)/100),[c*8,r*8,r>2&&c>2?3.15:3.12]);
 // Check ALL sizes, including 32x32, for opposing edges (watertight, oriented mesh).
 // Numeric edge codes in a Float64Array avoid an enormous string-key Map.
 const m=indexedMesh(stl.positions),vertexCount=m.vertProperties.length/3,triangles=m.triVerts;
 assert.ok(2*vertexCount*vertexCount<Number.MAX_SAFE_INTEGER,'too many vertices for numeric edge keys');
 const edges=new Float64Array(triangles.length);
 for(let i=0;i<triangles.length;i+=3)for(let j=0;j<3;j++){
   const a=triangles[i+j],b=triangles[i+(j+1)%3];
   assert.notEqual(a,b,`${r}x${c}: degenerate edge`);
   edges[i+j]=2*(Math.min(a,b)*vertexCount+Math.max(a,b))+(a<b?0:1);
 }
 edges.sort();
 assert.equal(edges.length%2,0,`${r}x${c}: odd edge count`);
 for(let i=0;i<edges.length;i+=2){
   if(edges[i]%2!==0||edges[i+1]!==edges[i]+1)
     assert.fail(`${r}x${c}: non-manifold or unoriented edge at sorted index ${i}`);
 }
 console.log(`${r}x${c}: ${out.triangles} triangles, single watertight solid, ${out.volume.toFixed(2)} mm³, ${Math.round(performance.now()-start)} ms`);
}
for(const [value,delta,fallback,expected] of [['2.5',1,2,3],['2.5',-1,2,2],['4',1,2,5],['4',-1,2,3],['',1,4,5],['bad',-1,4,3],['32',1,2,32],['2',-1,2,2]])
 assert.equal(stepSize(value,delta,fallback),expected,`stepSize(${value},${delta})`);
for(const [r,c] of [[1,4],[4,1],[0,0],[2.5,4],[33,4],[NaN,4]])assert.throws(()=>placements(r,c));
console.log('All geometry checks passed.');

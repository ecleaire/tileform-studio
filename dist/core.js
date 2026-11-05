export const PITCH = 8;
export const HEIGHT = 3.15;
export const OUTER_INSET = 0.1;
export function modelInset(version='v4'){
  if(!['v2','v3.2','v4'].includes(version))throw new Error('対応していないモデルです。');
  return version==='v4'?.4:version==='v3.2'?OUTER_INSET:0;
}
export const tileSpan = (count,version='v4') => Number((count * PITCH - 2 * modelInset(version)).toFixed(3));
// Step to the next integer even if the input is temporarily fractional.
export function stepSize(value, direction, fallback=2) {
  const current=typeof value==='string'&&value.trim()===''?NaN:Number(value);
  const start=Number.isFinite(current)?current:fallback;
  const next=direction>0?Math.floor(start)+1:Math.ceil(start)-1;
  return Math.max(2,Math.min(32,next));
}
export function maxTileSize(width,depth,version='v4'){
  if(![width,depth].every(n=>Number.isFinite(n)&&n>=16&&n<=1000))throw new Error('造形範囲は16〜1000 mmで指定してください。');
  const fit=length=>{
    let count=Math.min(32,Math.floor((length+2*modelInset(version))/PITCH));
    // Compare rounded physical dimensions at exact decimal boundaries.
    while(count<32&&tileSpan(count+1,version)<=length)count++;
    while(count>0&&tileSpan(count,version)>length)count--;
    return count;
  };
  return {rows:fit(depth),cols:fit(width)};
}
export function placements(rows, cols) {
  if (![rows, cols].every(n => Number.isInteger(n) && n >= 2 && n <= 32)) throw new Error('縦・横は2〜32の整数を入力してください。');
  const parts=[];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
    const top=r===0,bottom=r===rows-1,left=c===0,right=c===cols-1;
    const type=(top||bottom)&&(left||right)?'corner':(top||bottom||left||right)?'edge':'center';
    let q=0;
    // v3 source corner closes +X/-Y; source edge closes +X.
    // Rotate those closed walls toward the exterior of the assembled tile.
    if(type==='corner') q=bottom&&right?0:top&&right?1:top&&left?2:3;
    if(type==='edge') q=right?0:top?1:left?2:3;
    parts.push({type,q,r,c,x:c*PITCH,y:(rows-1-r)*PITCH});
  }
  return parts;
}
export function parseSTL(buffer, sourceType, version='v4') {
  const d=new DataView(buffer),n=d.getUint32(80,true);
  if(buffer.byteLength!==84+n*50) throw new Error('対応していないSTL形式です。');
  const positions=new Float32Array(n*9),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<n;i++)for(let j=0;j<9;j++){const v=d.getFloat32(84+i*50+12+j*4,true);positions[i*9+j]=v;const k=j%3;min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
  // v3 trims the corner's -Y exterior. Anchor its untrimmed +Y seam
  // to the 8 mm cell, preserving the 0.1 mm inset instead of shifting it inward.
  const size=max.map((v,k)=>v-min[k]);
  if(version==='v4'&&sourceType){
    // v4 closes +Y (and +X for corners). Rotate -90 degrees around
    // the unchanged 8 mm cell center, anchoring the internal seams.
    for(let i=0;i<positions.length;i+=3){const x=positions[i]-min[0]-4,y=positions[i+1]-min[1]-4;positions[i]=y;positions[i+1]=-x;positions[i+2]-=min[2];}
    return {positions,triangles:n,size:[size[1],size[0],size[2]]};
  }
  const origin=[min[0],sourceType==='corner'?max[1]-PITCH:min[1],min[2]];
  for(let i=0;i<positions.length;i++)positions[i]=positions[i]-origin[i%3]-(i%3<2?4:0);
  return {positions,triangles:n,size};
}
export function indexedMesh(positions) {
  const map=new Map(),points=[],indices=[];
  for(let i=0;i<positions.length;i+=3){const p=Array.from(positions.subarray(i,i+3)),key=p.join(',');let idx=map.get(key);if(idx===undefined){idx=points.length/3;map.set(key,idx);points.push(...p);}indices.push(idx);}
  return {numProp:3,vertProperties:new Float32Array(points),triVerts:new Uint32Array(indices)};
}
export function binarySTL(mesh) {
  const {vertProperties:p,triVerts:indices,numProp:s}=mesh,t=[];
  // STL stores float32 vertices. Omit faces that collapse to zero area at that precision.
  for(let i=0;i<indices.length;i+=3){
    const a=Array.from(p.subarray(indices[i]*s,indices[i]*s+3),Math.fround),b=Array.from(p.subarray(indices[i+1]*s,indices[i+1]*s+3),Math.fround),c=Array.from(p.subarray(indices[i+2]*s,indices[i+2]*s+3),Math.fround);
    if(![ [a,b], [b,c], [c,a] ].some(([left,right])=>left.every((value,k)=>value===right[k])))t.push(...indices.subarray(i,i+3));
  }
  const buffer=new ArrayBuffer(84+t.length/3*50),d=new DataView(buffer);
  new Uint8Array(buffer).set(new TextEncoder().encode('Tileform | millimeters | united solid'));
  d.setUint32(80,t.length/3,true);
  for(let i=0;i<t.length;i+=3){const a=Array.from(p.subarray(t[i]*s,t[i]*s+3)),b=Array.from(p.subarray(t[i+1]*s,t[i+1]*s+3)),c=Array.from(p.subarray(t[i+2]*s,t[i+2]*s+3));const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;const o=84+i/3*50;[...n.map(x=>x/l),...a,...b,...c].forEach((x,k)=>d.setFloat32(o+k*4,x,true));}
  return buffer;
}

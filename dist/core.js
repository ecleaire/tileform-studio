export const PITCH = 8;
export const HEIGHT = 3.15;
export function placements(rows, cols) {
  if (![rows, cols].every(n => Number.isInteger(n) && n >= 2 && n <= 32)) throw new Error('縦・横は2〜32の整数を入力してください。');
  const parts=[];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
    const top=r===0,bottom=r===rows-1,left=c===0,right=c===cols-1;
    const type=(top||bottom)&&(left||right)?'corner':(top||bottom||left||right)?'edge':'center';
    let q=0;
    if(type==='corner') q=bottom&&right?0:top&&right?1:top&&left?2:3;
    if(type==='edge') q=right?0:top?1:left?2:3;
    parts.push({type,q,r,c,x:c*PITCH,y:(rows-1-r)*PITCH});
  }
  return parts;
}
export function parseSTL(buffer) {
  const d=new DataView(buffer),n=d.getUint32(80,true);
  if(buffer.byteLength!==84+n*50) throw new Error('対応していないSTL形式です。');
  const positions=new Float32Array(n*9),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<n;i++)for(let j=0;j<9;j++){const v=d.getFloat32(84+i*50+12+j*4,true);positions[i*9+j]=v;const k=j%3;min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
  for(let i=0;i<positions.length;i++)positions[i]=positions[i]-min[i%3]-(i%3<2?4:0);
  return {positions,triangles:n,size:max.map((v,k)=>v-min[k])};
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

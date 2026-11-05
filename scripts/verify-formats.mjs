import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseSTL} from '../dist/core.js';
import {unite} from '../dist/solid.js';
import {encodeModel} from '../dist/formats.js';
for(const version of ['v4','v3.2','v2'])for(const [rows,cols] of [[2,4],[4,6]]){
  const sources={};
  for(const type of ['corner','edge','center']){
    const bytes=fs.readFileSync(`dist/assets/${version==='v4'?'':version==='v3.2'?'v3/':'v2/'}${type}.stl`);
    sources[type]=parseSTL(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),type,version);
  }
  const {buffer,triangles}=await unite(sources,rows,cols,()=>{},version),stl=new DataView(buffer);
  assert.equal(encodeModel(buffer,'stl'),buffer);
  const obj=new TextDecoder().decode(encodeModel(buffer,'obj')).trim().split('\n');
  const vertices=obj.filter(s=>s.startsWith('v ')).map(s=>s.split(' ').slice(1).map(Number));
  const normals=obj.filter(s=>s.startsWith('vn ')).map(s=>s.split(' ').slice(1).map(Number));
  const faces=obj.filter(s=>s.startsWith('f '));
  assert.equal(faces.length,triangles);assert.equal(vertices.length,triangles*3);assert.equal(normals.length,triangles);
  const glb=encodeModel(buffer,'glb'),view=new DataView(glb),jsonLength=view.getUint32(12,true);
  assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);assert.equal(view.getUint32(8,true),glb.byteLength);
  assert.equal(view.getUint32(16,true),0x4e4f534a);assert.equal(jsonLength%4,0);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jsonLength)));
  assert.equal(json.asset.version,'2.0');assert.equal(json.scene,0);assert.deepEqual(json.scenes[0].nodes,[0]);assert.equal(json.nodes[0].mesh,0);
  assert.equal(json.meshes[0].primitives[0].mode,4);assert.deepEqual(json.meshes[0].primitives[0].attributes,{POSITION:0,NORMAL:1});
  assert.equal(json.accessors[0].count,triangles*3);assert.equal(json.accessors[1].count,triangles*3);
  for(const a of json.accessors){assert.equal(a.componentType,5126);assert.equal(a.type,'VEC3');}
  const binOffset=28+jsonLength,bytes=view.getUint32(20+jsonLength,true);
  assert.equal(view.getUint32(24+jsonLength,true),0x004e4942);assert.equal(bytes,json.buffers[0].byteLength);assert.equal(binOffset+bytes,glb.byteLength);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<triangles;i++){
    assert.equal(faces[i],`f ${i*3+1}//${i+1} ${i*3+2}//${i+1} ${i*3+3}//${i+1}`);
    for(let j=0;j<3;j++){
      const xyz=[0,1,2].map(axis=>stl.getFloat32(84+i*50+12+j*12+axis*4,true));
      assert.deepEqual(vertices[i*3+j],xyz,'OBJ must preserve every STL vertex in mm');
      const expected=[xyz[0]/1000,xyz[2]/1000,-xyz[1]/1000];
      for(let axis=0;axis<3;axis++){
        const value=view.getFloat32(binOffset+(i*3+j)*12+axis*4,true);
        assert.ok(Math.abs(value-expected[axis])<1e-8,'GLB physical coordinates');min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
      }
      const normal=[0,1,2].map(axis=>view.getFloat32(binOffset+json.bufferViews[1].byteOffset+(i*3+j)*12+axis*4,true));
      assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5);
      const expectedNormal=[normals[i][0],normals[i][2],-normals[i][1]],length=Math.hypot(...expectedNormal);
      expectedNormal.forEach((value,axis)=>assert.ok(Math.abs(normal[axis]-value/length)<1e-5));
    }
  }
  for(let axis=0;axis<3;axis++){assert.ok(json.accessors[0].min[axis]===min[axis]);assert.ok(json.accessors[0].max[axis]===max[axis]);}
  console.log(`${version} ${rows}x${cols}: OBJ and GLB preserve all ${triangles} triangles, coordinates, normals and physical size`);
}
assert.throws(()=>encodeModel(new ArrayBuffer(0),'glb'));
assert.throws(()=>encodeModel(new ArrayBuffer(84),'obj'));
assert.throws(()=>encodeModel(new ArrayBuffer(84),'unsupported'));
console.log('Export format checks passed.');

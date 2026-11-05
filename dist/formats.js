// Convert the verified, united STL mesh. Preview helpers never enter these files.
export const FORMATS=Object.freeze({stl:{mime:'model/stl'},obj:{mime:'text/plain'},glb:{mime:'model/gltf-binary'}});
export function encodeModel(buffer,format='stl'){
  if(!Object.hasOwn(FORMATS,format))throw Error('未対応の出力形式です。');
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<84)throw Error('モデルデータが不正です。');
  const view=new DataView(buffer),triangles=view.getUint32(80,true);
  if(!triangles||buffer.byteLength!==84+triangles*50)throw Error('モデルデータが不正です。');
  if(format==='stl')return buffer;
  const encoder=new TextEncoder();
  if(format==='obj'){
    const chunks=[encoder.encode('# TILEFORM Studio\n# units: millimeters; Z up\no Tileform\n')];
    let text='';
    for(let i=0;i<triangles;i++){
      const offset=84+i*50;
      for(let j=0;j<3;j++)text+=`v ${view.getFloat32(offset+12+j*12,true)} ${view.getFloat32(offset+16+j*12,true)} ${view.getFloat32(offset+20+j*12,true)}\n`;
      text+=`vn ${view.getFloat32(offset,true)} ${view.getFloat32(offset+4,true)} ${view.getFloat32(offset+8,true)}\nf ${i*3+1}//${i+1} ${i*3+2}//${i+1} ${i*3+3}//${i+1}\n`;
      if(i%4096===4095){chunks.push(encoder.encode(text));text='';}
    }
    if(text)chunks.push(encoder.encode(text));
    const output=new Uint8Array(chunks.reduce((n,chunk)=>n+chunk.length,0));
    let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
    return output.buffer;
  }
  // glTF 2.0 uses meters and Y up. Rotation (x,y,z) -> (x,z,-y)
  // preserves winding; store positions and normalized flat normals separately.
  const count=triangles*3,attributeBytes=count*12,bin=new ArrayBuffer(attributeBytes*2),binary=new DataView(bin);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<triangles;i++){
    const offset=84+i*50,n=[view.getFloat32(offset,true),view.getFloat32(offset+8,true),-view.getFloat32(offset+4,true)],length=Math.hypot(...n)||1;
    for(let j=0;j<3;j++){
      const p=[view.getFloat32(offset+12+j*12,true)/1000,view.getFloat32(offset+20+j*12,true)/1000,-view.getFloat32(offset+16+j*12,true)/1000];
      for(let axis=0;axis<3;axis++){
        const value=Math.fround(p[axis]);min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
        binary.setFloat32((i*3+j)*12+axis*4,value,true);binary.setFloat32(attributeBytes+(i*3+j)*12+axis*4,n[axis]/length,true);
      }
    }
  }
  const json=encoder.encode(JSON.stringify({asset:{version:'2.0',generator:'TILEFORM Studio'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:'Tileform'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},mode:4}]}],buffers:[{byteLength:bin.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:attributeBytes,target:34962},{buffer:0,byteOffset:attributeBytes,byteLength:attributeBytes,target:34962}],accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min,max},{bufferView:1,componentType:5126,count,type:'VEC3'}]}));
  const jsonLength=Math.ceil(json.length/4)*4,total=12+8+jsonLength+8+bin.byteLength,output=new ArrayBuffer(total),header=new DataView(output),bytes=new Uint8Array(output);
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,total,true);
  header.setUint32(12,jsonLength,true);header.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);
  header.setUint32(20+jsonLength,bin.byteLength,true);header.setUint32(24+jsonLength,0x004e4942,true);bytes.set(new Uint8Array(bin),28+jsonLength);
  return output;
}

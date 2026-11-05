import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,SETTINGS_KEY,readSettings,writeSettings} from '../dist/settings.js';
import {maxTileSize,tileSpan} from '../dist/core.js';
let value=null;const storage={getItem:()=>value,setItem:(key,input)=>{assert.equal(key,SETTINGS_KEY);value=input;}};
assert.deepEqual(readSettings(storage),DEFAULT_SETTINGS);
const state={...DEFAULT_SETTINGS,rows:6,cols:4,plateWidth:179.5,plateDepth:120,platePreset:'custom',modelColor:'#123456',color:true,explode:true,modelVersion:'v2',relief:false};
assert.equal(writeSettings(storage,state),true);assert.deepEqual(readSettings(storage),Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key=>[key,state[key]])));
value=JSON.stringify({version:1,settings:{modelVersion:'bad'}});assert.equal(readSettings(storage).modelVersion,'v3.2');
assert.equal(tileSpan(4,'v3.2'),31.8);assert.equal(tileSpan(4,'v2'),32);assert.throws(()=>tileSpan(4,'bad'));
value=JSON.stringify({version:1,settings:{modelColor:'#D3D5D8'}});assert.equal(readSettings(storage).modelColor,'#adb4bc');
value=JSON.stringify({version:1,settings:{modelColor:'#123456'}});assert.equal(readSettings(storage).modelColor,'#123456');
for(const version of ['v2','v3.2'])for(let count=3;count<=32;count++){
 const exact=tileSpan(count,version);
 assert.deepEqual(maxTileSize(exact,exact,version),{rows:count,cols:count},`${version}: exact physical boundary ${exact}`);
 assert.equal(maxTileSize(exact-1e-7,exact,version).cols,count-1,`${version}: must not overrun bed`);
}
assert.equal(maxTileSize(31.8,47.8,'v3.2').cols,4);assert.equal(maxTileSize(31.8,47.8,'v2').cols,3);
assert.throws(()=>maxTileSize(180,180,'bad'));
value=JSON.stringify({version:1,settings:{relief:'bad'}});assert.equal(readSettings(storage).relief,true);
value='bad JSON';assert.deepEqual(readSettings(storage),DEFAULT_SETTINGS);
value=JSON.stringify({version:1,settings:{rows:33,cols:2.5,plateWidth:Infinity,plateDepth:-1,modelColor:'<script>',color:'false'}});assert.deepEqual(readSettings(storage),DEFAULT_SETTINGS);
const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};assert.deepEqual(readSettings(blocked),DEFAULT_SETTINGS);assert.equal(writeSettings(blocked,state),false);
assert.deepEqual(maxTileSize(180,180),{rows:22,cols:22});assert.deepEqual(maxTileSize(250,210),{rows:26,cols:31});assert.deepEqual(maxTileSize(179.5,16),{rows:2,cols:22});assert.deepEqual(maxTileSize(1000,1000),{rows:32,cols:32});
for(const [w,h] of [[0,180],[15.9,180],[1001,180],[NaN,180],[180,Infinity]])assert.throws(()=>maxTileSize(w,h));
console.log('Settings and maximum-size checks passed.');

for(const legacy of ['v3','v3.1']){value=JSON.stringify({version:1,settings:{modelVersion:legacy,rows:6,cols:8,modelColor:'#123456'}});const migrated=readSettings(storage);assert.equal(migrated.modelVersion,'v3.2');assert.equal(migrated.rows,6);assert.equal(migrated.cols,8);assert.equal(migrated.modelColor,'#123456');}

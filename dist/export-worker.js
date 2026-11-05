import {unite} from './solid.js?v=1.5.3';
import {encodeModel,FORMATS} from './formats.js?v=1.5.3';
self.onmessage=async({data})=>{try{
  const format=data.format||'stl';if(!Object.hasOwn(FORMATS,format))throw Error('未対応の出力形式です。');
  const result=await unite(data.sources,data.rows,data.cols,progress=>self.postMessage({progress:{...progress,value:Math.min(.94,progress.value),stage:progress.stage==='STLデータを作成中'?'結合データを作成中':progress.stage}}),data.modelVersion);
  self.postMessage({progress:{value:.95,stage:format.toUpperCase()+'データを作成中'}});
  result.buffer=encodeModel(result.buffer,format);result.format=format;result.mime=FORMATS[format].mime;
  self.postMessage({result},[result.buffer]);
}catch(e){self.postMessage({error:e.message||'モデル生成に失敗しました。'});}};

import {unite} from './solid.js?v=1.2.1';
self.onmessage=async({data})=>{try{const result=await unite(data.sources,data.rows,data.cols,progress=>self.postMessage({progress}));self.postMessage({result},[result.buffer]);}catch(e){self.postMessage({error:e.message||'STL生成に失敗しました。'});}};

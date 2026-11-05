const help=document.querySelector('#help'),dialog=document.querySelector('#history-dialog'),content=document.querySelector('#history-content'),link=document.querySelector('.help-history a');
let helpScroll=0,loaded=false;
link.addEventListener('click',async event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();helpScroll=help.scrollTop;help.close();dialog.showModal();
  if(loaded)return;
  content.setAttribute('aria-busy','true');
  content.innerHTML='<span class="eyebrow">UPDATE HISTORY</span><h2 id="history-title">バージョンアップ履歴</h2><p role="status">履歴を読み込んでいます…</p>';
  try{
    const response=await fetch('./changelog.html?v=1.7.0');
    if(!response.ok)throw Error('history unavailable');
    const source=new DOMParser().parseFromString(await response.text(),'text/html').querySelector('main');
    if(!source?.querySelector('.release-list'))throw Error('invalid history');
    source.querySelector('.bottom-back')?.remove();
    for(const heading of source.querySelectorAll('h2')){const replacement=document.createElement('h3');replacement.id=heading.id;replacement.innerHTML=heading.innerHTML;heading.replaceWith(replacement);}
    const title=source.querySelector('h1'),replacement=document.createElement('h2');replacement.id='history-title';replacement.innerHTML=title.innerHTML;title.replaceWith(replacement);
    content.replaceChildren(...source.childNodes);loaded=true;
  }catch{
    content.innerHTML='<span class="eyebrow">UPDATE HISTORY</span><h2 id="history-title">バージョンアップ履歴</h2><p role="alert">履歴を読み込めませんでした。閉じて開き直すか、<a href="./changelog.html">履歴ページを直接開く</a>からご確認ください。</p>';
  }finally{content.setAttribute('aria-busy','false');}
});
for(const id of ['history-close','history-back'])document.querySelector('#'+id).onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{help.showModal();help.scrollTop=helpScroll;link.focus({preventScroll:true});});
dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
content.addEventListener('click',event=>{const anchor=event.target.closest('a[href^="#"]');if(!anchor)return;const section=content.querySelector(anchor.getAttribute('href'));if(section){event.preventDefault();section.scrollIntoView({block:'start'});}});

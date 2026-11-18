// Existing synthetic premium account in the loopback preview; no provider calls.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async page=>{
  if(new URL(page.url()).origin!=='http://127.0.0.1:4392')throw Error('Loopback fixture required');
  const title=`SYNTHETIC 336 ${Date.now()}`,body='Synthetic diary operation: retained encrypted draft and acknowledged save.';
  const checks=[],check=(name,condition)=>{checks.push({name,passed:condition});if(!condition)throw Error(name);};
  let privateWrites=0,plaintextTransport=false;
  const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/diary/')&&request.method()==='PUT'){
    privateWrites++;plaintextTransport||=(request.postData()??'').includes(body);
  }};
  page.on('request',observe);
  try {
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('textbox',{name:'Заголовок',exact:true}).fill(title);
    await dialog.getByRole('textbox',{name:'Запись',exact:true}).fill(body);
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const drafts=page.locator('.diary-drafts');
    await drafts.locator('summary').click();
    await drafts.getByRole('button',{name:title,exact:true}).click();
    check('closing the editor retains the complete encrypted draft',await dialog.getByRole('textbox',{name:'Запись',exact:true}).inputValue()===body);
    await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.locator('.diary-note h2').filter({hasText:title}).waitFor();
    await page.reload();
    await page.locator('.diary-note h2').filter({hasText:title}).waitFor();
    check('acknowledged diary survives a full reload',true);
    check('private writes do not include plaintext content',privateWrites>0&&!plaintextTransport);
    check('durable diary sources contain ciphertext only',await page.evaluate(body=>{
      const keys=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index));
      const entries=keys.filter(key=>key.startsWith('genesis-diary-v1:')).map(key=>localStorage.getItem(key));
      return entries.length>0&&entries.every(value=>!value.includes(body));
    },body));
    await page.getByRole('button',{name:'Новая заметка',exact:true}).click();
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.waitFor({state:'hidden'});
    check('empty editor cleanup finishes without retaining a phantom draft',await page.locator('.diary-drafts').count()===0);
    return{status:'PASS',synthetic:true,checks};
  }finally{page.off('request',observe);}
}

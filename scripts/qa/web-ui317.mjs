import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const near=(actual,expected,message,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} / ${expected}`);
const theme=async(page,scheme)=>{
  // A new document restores its saved theme after hydration. Observe the real toggle before reading html.
  await page.locator('.theme-mode-toggle:visible:not([disabled])').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.theme-mode-toggle')].filter(node=>node.getClientRects().length).every(node=>node.getAttribute('aria-busy')!=='true'));
  const desired=scheme==='dark'?'standart-dark':'standart';
  if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)
    await page.locator('.theme-mode-toggle:visible').first().click();
  await page.waitForFunction(value=>document.documentElement.getAttribute('data-genesis-theme')===value,desired);
};
const center=async(page,dialog)=>{
  const rect=await dialog.boundingBox(),view=page.viewportSize();assert(rect&&view);
  assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=view.width+1&&rect.y+rect.height<=view.height+1,'Modal stays inside the viewport');
  near(rect.x+rect.width/2,view.width/2,'Modal horizontal center');
  near(rect.y+rect.height/2,view.height/2,'Modal vertical center');
  return rect;
};

/** U08-U11: rendered controls, modal persistence and actual local API prices; never submits checkout. */
export async function verifyUi317({context,page,tier,output,check,snapshot,originalMapUrl,visit,openAccount,upgrade,closeUpgrade}) {
  const records=[];
  for(const width of [360,390,768,1440])for(const scheme of ['light','dark']) {
    await check(`release317-account-${width}-${scheme}`,async()=>{
      await visit('/#today');await page.setViewportSize({width,height:1000});await theme(page,scheme);
      const account=await openAccount({navigate:false}),button=account.locator('.account-plan-upgrade .upgrade-open-button');
      await button.waitFor();await page.mouse.move(0,0);
      const row=await account.locator('.account-profile-details').boundingBox(),rect=await button.boundingBox();assert(row&&rect);
      assert(rect.width>=44&&rect.height>=48,'Account action target');
      if(width<768){const plan=await account.locator('.account-plan').boundingBox();assert(plan);near(rect.x,plan.x,'Mobile account action aligns below the current plan');assert(rect.y>=plan.y+plan.height+8,'Mobile account action follows the plan line');}
      else near(rect.x+rect.width,row.x+row.width,'Desktop account action aligns to the right');
      const style=await button.evaluate(node=>{const s=getComputedStyle(node);return{background:s.backgroundColor,color:s.color,border:s.borderColor,borderWidth:s.borderWidth,boxShadow:s.boxShadow};});
      assert.equal(style.background,'rgb(87, 50, 133)');assert.equal(style.border,'rgb(215, 181, 107)');assert.notEqual(style.boxShadow,'none');
      const overflow=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert(overflow.page<=overflow.viewport+1,'Account must not overflow horizontally');
      await page.keyboard.press('Tab');await button.focus();
      const focus=await button.evaluate(node=>{const s=getComputedStyle(node);return{style:s.outlineStyle,width:s.outlineWidth};});
      assert.notEqual(focus.style,'none','Visible keyboard focus');
      await snapshot(`release317-account-${width}-${scheme}`);
      records.push({screen:'account',width,scheme,rect,row,style,focus,overflow});
      await button.click();await upgrade().waitFor();await closeUpgrade();
      await account.getByRole('button',{name:'Закрыть',exact:true}).click();
    });

    await check(`release317-map-settings-${width}-${scheme}`,async()=>{
      assert(new URL(originalMapUrl).searchParams.has('mindmap'),'Saved map prerequisite');
      await visit(originalMapUrl);await page.setViewportSize({width,height:1000});await theme(page,scheme);
      await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
      const controls=page.locator('.mindmaps'),buttons=controls.locator('.mindmap-editor-back,.mindmap-view-toggle,.mindmap-settings-toggle');assert.equal(await buttons.count(),3);
      const geometry=await buttons.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{label:node.getAttribute('aria-label'),x:r.x,y:r.y,width:r.width,height:r.height,background:s.backgroundColor,color:s.color};}));
      assert.equal(geometry[0].label,'Все майндмепы','Back action precedes the map title');
      for(const rect of geometry)assert(rect.width>=44&&rect.height>=44,'Map control touch target');
      const header=await page.locator('.mindmap-header').boundingBox();near(geometry[0].y+geometry[0].height/2,header.y+header.height/2,'Back action is centered in the header');
      const actions=await page.locator('.mindmap-primary-toolbar').evaluate(el=>[...el.querySelectorAll('.mindmap-view-toggle,.mindmap-add-thought,.mindmap-add-affair,.mindmap-history-actions > button,.mindmap-settings-toggle')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
      assert.equal(actions.length,6);for(const action of actions)assert(action.width>=44&&action.height>=44,'Editing action touch target');
      if(width<1100){for(const action of actions)near(action.y,actions[0].y,'Mobile editing actions share one row');assert(actions.every((action,index)=>!index||action.x>actions[index-1].x),'Mode first, settings after redo');}
      else {const search=await page.locator('.mindmap-primary-toolbar .mindmap-node-search').boundingBox();assert(actions[5].x>=search.x+search.width,'Desktop settings follow search');}
      assert.notEqual(geometry[0].background,'rgba(0, 0, 0, 0)','Visible control background');
      const view=controls.locator('.mindmap-view-toggle');
      if(await view.getAttribute('aria-label')==='Карта')await view.click();
      await page.locator('.mindmap-canvas').waitFor();
      assert.equal(await view.getAttribute('aria-label'),'Структура');
      await view.click();await page.locator('.mindmap-canvas').waitFor({state:'hidden'});
      await page.locator('.mindmap-structure').waitFor();
      assert.equal(await view.getAttribute('aria-label'),'Карта');
      const trigger=controls.getByRole('button',{name:'Настройка карты',exact:true});await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Настройка карты',exact:true});await dialog.waitFor();assert.equal(await dialog.getAttribute('aria-modal'),'true');
      const rect=await center(page,dialog);
      assert.equal(await page.locator('.mindmap-settings-panel').count(),1);assert(await dialog.getByRole('textbox',{name:'Название карты',exact:true}).isEditable());
      for(const name of ['Вставить текст','Экспорт','История'])assert.equal(await dialog.getByRole('button',{name,exact:true}).count(),1);
      const focusable=dialog.locator('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      await focusable.first().focus();await page.keyboard.press('Shift+Tab');assert(await dialog.evaluate(node=>node.contains(document.activeElement)),'Backward focus stays within settings');
      await focusable.last().focus();await page.keyboard.press('Tab');assert(await dialog.evaluate(node=>node.contains(document.activeElement)),'Forward focus stays within settings');
      if(width===1440&&scheme==='light'){
        const field=dialog.getByRole('textbox',{name:'Описание',exact:true}),value=`QA settings 3.1.7 ${tier}`;
        await field.fill(value);await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
        records.push({screen:'map-description-persistence',value});
      }
      await snapshot(`release317-map-settings-${width}-${scheme}`);
      records.push({screen:'map-settings',width,scheme,rect,controls:geometry});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.activeElement?.matches('.mindmap-settings-toggle'),{},{timeout:2000});
      assert(await trigger.evaluate(node=>node===document.activeElement),'Escape returns focus to settings trigger');
      if(width===1440&&scheme==='light'){
        await page.reload();await trigger.waitFor();await trigger.click();
        assert.equal(await page.getByRole('dialog',{name:'Настройка карты',exact:true}).getByRole('textbox',{name:'Описание',exact:true}).inputValue(),`QA settings 3.1.7 ${tier}`);
        await page.keyboard.press('Escape');
      }
    });
  }
  await check('release317-fixed-usd-prices',async()=>{
    const catalog=await (await context.request.get('/api/billing/catalog')).json();assert.equal(catalog.foreignPricing.pricingModel,'fixed');assert.equal(catalog.checkoutEnabled,false,'QA checkout must remain disabled');
    await context.grantPermissions(['geolocation']);
    try {
      for(const [currency,coordinates,prices] of [
        ['USD',{latitude:47.6062,longitude:-122.3321,accuracy:20},[[4,7,10,160],[40,70,100,160]]],
        ['RUB',{latitude:55.7558,longitude:37.6173,accuracy:20},[[333,555,777,12900],[3330,5550,7770,12900]]]
      ]){
        await context.setGeolocation(coordinates);const account=await openAccount();await account.locator('.account-plan-upgrade button').click();await upgrade().waitFor();
        await upgrade().locator('.upgrade-plan-premium input').check();
        await upgrade().locator(`.upgrade-plan-standart .upgrade-plan-price`).filter({hasText:currency==='USD'?/\$/:/₽/}).waitFor();
        for(const [index,period] of [1,12].entries()){
          await upgrade().locator('.upgrade-period-options input').nth(index).check();
          const observed=[];
          for(const [planIndex,plan] of ['standart','premium','business','premium4life'].entries()){
            const text=(await upgrade().locator(`.upgrade-plan-${plan} .upgrade-plan-price`).innerText()).trim();
            const amount=Number(text.replace(/[^\d.,-]/g,'').replace(',','.'));assert.equal(amount,prices[index][planIndex],`${currency} ${plan} ${period}`);
            assert.match(text,currency==='USD'?/\$/:/₽/);observed.push({plan,period,text,amount});
          }
          assert.equal(await upgrade().locator('.upgrade-fx-note').count(),0,'Fixed prices must not show a numeric FX conversion note');
          await snapshot(`release317-prices-${currency}-${period}`);records.push({screen:'prices',currency,period,observed,syntheticGeolocation:coordinates});
        }
        await closeUpgrade();await account.getByRole('button',{name:'Закрыть',exact:true}).click();
      }
      await snapshot('release317-fixed-usd-prices');
    } finally {await context.clearPermissions();await context.setGeolocation(null);}
  });
  await writeFile(`${output}/${tier}-release317-ui-details.json`,JSON.stringify({records,purchases:false,localCatalog:true,widths:[360,390,768,1440],schemes:['light','dark']},null,2));
}

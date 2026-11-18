// Task-owned loopback release preview; no personal accounts or storage.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async page=>{
  const browser=page.context().browser(),origin=new URL(page.url()).origin;
  for(const colorScheme of ['light','dark']) {
    const context=await browser.newContext({colorScheme,locale:'en-US',timezoneId:'Europe/Moscow',reducedMotion:'reduce'});
    try {
      const view=await context.newPage();
      for(const width of [360,390,768,1440]) {
        await view.setViewportSize({width,height:1000});await view.goto(`${origin}/?lang=en`);await view.getByRole('heading',{name:'Sign in to GENESIS',exact:true}).waitFor();
        await view.screenshot({path:`output/release-3.3.6/regional/before/en-${colorScheme}-${width}.png`,fullPage:false});
      }
    }finally{await context.close();}
  }
  console.log('Regional baseline: 8 English homepage screenshots saved.');
}

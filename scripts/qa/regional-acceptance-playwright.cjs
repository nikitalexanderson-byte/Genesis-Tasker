// Isolated release preview and synthetic accounts only. Invoked by playwright-cli.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async page=>{
  const browser=page.context().browser(),origin='http://127.0.0.1:4392';
  const languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
  const route=(lang,slug='')=>`${lang==='ru'?'/ru':''}/${slug}${lang==='ru'||lang==='en'?'':`?lang=${lang}`}`;
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  let layouts=0,documents=0;
  for(const colorScheme of ['light','dark']) {
    const context=await browser.newContext({colorScheme,locale:'ru-RU',timezoneId:'Europe/Moscow',reducedMotion:'reduce'});
    try {
      const view=await context.newPage();
      for(const language of languages) {
        await view.goto(origin+route(language));
        await view.locator('.welcome-language-flags').waitFor();
        await view.waitForFunction(lang=>document.documentElement.lang===lang,language);
        check(await view.getByRole('radio').count()===14,`${language}: all public language choices`);
        check(await view.locator('.public-previews img').count()===20,`${language}: gallery preserved`);
        for(const width of [360,390,768,1440]) {
          await view.setViewportSize({width,height:1000});
          await view.evaluate(()=>document.fonts.ready);
          const metrics=await view.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
            source:[...document.querySelectorAll('.public-previews img')].map(img=>img.getAttribute('src')),
            canonical:document.querySelector('link[rel="canonical"]')?.getAttribute('href')}));
          check(metrics.scroll<=metrics.width+1,`${language}/${colorScheme}/${width}: horizontal page overflow ${metrics.scroll}`);
          check(metrics.source.every(src=>src.includes(`/free/${language}/`)),`${language}: localized images`);
          check(metrics.canonical===`https://genesiscalendar.com${route(language)}`,`${language}: canonical after hydration`);
          await view.screenshot({path:`output/release-3.3.6/regional/after/${language}-${colorScheme}-${width}.png`,fullPage:false});
          layouts++;
        }
      }
    }finally{await context.close();}
  }
  const navigation=await browser.newContext({locale:'ru-RU',timezoneId:'Europe/Moscow',reducedMotion:'reduce'});
  try {
    await navigation.addInitScript(()=>localStorage.setItem('genesis-language-v1','ja'));
    const view=await navigation.newPage();
    await view.goto(`${origin}/`);await view.locator('.welcome-language-flags').waitFor();
    check(await view.locator('html').getAttribute('lang')==='en','Root stays English despite Russian device and previous Japanese preference');
    await view.goto(`${origin}/ru/?ref=regional336&campaign=acceptance#pricing`);
    await view.getByRole('radio',{name:'Deutsch',exact:true}).click();
    await view.waitForFunction(()=>document.documentElement.lang==='de');
    const selected=new URL(view.url());
    check(selected.pathname==='/'&&selected.searchParams.get('lang')==='de','Switcher returns other languages to the main site');
    check(selected.searchParams.get('ref')==='regional336'&&selected.searchParams.get('campaign')==='acceptance'&&selected.hash==='#pricing','Switcher preserves invitation, campaign and anchor');
    await view.reload();await view.locator('.welcome-language-flags').waitFor();
    check(await view.locator('html').getAttribute('lang')==='de','Selected language survives reload');
    await view.locator('a[href="/privacy?lang=de"]').first().click();
    await view.locator('.legal-document').waitFor();
    check(await view.locator('html').getAttribute('lang')==='de','Legal page retains language');
    check(await view.locator('a[href="/terms?lang=de"]').count()>0,'Legal navigation retains language');
    await view.goto(`${origin}/api/qa/login?tier=free`);
    await view.goto(`${origin}/?lang=de#today`);
    await view.locator('.app-brand-header').waitFor({timeout:30000});
    check(new URL(view.url()).origin===origin,'Signed-in application stays on the same origin');
  }finally{await navigation.close();}
  const noScript=await browser.newContext({javaScriptEnabled:false,locale:'ru-RU'});
  try {
    const view=await noScript.newPage();
    for(const language of languages)for(const slug of ['','login','terms','privacy','refund','support','delete-account']) {
      const response=await view.goto(origin+route(language,slug));
      check(response.ok(),`${language}/${slug}: initial public HTML response`);
      check(await view.locator('html').getAttribute('lang')===language,`${language}/${slug}: initial language without JavaScript`);
      check(await view.locator('h1').count()>0,`${language}/${slug}: document content without JavaScript`);
      documents++;
    }
  }finally{await noScript.close();}
  console.log(JSON.stringify({result:'PASS',layouts,documents,switching:'preserved URL state and language',authenticated:'synthetic account, same origin'}));
}

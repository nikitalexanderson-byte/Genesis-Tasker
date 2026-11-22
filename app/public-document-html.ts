import {publicLegalUpdated} from './legal-content';
import {legalPresentation} from './legal-presentation';
import {escapePublicText as escape,publicMerchantHtml,publicProductCopy,publicProductHtml} from './public-product';
import {publicPagePath,publicPageAlternates,type PublicPage,type PublicEdition} from './public-route';
import type {RegionLanguage} from './region-language';
import pageCopy from './public-page-copy.json';

type Translate=(source:string)=>string;
export const PUBLIC_ORIGIN='https://genesiscalendar.com';

export function publicLanguageLinks(language:RegionLanguage,page:PublicPage,translate:Translate,base='',edition:PublicEdition='international') {
  return `<nav class="public-language-links" aria-label="${escape(translate('Выбор языка'))}">${publicPageAlternates(page,base,edition)
    .filter(row=>row.language!=='x-default').map(row=>`<a href="${row.path}" lang="${row.language}" hreflang="${row.language}"${row.language===language?' aria-current="page"':''}>${row.language.toUpperCase()}</a>`).join('')}</nav>`;
}

export function publicHomeHtml(language:RegionLanguage,translate:Translate,base='',edition:PublicEdition='international') {
  const c=publicProductCopy(language,edition),home=publicPagePath(language,'home',base,edition),login=`${publicPagePath(language,'login',base,edition)}#sign-in`;
  const t=(source:string)=>escape(translate(source));
  return `<main class="welcome-screen" aria-labelledby="fallback-title"><div class="welcome-shell">
    <header class="welcome-nav"><a class="welcome-brand" href="${home}">GENESIS</a><nav aria-label="GENESIS"><a href="#features">${escape(c.features)}</a><a href="#pricing">${escape(c.pricing)}</a><a href="${login}">${escape(c.signIn)}</a></nav></header>
    <section class="welcome-copy"><p class="welcome-kicker">${escape(pageCopy[language].kicker)}</p>
      <h1 id="fallback-title"><span>Genesis Tasker</span><em>${escape(pageCopy[language].title)}</em></h1>
      <p>${t('GENESIS — приложение для планирования личных и рабочих задач, проектов, подпроектов, повторений и напоминаний. Календарь помогает составлять план дня, связывать действия и отмечать выполненное на компьютере или телефоне.')}</p>
      <p class="public-hero-actions"><a class="public-action" href="#pricing">${escape(c.pricing)}</a><a href="${login}">${escape(c.getStarted)}</a></p>
      <section class="google-data-purpose" aria-labelledby="fallback-google-purpose"><h2 id="fallback-google-purpose">${t('Как GENESIS использует Google Calendar и Google Tasks')}</h2>
      <p>${t('Сначала Google передаёт только подтверждённый адрес, имя и изображение профиля для безопасного входа. Уже после входа вы сами решаете, подключать ли синхронизацию: GENESIS создаёт отдельный календарь GENESIS, а доступ к Google Tasks использует для показа и двустороннего изменения ваших списков и задач. Разрешения не применяются для рекламы, профилирования или обучения моделей.')}</p></section>
      <section class="google-data-purpose" aria-labelledby="fallback-service-owner"><h2 id="fallback-service-owner">${edition==='domestic'&&language==='ru'?t('Сервис GENESIS и домен'):escape(c.merchantTitle)}</h2>${publicMerchantHtml(language,'home',base,edition)}
      <p>${t('Нейросетевой помощник GENESIS разбирает команды и готовит план задач. GENESIS не создаёт интимные изображения без согласия (AI NCII) и не использует Google API для этой цели.')}</p></section>
      ${publicLanguageLinks(language,'home',translate,base,edition)}
    </section><div class="public-product">${publicProductHtml(language,base,edition)}</div></div></main>`;
}

/** Both renderers share the applicable service edition and complete processing disclosures. */
export function publicLegalHtml(page:Exclude<PublicPage,'home'|'login'>,language:RegionLanguage,translate:Translate,backup:Translate,base='',edition:PublicEdition='international') {
  const c=publicProductCopy(language,edition),document=legalPresentation(page,language,translate,backup,edition),home=publicPagePath(language,'home',base,edition);
  const sections=document.sections.map(([title,body])=>`<section><h2>${escape(title)}</h2><p>${escape(body)}</p></section>`).join('\n');
  const markup=`<main class="legal-shell"><header class="legal-header"><a class="welcome-brand" href="${home}"><span class="solar-mark"><i></i></span><span><strong>GENESIS</strong><small>${escape(translate('доверие и ясность'))}</small></span></a><a href="${home}">${escape(translate('← На главную'))}</a></header>
    <article class="legal-document"><span class="welcome-kicker">${escape(translate('ОФИЦИАЛЬНЫЙ ДОКУМЕНТ'))}</span><h1>${escape(document.title)}</h1><p class="legal-intro">${escape(document.intro)}</p><p class="legal-date">${escape(translate('Редакция от'))} ${publicLegalUpdated()}</p>${publicMerchantHtml(language,page,base,edition)}${sections}
    ${page==='privacy'?'<p class="legal-policy-link"><a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a></p>':''}</article>
    <footer class="legal-footer">${(['privacy','terms','refund','support','delete-account'] as const).map(slug=>`<a href="${publicPagePath(language,slug,base,edition)}">${escape(slug==='delete-account'?c.deleteAccount:c[slug])}</a>`).join('')}</footer>${publicLanguageLinks(language,page,translate,base,edition)}</main>`;
  return {markup,title:document.title,description:document.intro};
}

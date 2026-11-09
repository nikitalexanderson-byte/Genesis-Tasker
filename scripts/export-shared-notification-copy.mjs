import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const keys=["Есть новые уведомления в общих делах GENESIS.","Откройте GENESIS, чтобы посмотреть обновления.","Подтвердите регистрацию в GENESIS","Ваш аккаунт создан через Google. Подтвердите регистрацию. Ссылка действует 48 часов.","Подтвердить регистрацию","Это письмо отправляется один раз при регистрации на сайте.","Новые личные сообщения в GENESIS","Откройте GENESIS, чтобы прочитать сообщения. Переписка остаётся зашифрованной.","Открыть сообщения","Настройки писем доступны в личном кабинете GENESIS.","Открыть GENESIS","Регистрация подтверждена","Подтверждение регистрации","Ссылка недействительна или срок её действия истёк"];
keys.push(...["Время для привычки. Откройте GENESIS, чтобы отметить результат.","Время действовать! Сделайте следующий шаг к своей привычке.","Привычка ждёт. Обещаем: начинать обычно сложнее, чем продолжать.","Пора проверить дневную цель. Откройте привычки, когда будет удобно.","Каждый шаг приближает к дневной цели. Откройте привычки и продолжайте!","Дневная цель сама себя не выполнит. Заглянем в привычки?","Выполнено","Добавить значение","Отложить"]);
const result={ru:Object.fromEntries(keys.map(key=>[key,key]))};
for(const locale of['en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
 const catalog={};for(const relative of[`app/translations.${locale}.json`,`app/translations.${locale}.a.json`,`app/translations.${locale}.b.json`,`app/ui-translations/${locale}.json`]){const file=path.join(root,relative);if(fs.existsSync(file))Object.assign(catalog,JSON.parse(fs.readFileSync(file,'utf8')));}
 result[locale]=Object.fromEntries(keys.map(key=>{if(!catalog[key]||catalog[key]===key)throw Error(`Missing server notification translation: ${locale}: ${key}`);return[key,catalog[key]];}));
}
const target=path.join(root,'server/resources/shared-notification-copy.json'),output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('Shared notification copy is stale; run node scripts/export-shared-notification-copy.mjs');console.log('Shared server notification copy verified for all14 languages.');}
else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);console.log('Shared server notification copy exported for all14 languages.');}

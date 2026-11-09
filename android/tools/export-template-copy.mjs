import ts from 'typescript';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const app = new URL('../../app/', import.meta.url);
const source = ts.createSourceFile('shared-templates.ts', await readFile(new URL('shared-templates.ts', app), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const issueFunction = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'templateIssueText');
const copy = issueFunction?.body?.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(source) === 'copy')?.initializer;
const options = source.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(source) === 'templateOptions')?.initializer;
function strings(node) {
  while (node && ts.isAsExpression(node)) node = node.expression;
  if (!node || !ts.isObjectLiteralExpression(node)) throw Error('Expected the existing portable template copy object');
  return Object.fromEntries(node.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) throw Error('Non-literal template copy');
    return [ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(source), property.initializer.text];
  }));
}
const issues = strings(copy), flags = strings(options);
const nativeLabels = JSON.parse(await readFile(new URL('native-template-labels.json', app), 'utf8'));
const result = {};
const catalogs = await readdir(app);
for (const language of ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']) {
  const base = {};
  for (const file of catalogs.filter(name => new RegExp(`^translations\\.${language}(?:\\.[a-z])?\\.json$`).test(name))) Object.assign(base, JSON.parse(await readFile(new URL(file,app),'utf8')));
  if (language === 'en') Object.assign(base, JSON.parse(await readFile(new URL('curated-translations.en.json',app),'utf8')));
  const dictionary = language === 'ru' ? {} : {
    ...base,
    ...JSON.parse(await readFile(new URL(`ui-translations/${language}.json`, app), 'utf8')),
    ...JSON.parse(await readFile(new URL(`shared-work-translations/${language}.json`, app), 'utf8')),
  };
  const translate = text => {
    if (language === 'ru') return text;
    const translated = dictionary[text];
    if (typeof translated !== 'string' || !translated) throw Error(`Missing reviewed template translation: ${language} / ${text}`);
    return translated;
  };
  result[language] = { issues: Object.fromEntries(Object.entries(issues).map(([key,text]) => [key,translate(text)])), options: Object.fromEntries(Object.entries(flags).map(([key,text]) => [key,translate(text)])) };
  result[language].options.tags = nativeLabels[language]['Текстовые теги'];
  result[language].options.labels = nativeLabels[language]['Метки пространства'];
  result[language].issues.TEMPLATE_PERMISSION_CHANGED = nativeLabels[language]['Доступ к проекту или шаблону изменился. Сохранённые черновики и неподтверждённые запросы остаются на этом устройстве. Когда доступ восстановится, заново откройте проект и раздел «Шаблоны» в том же аккаунте.'];
  if (!result[language].issues.TEMPLATE_PERMISSION_CHANGED) throw Error(`Missing native template access recovery: ${language}`);
  if (!result[language].options.tags || !result[language].options.labels || result[language].options.tags === result[language].options.labels) throw Error(`Ambiguous native template tags/labels: ${language}`);
}
const path = new URL('native-template-translations.json', app), expected = JSON.stringify(result,null,2)+'\n';
if (process.argv.includes('--check')) {
  if ((await readFile(path,'utf8')).replaceAll('\r\n','\n') !== expected) throw Error('Native template copy is stale');
} else await writeFile(path,expected);
console.log(`Native template copy: ${Object.keys(issues).length + 1} issues and ${Object.keys(flags).length} options in 14 reviewed languages.`);

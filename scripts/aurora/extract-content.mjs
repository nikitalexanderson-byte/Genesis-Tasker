// One-time, syntax-aware extraction of the new Russian authored module into its
// own content dictionary. Greek forms, machine IDs and code stay unchanged.
import ts from 'typescript';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
const root=resolve('app/aurora'),dictionary={},cyrillic=/[А-Яа-яЁё]/u;
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):/\.tsx?$/.test(e.name)?[resolve(dir,e.name)]:[]);}
const value=string=>{
 let key=Object.keys(dictionary).find(key=>dictionary[key]===string);
 if(!key){key='text'+String(Object.keys(dictionary).length+1).padStart(4,'0');dictionary[key]=string;}
 return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('RU'),key);
};
for(const path of files(root)){
 const original=readFileSync(path,'utf8');if(original.includes('texts.ru.json'))throw new Error('Extraction already applied');
 const source=ts.createSourceFile(path,original,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 let changed=false;
 const transformed=ts.transform(source,[context=>{
  const visit=node=>{
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))return node;
   if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)&&cyrillic.test(node.initializer.text)){
    changed=true;return ts.factory.updateJsxAttribute(node,node.name,ts.factory.createJsxExpression(undefined,value(node.initializer.text)));
   }
   if(ts.isJsxText(node)&&cyrillic.test(node.text)){
    changed=true;return ts.factory.createJsxExpression(undefined,value(node.text.replace(/\s+/g,' ')));
   }
   if(ts.isTemplateExpression(node)){
    const parts=[node.head.text,...node.templateSpans.map(s=>s.literal.text)];
    if(parts.some(p=>cyrillic.test(p))){
     changed=true;let expression=cyrillic.test(parts[0])?value(parts[0]):ts.factory.createStringLiteral(parts[0]);
     node.templateSpans.forEach((span,i)=>{
      expression=ts.factory.createBinaryExpression(expression,ts.SyntaxKind.PlusToken,ts.visitNode(span.expression,visit));
      if(parts[i+1])expression=ts.factory.createBinaryExpression(expression,ts.SyntaxKind.PlusToken,cyrillic.test(parts[i+1])?value(parts[i+1]):ts.factory.createStringLiteral(parts[i+1]));
     });return ts.factory.createParenthesizedExpression(expression);
    }
   }
   if(ts.isStringLiteralLike(node)&&cyrillic.test(node.text)){
    if((ts.isPropertyAssignment(node.parent)||ts.isPropertySignature(node.parent))&&node.parent.name===node)return node;
    changed=true;return value(node.text);
   }
   return ts.visitEachChild(node,visit,context);
  };return visit;
 }]);
 if(changed){
  let importPath=relative(dirname(path),resolve(root,'texts.ru.json')).replaceAll('\\','/');if(!importPath.startsWith('.'))importPath='./'+importPath;
  const printed=ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(transformed.transformed[0]);
  // Preserve directive prologues ahead of the imported content.
  const directive=printed.match(/^(["']use client["'];\s*)/);
  const offset=directive?.[0].length??0;
  writeFileSync(path,printed.slice(0,offset)+`import RU from '${importPath}';\n`+printed.slice(offset));
 }transformed.dispose();
}
writeFileSync(resolve(root,'texts.ru.json'),JSON.stringify(dictionary,null,2)+'\n');
console.log(`Extracted ${Object.keys(dictionary).length} Russian content fragments. Content locale: ru; Greek orthography and machine IDs unchanged.`);

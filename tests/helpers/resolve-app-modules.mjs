import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const app=new URL('../../app/',import.meta.url).href;
// Node's type transform handles TypeScript syntax; these resolution rules match
// the existing bundler's relative extensionless, JSON and ?raw imports. They do
// not replace any application module or intercept IO performed by that module.
registerHooks({
  resolve(specifier,context,nextResolve){
    if(context.parentURL?.startsWith(app)&&specifier.startsWith('.')){
      const url=new URL(specifier,context.parentURL);
      if(specifier.endsWith('.json')){
        const importAttributes={...context.importAttributes,type:'json'};
        return{...nextResolve(specifier,{...context,importAttributes}),importAttributes};
      }
      if(specifier.endsWith('?raw')){
        url.search='';
        const source='export default '+JSON.stringify(readFileSync(url,'utf8'))+';';
        return{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
      }
      if(!/\.[cm]?[jt]sx?$/.test(url.pathname)){
        const candidate=new URL(url.href+'.ts');
        if(existsSync(fileURLToPath(candidate)))return nextResolve(candidate.href,context);
      }
    }
    return nextResolve(specifier,context);
  },
});

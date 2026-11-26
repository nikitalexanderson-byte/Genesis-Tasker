import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export const advicePublicLanguages=Object.freeze(['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']);
const roots={daily:'server/content/daily-advice',philosophers:'server/content/philosopher-aphorisms-locales'};

/** Public editorial metadata for LOCAL selection. This input contains no
 * account, profile, selected card, metric, score or private history. */
export function collectAdviceSelectionMetadata(root){
 const read=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
 const artwork=read('server/content/philosopher-aphorisms-artwork.json').images;
 const policy=read('server/resources/advice-age-access-policy.json');const items=[],seen=new Set();
 for(const [collection,path]of Object.entries({aurora:'server/content/daily-advice.json',philosophers:'server/content/philosopher-aphorisms.json'})){
  const source=read(path);if(source.version!==1||!Array.isArray(source.items))throw new Error('ADVICE_PUBLIC_CONTENT_INVALID');
  for(const raw of source.items){if(!/^advice-[a-f0-9]{24}$/.test(raw.id)||seen.has(raw.id))throw new Error('ADVICE_PUBLIC_CONTENT_INVALID');seen.add(raw.id);
   if((raw.status??'published')==='draft'||collection==='philosophers'&&!artwork[raw.id])continue;
   if(raw.categories.includes('psychopompia')&&(!policy.corpusEnabled||raw.status!=='published'||raw.review?.status!=='cleared'))continue;
   const entry={...raw,collection,...(raw.categories.includes('psychopompia')?{psychopompiaPublished:raw.status==='published'}:{}),...(collection==='philosophers'?{image:artwork[raw.id],translationVersion:raw.translationVersion??source.translationVersion}:{} )};
   const allowed=['id','collection','categories','title','body','language','sources','image','aphrodisiaTheme','requiresAdult','subcategories','containsAlcohol','review','editorialContext','psychopompiaPublished','contentVersion','translationVersion','topics','schedule','status','timeOfDay','priority'];
   items.push(Object.fromEntries(allowed.filter(key=>entry[key]!==undefined).map(key=>[key,entry[key]])));
  }
 }
 const source=Buffer.from(JSON.stringify({protocol:1,policyVersion:policy.policyVersion,items}));
 if(source.length>8*1024*1024)throw new Error('ADVICE_PUBLIC_SIZE_INVALID');
 const sha256=createHash('sha256').update(source).digest('hex'),path=`advice-catalogues/v1/metadata.${sha256}.json`;
 return{source,pin:{protocol:1,sha256,bytes:source.length,path}};
}

export function verifyAdvicePublicPins(actual,pins){
 const names=['bytes','kind','language','path','sha256','version'];
 const rows=value=>{
  if(!value||value.protocol!==1||Object.keys(value).sort().join(',')!=='catalogues,protocol'||!Array.isArray(value.catalogues))throw new Error('ADVICE_PUBLIC_PINS_INVALID');
  return value.catalogues.map(row=>{
   if(!row||Object.keys(row).sort().join(',')!==names.join(','))throw new Error('ADVICE_PUBLIC_PINS_INVALID');
   return JSON.stringify(names.map(name=>row[name]));
  }).sort();
 };
 if(JSON.stringify(rows(actual))!==JSON.stringify(rows(pins)))throw new Error('ADVICE_PUBLIC_EDITION_CHANGED_USE_A_NEW_VERSION');
}

/** Only pre-existing public editorial text. The exact source bytes are retained
 * at content-addressed URLs; neither account state nor selections are inputs. */
export function collectAdvicePublicAssets(root){
 const assets=[],catalogues=[];
 for(const [kind,directory]of Object.entries(roots)){
  for(const version of readdirSync(join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(!version.isDirectory()||!/^[-a-z0-9]{1,80}$/.test(version.name))throw new Error('ADVICE_PUBLIC_VERSION_INVALID');
   const files=readdirSync(join(root,directory,version.name)).sort();
   if(JSON.stringify(files)!==JSON.stringify(advicePublicLanguages.map(language=>language+'.json').sort()))throw new Error('ADVICE_PUBLIC_LANGUAGE_MISSING');
   for(const language of advicePublicLanguages){
    const source=readFileSync(join(root,directory,version.name,language+'.json'));
    if(source.length<2||source.length>8*1024*1024)throw new Error('ADVICE_PUBLIC_SIZE_INVALID');
    const value=JSON.parse(source.toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length<1||Object.keys(value).length>10000)throw new Error('ADVICE_PUBLIC_CONTENT_INVALID');
    for(const [id,text]of Object.entries(value)){
     const fields=kind==='philosophers'?['body','sources','title']:['body','title'];
     if(!/^advice-[a-f0-9]{24}$/.test(id)||!text||typeof text!=='object'||Array.isArray(text)||JSON.stringify(Object.keys(text).sort())!==JSON.stringify(fields)
      ||typeof text.title!=='string'||text.title.length>2000||typeof text.body!=='string'||!text.body.trim()||text.body.length>100000)throw new Error('ADVICE_PUBLIC_CONTENT_INVALID');
     if(kind==='philosophers'&&(!Array.isArray(text.sources)||text.sources.length>20||text.sources.some(row=>!row||typeof row!=='object'||Array.isArray(row)
      ||Object.keys(row).some(key=>!['kind','author','work','reference','url'].includes(key))||!['quote','inspired'].includes(row.kind)
      ||['author','work','reference','url'].some(key=>row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>2000))
      ||row.url&&!/^https?:\/\/[^\s]+$/u.test(row.url))))throw new Error('ADVICE_PUBLIC_CONTENT_INVALID');
    }
    const sha256=createHash('sha256').update(source).digest('hex');
    const fileName=`advice-catalogues/v1/${kind}/${version.name}/${language}.${sha256}.json`;
    assets.push({fileName,source});catalogues.push({kind,version:version.name,language,sha256,bytes:source.length,path:fileName});
   }
  }
 }
 const manifest={protocol:1,catalogues};
 verifyAdvicePublicPins(manifest,JSON.parse(readFileSync(join(root,'contracts/public-advice-editions-v1.json'),'utf8')));
 assets.push({fileName:'advice-catalogues/v1/manifest.json',source:JSON.stringify(manifest)});
 const metadata=collectAdviceSelectionMetadata(root),pin=JSON.parse(readFileSync(join(root,'contracts/public-advice-metadata-v1.json'),'utf8'));
 if(JSON.stringify(pin)!==JSON.stringify(metadata.pin))throw new Error('ADVICE_PUBLIC_METADATA_CHANGED_UPDATE_PIN');
 assets.push({fileName:metadata.pin.path,source:metadata.source});
 return{assets,manifest};
}

/** JSON files are lazy public downloads, never added to offline shell precache
 * or to the native APK. A missing historical edition fails the build. */
export function advicePublicAssets(root){
 return{name:'genesis-public-advice-editions',apply:'build',generateBundle(){
  for(const asset of collectAdvicePublicAssets(root).assets)this.emitFile({type:'asset',...asset});
 }};
}

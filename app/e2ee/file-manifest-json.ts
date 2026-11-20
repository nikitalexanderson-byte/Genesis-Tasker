/** Strict small private-file JSON, including decoded duplicate names. This is
 * syntax/resource validation before projecting the authenticated body; private
 * filenames preserve original UTF16 units. No crypto or IO capability exists. */
export function parseE2eeFileManifestJson(bytes:Uint8Array):unknown{
 const invalid=():never=>{throw new Error('E2EE_CORRUPT_FILE');};
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>256*1024)invalid();
 try{
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);let at=0,nodes=0;
  const whitespace=()=>{while(at<text.length&&' \t\r\n'.includes(text[at]))at++;};
  const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
  const string=(name:boolean)=>{
   if(text[at++]!=='"')invalid();let value='',length=0;
   while(at<text.length){
    let char=text[at++];if(char==='"')return value;if(char.charCodeAt(0)<32)invalid();
    if(char==='\\'){
     const escape=text[at++];
     if(escape==='u'){const hex=text.slice(at,at+4);if(!/^[0-9a-fA-F]{4}$/.test(hex))invalid();at+=4;char=String.fromCharCode(Number.parseInt(hex,16));}
     else{if(!Object.hasOwn(escapes,escape))return invalid();char=escapes[escape];}
    }
    if(++length>(name?64:512))invalid();if(name)value+=char;
   }
   return invalid();
  };
  function value(depth:number):void{
   if(depth>16||++nodes>10000)invalid();whitespace();const char=text[at];
   if(char==='{'){
    at++;whitespace();const names=new Set<string>();if(text[at]==='}'){at++;return;}
    while(true){whitespace();const name=string(true);if(names.size>=128||names.has(name))invalid();names.add(name);whitespace();if(text[at++]!==':')invalid();value(depth+1);whitespace();
     const end=text[at++];if(end==='}')return;if(end!==',')invalid();}
   }
   if(char==='['){at++;whitespace();if(text[at]===']'){at++;return;}while(true){value(depth+1);whitespace();const end=text[at++];if(end===']')return;if(end!==',')invalid();}}
   if(char==='"'){string(false);return;}
   for(const literal of ['true','false','null'])if(text.startsWith(literal,at)){at+=literal.length;return;}
   number.lastIndex=at;const match=number.exec(text);if(!match||match[0].length>32)invalid();at=number.lastIndex;
  }
  value(0);whitespace();if(at!==text.length)invalid();const parsed:unknown=JSON.parse(text);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))invalid();return parsed;
 }catch{return invalid();}
}

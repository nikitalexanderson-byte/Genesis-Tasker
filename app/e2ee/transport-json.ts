// Dependency-free wire preflight. Keep private-file/legacy policies separate.
// These limits are mirrored by native E2eeHttpResponseJson. The route byte
// budget is checked before this function; value strings may fill that budget.
const maximumDepth=40,maximumNodes=250000,maximumMembers=10000,maximumKey=1024,maximumNumber=128;
const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
export function parseE2eeTransportJson(text:string):Record<string,unknown>{
 const invalid=():never=>{throw new Error('E2EE_INVALID_RESPONSE');};
 let at=0,nodes=0;
 const whitespace=()=>{while(at<text.length&&' \t\r\n'.includes(text[at]))at++;};
 function string(name:boolean):string{
  if(text[at++]!=='"')return invalid();let decoded='',length=0;
  while(at<text.length){
   let char=text[at++];if(char==='"')return decoded;
   if(char.charCodeAt(0)<32)invalid();
   if(char==='\\'){
    if(at===text.length)invalid();const escape=text[at++];
    if(escape==='u'){
     if(at+4>text.length)invalid();let code=0;
     for(let count=0;count<4;count++){
      const hex=text.charCodeAt(at++),digit=hex>=48&&hex<=57?hex-48:hex>=65&&hex<=70?hex-55:hex>=97&&hex<=102?hex-87:-1;
      if(digit<0)invalid();code=(code<<4)|digit;
     }
     char=String.fromCharCode(code);
    }else{
     if(!Object.hasOwn(escapes,escape))invalid();char=escapes[escape];
    }
   }
   if(name){if(++length>maximumKey)invalid();decoded+=char;}
  }
  return invalid();
 }
 function number(){
  const start=at,digit=()=>at<text.length&&text[at]>='0'&&text[at]<='9';
  const advance=()=>{at++;if(at-start>maximumNumber)invalid();};
  if(text[at]==='-')advance();
  if(text[at]==='0')advance();else{if(!digit())invalid();while(digit())advance();}
  if(text[at]==='.') {advance();if(!digit())invalid();while(digit())advance();}
  if(text[at]==='e'||text[at]==='E'){advance();if(text[at]==='+'||text[at]==='-')advance();if(!digit())invalid();while(digit())advance();}
  if(!Number.isFinite(Number(text.slice(start,at))))invalid();
 }
 function value(depth:number):void{
  if(depth>maximumDepth||++nodes>maximumNodes)invalid();whitespace();if(at===text.length)invalid();
  switch(text[at]){
   case '{':{
    at++;whitespace();const names=new Set<string>();if(text[at]==='}'){at++;return;}
    for(;;){
     whitespace();const name=string(true);if(names.size>=maximumMembers||names.has(name))invalid();names.add(name);
     whitespace();if(text[at++]!==':')invalid();value(depth+1);whitespace();
     const separator=text[at++];if(separator==='}')return;if(separator!==',')invalid();
    }
   }
   case '[':
    at++;whitespace();if(text[at]===']'){at++;return;}
    for(;;){value(depth+1);whitespace();const separator=text[at++];if(separator===']')return;if(separator!==',')invalid();}
   case '"':string(false);return;
   default:
    for(const literal of ['true','false','null'])if(text.startsWith(literal,at)){at+=literal.length;return;}
    number();
  }
 }
 whitespace();if(text[at]!=='{')invalid();value(0);whitespace();if(at!==text.length)invalid();
 try{return JSON.parse(text) as Record<string,unknown>;}catch{return invalid();}
}

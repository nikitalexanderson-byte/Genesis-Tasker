// Owned loopback fixtures only. No real account/backend mutation is exposed.
import http from 'node:http';
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/readback-stream-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const block=Buffer.alloc(65536),expected=[];
try{for(const[index,size]of [4*1024*1024,3,3].entries()){const hash=createHash('sha256');for(let at=0;at<block.length;at++)block[at]=(at*31+index*17)&255;
 for(let at=0;at<size;at+=block.length)hash.update(block.subarray(0,Math.min(block.length,size-at)));expected.push(hash.digest('base64url'));}}finally{block.fill(0);}
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS bounded readback</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/expected.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(expected));return;}
 if(path.startsWith('/http/')){
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(path==='/http/utf8'){response.end(JSON.stringify({fixture:'α😀ёж'}));return;}
  if(path==='/http/declared-large'){const size=256*1024+1;response.setHeader('Content-Length',String(size));response.end(' '.repeat(size));return;}
  if(path==='/http/actual-large'){const block=Buffer.alloc(65536,32);for(let index=0;index<6;index++)response.write(block);response.end();return;}
  if(path==='/http/error'){response.statusCode=503;response.setHeader('Content-Type','text/html');response.end('<html>synthetic unavailable</html>');return;}
  if(path==='/http/bad-utf8'){response.end(Buffer.from([123,34,120,34,58,34,0xc3,34,125]));return;}
 }
 response.writeHead(path==='/favicon.ico'?204:404).end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));

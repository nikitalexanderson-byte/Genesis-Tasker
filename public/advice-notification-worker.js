/* Advice bodies are loaded only after cookie authentication and current preference/age checks. */
const ADVICE_PUSH_SCOPE=self.registration.scope;
const ADVICE_PUSH_RECEIPTS="genesis-advice-push-receipts-v1";
let advicePushChain=Promise.resolve();
let advicePushReceived=0;
self.addEventListener("push",event=>{
  let id;try{const payload=event.data?.json();if(payload?.channel!=="advice")return;id=payload.deliveryId;}catch{return;}
  if(typeof id!=="string"||!/^[a-f0-9-]{36}$/.test(id))return;
  const receive=async()=>{
    const receipts=await caches.open(ADVICE_PUSH_RECEIPTS),receiptUrl=new URL("./__advice-push-receipt/"+id,ADVICE_PUSH_SCOPE).href;
    if(await receipts.match(receiptUrl))return;
    const response=await fetch(new URL("./api/advice/notifications/deliveries/"+encodeURIComponent(id),ADVICE_PUSH_SCOPE).href,{credentials:"include",cache:"no-store"});
    if(!response.ok)return;const result=await response.json(),message=result.message;
    if(!result.displayAllowed||!message||message.deliveryId!==id||typeof message.body!=="string"||typeof result.userId!=="string")return;
    const target=new URL(message.url,ADVICE_PUSH_SCOPE),scope=new URL(ADVICE_PUSH_SCOPE);
    if(target.origin!==scope.origin||!target.pathname.startsWith(scope.pathname))return;
    if(!/^advice-[a-f0-9]{24}$/.test(target.searchParams.get("advice")??"")||!/^\d{4}-\d{2}-\d{2}$/.test(target.searchParams.get("adviceDay")??"")
      ||!["aurora","philosophers"].includes(target.searchParams.get("adviceCollection")))return;
    await self.registration.showNotification(typeof message.title==="string"?message.title:"GENESIS",{body:message.body,lang:message.lang,
      tag:"genesis-advice-"+id,renotify:false,data:{url:target.href,adviceDeliveryId:id,userId:result.userId}});
    await receipts.put(receiptUrl,new Response(JSON.stringify({receivedAt:Date.now()}),{headers:{"Content-Type":"application/json"}}));
    if(++advicePushReceived%50===0)for(const key of await receipts.keys()){
      const old=await receipts.match(key);let receivedAt;try{receivedAt=(await old.json()).receivedAt;}catch{continue;}
      if(typeof receivedAt==="number"&&receivedAt<Date.now()-172800000)await receipts.delete(key);
    }
  };
  advicePushChain=advicePushChain.catch(()=>undefined).then(receive).catch(()=>undefined);event.waitUntil(advicePushChain);
});

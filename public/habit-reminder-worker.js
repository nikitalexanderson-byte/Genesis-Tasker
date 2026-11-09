/* Personal reminders contain only scoped IDs. Private habit content is never fetched by this worker. */
(() => {
  const scope=self.registration.scope, origin=new URL(scope).origin;
  const storeName="genesis-habit-push-receipts-v1";
  const key=(kind,id)=>new URL(`./__habit-${kind}/${encodeURIComponent(id)}`,scope).href;
  let chain=Promise.resolve();
  const read=async(kind,id)=>{const response=await(await caches.open(storeName)).match(key(kind,id));return response?response.json():null;};
  const write=async(kind,id,value)=>(await caches.open(storeName)).put(key(kind,id),new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}}));
  const access=async id=>{
    const response=await fetch(new URL(`./api/habit-reminders/deliveries/${encodeURIComponent(id)}`,scope),{credentials:"include",cache:"no-store"});
    if(!response.ok)throw Error("HABIT_REMINDER_UNAVAILABLE");return response.json();
  };
  self.addEventListener("push",event=>{
    let payload;try{payload=event.data?.json();}catch{return;}
    if(payload?.channel!=="habit"||typeof payload.deliveryId!=="string"||!/^[a-f0-9-]{36}$/.test(payload.deliveryId))return;
    const receive=async()=>{
      const id=payload.deliveryId;if(await read("receipt",id))return;
      const value=await access(id), message=value.message;
      if(!value.displayAllowed||message?.deliveryId!==id||typeof message.body!=="string")return;
      const eventKey=`${value.userId}:${value.receiptKey}`;
      const recorded=await read("event",eventKey);
      if(recorded&&(recorded.state==="delivered"||recorded.receivedAt>Date.now()-120000))return;
      const url=new URL(message.url,scope);if(url.origin!==origin||!url.pathname.startsWith(new URL(scope).pathname))return;
      const actions=message.kind==="habit"?[{action:"primary",title:message.primaryLabel},{action:"snooze",title:message.snoozeLabel}]:[];
      await write("event",eventKey,{state:"reserved",receivedAt:Date.now()});
      try{await self.registration.showNotification("GENESIS",{body:message.body,lang:message.lang,tag:`genesis-habit-${id}`,renotify:false,actions,
        icon:new URL("./mindmap-icons/repeat-2.png",scope).href,data:{habitDeliveryId:id,userId:value.userId,url:url.href}});}
      catch(error){await(await caches.open(storeName)).delete(key("event",eventKey));throw error;}
      await write("event",eventKey,{state:"delivered",receivedAt:Date.now()});
      await write("receipt",id,{receivedAt:Date.now()});
      const cache=await caches.open(storeName);
      for(const entry of await cache.keys()){
        const response=await cache.match(entry);let record;try{record=await response.json();}catch{continue;}
        if(record.receivedAt<Date.now()-7*86400000)await cache.delete(entry);
      }
    };
    chain=chain.catch(()=>undefined).then(receive).catch(()=>undefined);event.waitUntil(chain);
  });
  self.addEventListener("message",event=>{
    const data=event.data, port=event.ports?.[0];
    if(!data||!port||!event.source?.url||new URL(event.source.url).origin!==origin||!new URL(event.source.url).pathname.startsWith(new URL(scope).pathname))return;
    if(data.type==="GENESIS_HABIT_EVENT_RECEIPT"){
      if(typeof data.userId!=="string"||typeof data.key!=="string"||!/^[a-f0-9]{64}$/.test(data.key))return;
      const eventKey=`${data.userId}:${data.key}`;
      const act=async()=>{
        const previous=await read("event",eventKey);
        if(data.action==="reserve"){
          if(previous&&(previous.state==="delivered"||previous.receivedAt>Date.now()-120000)){port.postMessage(false);return;}
          await write("event",eventKey,{state:"reserved",receivedAt:Date.now()});
        }else if(data.action==="commit")await write("event",eventKey,{state:"delivered",receivedAt:Date.now()});
        else if(data.action==="release"&&previous?.state==="reserved")await(await caches.open(storeName)).delete(key("event",eventKey));
        port.postMessage(true);
      };
      chain=chain.catch(()=>undefined).then(act).catch(()=>port.postMessage(false));event.waitUntil(chain);return;
    }
    if(data.type!=="GENESIS_HABIT_INTENT"&&data.type!=="GENESIS_HABIT_INTENT_ACK")return;
    event.waitUntil((async()=>{
      const intent=typeof data.id==="string"?await read("intent",data.id):null;
      if(!intent||intent.userId!==data.userId||intent.receivedAt<Date.now()-86400000){port.postMessage(null);return;}
      if(data.type==="GENESIS_HABIT_INTENT_ACK")await(await caches.open(storeName)).delete(key("intent",data.id));
      port.postMessage(data.type==="GENESIS_HABIT_INTENT"?intent:{ok:true});
    })().catch(()=>port.postMessage(null)));
  });
  self.addEventListener("notificationclick",event=>{
    const data=event.notification.data||{};
    if(!data.habitDeliveryId&&!data.habitTarget)return;
    event.notification.close();
    event.waitUntil((async()=>{
      if(event.action==="snooze"&&data.habitDeliveryId){
        try{
          const sessionResponse=await fetch(new URL("./api/session",scope),{credentials:"include",cache:"no-store"});
          const session=await sessionResponse.json();if(session.user?.uid!==data.userId)throw Error("ACCOUNT_CHANGED");
          const response=await fetch(new URL(`./api/habit-reminders/deliveries/${encodeURIComponent(data.habitDeliveryId)}/snooze`,scope),
            {method:"POST",credentials:"include",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrf},body:"{}"});
          if(response.ok)return;
        }catch{/* Open the app with a retryable scoped intent. */}
      }
      const id=crypto.randomUUID();
      await write("intent",id,{userId:data.userId,deliveryId:data.habitDeliveryId,target:data.habitTarget,action:event.action||"open",receivedAt:Date.now()});
      const url=new URL("./#habits",scope);url.searchParams.set("habitIntent",id);
      const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      const client=clients.find(item=>new URL(item.url).origin===origin&&new URL(item.url).pathname.startsWith(new URL(scope).pathname));
      if(client&&"focus"in client){await client.focus();if("navigate"in client)await client.navigate(url.href);}
      else await self.clients.openWindow(url.href);
    })());
  });
})();

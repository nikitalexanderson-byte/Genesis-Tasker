import { privateDeviceAccessBlocked } from "./local-sign-out.ts";
export type WebReminderKind="task"|"habit";
export const WEB_REMINDER_EVENT="genesis:web-reminder";
let audio:AudioContext|null=null;
const buffers:Partial<Record<WebReminderKind,AudioBuffer>>={};
export function unlockReminderAudio(appBase:string) {
 if(typeof window==="undefined"||typeof window.AudioContext!=="function")return;
 const unlock=()=>{if(privateDeviceAccessBlocked())return;audio??=new AudioContext();void audio.resume().catch(()=>{});
  for(const kind of ["task","habit"] as const)if(!buffers[kind])void fetch(`${appBase}/sounds/${kind}.wav`).then(response=>{if(!response.ok)throw Error("Sound unavailable");return response.arrayBuffer();}).then(bytes=>audio!.decodeAudioData(bytes)).then(buffer=>{buffers[kind]=buffer;}).catch(()=>{});
 };
 window.addEventListener("pointerdown",unlock,{once:true});window.addEventListener("keydown",unlock,{once:true});
 return ()=>{window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};
}
export function presentWebReminder(kind:WebReminderKind,title:string,body:string):boolean {
 if(privateDeviceAccessBlocked())return false;
 window.dispatchEvent(new CustomEvent(WEB_REMINDER_EVENT,{detail:{kind,title,body}}));
 if(!audio||audio.state!=="running"||!buffers[kind])return false;
 try{const source=audio.createBufferSource();source.buffer=buffers[kind]!;const gain=audio.createGain();gain.gain.value=.55;source.connect(gain);gain.connect(audio.destination);source.start();return true;}catch{return false;}
}

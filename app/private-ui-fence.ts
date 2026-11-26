/** Shared ownership keeps a handoff between security dialogs from restoring
 * the editor while another dialog still requires a frozen workspace. */
let held:{count:number;content:HTMLElement|null;inert:boolean;hidden:string|null;body:HTMLElement;overflow:string}|null=null;
export function holdPrivateEditorFence(){
 if(!held){const content=document.getElementById('genesis-app-content'),body=document.body;
  held={count:0,content,inert:content?.inert??false,hidden:content?.getAttribute('aria-hidden')??null,body,overflow:body.style.overflow};
 }
 const lease=held;lease.count++;if(lease.content){lease.content.inert=true;lease.content.setAttribute('aria-hidden','true');}lease.body.style.overflow='hidden';
 let released=false;return()=>{if(released)return;released=true;if(--lease.count!==0)return;
  if(lease.content){lease.content.inert=lease.inert;if(lease.hidden===null)lease.content.removeAttribute('aria-hidden');else lease.content.setAttribute('aria-hidden',lease.hidden);}
  lease.body.style.overflow=lease.overflow;if(held===lease)held=null;
 };
}

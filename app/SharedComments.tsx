"use client";
import { useEffect, useRef, useState } from "react";
import type { SharedComment, SharedMember } from "./cloud-sync";
import { translateText } from "./i18n";

export function SharedComments({comments,members,english,canComment,busy,onSubmit,highlightedId="",active:visible=true}:{comments:SharedComment[];members:SharedMember[];english:boolean;canComment:boolean;busy:boolean;onSubmit:(body:string,ids:string[])=>Promise<void>;highlightedId?:string;active?:boolean}) {
  const highlighted = useRef<HTMLElement>(null);
  const located = useRef("");
  useEffect(() => {
    if (!visible || !highlightedId || located.current === highlightedId || !comments.some(comment => comment.id === highlightedId)) return;
    const frame = requestAnimationFrame(() => { if (!highlighted.current) return; located.current = highlightedId; highlighted.current.scrollIntoView({block:"center",behavior:"auto"}); highlighted.current.focus({preventScroll:true}); });
    return () => cancelAnimationFrame(frame);
  }, [visible, highlightedId, comments]);
  const [body,setBody]=useState("");const [mentions,setMentions]=useState<Record<string,string>>({});
  const [token,setToken]=useState<{start:number;end:number;query:string}|null>(null);const [active,setActive]=useState(0);
  const input=useRef<HTMLTextAreaElement>(null);
  const choices=token ? members.filter(member=>member.displayName && member.displayName.toLocaleLowerCase().includes(token.query.toLocaleLowerCase())).slice(0,8) : [];
  const detect=(value:string,caret:number)=>{const match=/(?:^|\s)@([^@\n]{0,60})$/.exec(value.slice(0,caret));setToken(match ? {start:caret-match[1].length-1,end:caret,query:match[1]} : null);setActive(0);};
  const choose=(member:SharedMember)=>{if(!token)return;const text=`@${member.displayName} `;setBody(body.slice(0,token.start)+text+body.slice(token.end));setMentions(value=>({...value,[member.userId]:member.displayName}));setToken(null);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(token.start+text.length,token.start+text.length);});};
  const renderBody=(comment:SharedComment)=>{
    const names=(comment.mentionIds||[]).map(id=>members.find(member=>member.userId===id)?.displayName).filter((name):name is string=>Boolean(name));
    if(!names.length)return comment.body;
    const escaped=names.sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    return comment.body.split(new RegExp(`(@(?:${escaped.join("|")})(?![\\p{L}\\p{N}_]))`,"u")).map((part,index)=>names.some(name=>part===`@${name}`) ? <mark key={index}>{part}</mark> : part);
  };
  return <section className="shared-task-comments" aria-labelledby="shared-comments-heading"><h3 id="shared-comments-heading">{english ? "Comments" : "Комментарии"} · {comments.length}</h3>
    <div className="shared-comment-list">{comments.map(comment=><article key={comment.id} data-comment-id={comment.id} ref={comment.id===highlightedId?highlighted:undefined} tabIndex={-1} className={comment.id===highlightedId?"task-location-highlight":undefined}><header><strong data-no-translate>{comment.authorName}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(english ? "en" : "ru",{dateStyle:"short",timeStyle:"short"}).format(new Date(comment.createdAt))}</time></header>{comment.importedAuthorName!==undefined?<small>{translateText('Импортировано. Автор источника')}: <span data-no-translate>{comment.importedAuthorName}</span></small>:null}<p data-no-translate>{renderBody(comment)}</p></article>)}</div>
    {!comments.length ? <p>{english ? "Start the discussion here." : "Обсудите задачу здесь."}</p> : null}
    {canComment ? <form onSubmit={event=>{event.preventDefault();const ids=Object.entries(mentions).filter(([,name])=>new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![\\p{L}\\p{N}_])`,"u").test(body)).map(([id])=>id);void onSubmit(body,ids).then(()=>{setBody("");setMentions({});setToken(null);}).catch(()=>undefined);}}>
      <label>{english ? "Comment · @ to mention a teammate" : "Комментарий · @ для упоминания коллеги"}<textarea ref={input} value={body} maxLength={5000} required aria-controls={choices.length ? "shared-mention-choices" : undefined} aria-activedescendant={choices.length ? `shared-mention-${active}` : undefined}
        onChange={event=>{setBody(event.target.value);detect(event.target.value,event.target.selectionStart);}} onClick={event=>detect(event.currentTarget.value,event.currentTarget.selectionStart)} onKeyDown={event=>{
          if(event.key==="Escape" && token){event.preventDefault();event.stopPropagation();setToken(null);}
          if(!choices.length)return;
          if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setActive(value=>(value+(event.key==="ArrowDown" ? 1 : -1)+choices.length)%choices.length);}
          if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();choose(choices[active]||choices[0]);}
        }}/></label>
      {choices.length ? <div className="shared-mention-choices" id="shared-mention-choices" role="listbox" aria-label={english ? "Teammates" : "Коллеги"}>{choices.map((member,index)=><button type="button" role="option" aria-selected={index===active} id={`shared-mention-${index}`} key={member.userId} onClick={()=>choose(member)} data-no-translate>{member.displayName}</button>)}</div> : null}
      <button type="submit" className="primary-button" disabled={busy||!body.trim()}>{english ? "Send comment" : "Отправить комментарий"}</button>
    </form> : null}
  </section>;
}

"use client";
import {useEffect,useState} from "react";
import {loadSharedReviewSettings,saveSharedReviewSettings,type SharedReviewSettingsData,type SharedReviewKind,type SharedReviewPolicy} from "./cloud-sync";
import "./shared-review.css";
const labels={checked:"Кто проверяет выполнение",confirmed:"Кто подтверждает выполнение",deletable:"Кто разрешает удаление"};
const kinds:SharedReviewKind[]=["checked","confirmed","deletable"];
export function SharedReviewSettings({projectId}:{projectId:string}) {
 const [data,setData]=useState<SharedReviewSettingsData|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [saved,setSaved]=useState(false);
 useEffect(()=>{let live=true;void loadSharedReviewSettings(projectId).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[projectId]);
 const change=(policy:SharedReviewPolicy)=>{setData(current=>current?{...current,policy}:current);setSaved(false);};
 return <section className="shared-review-settings"><h3>Проверка выполненных задач</h3>
 {data?<><p>Правила основного проекта применяются и к его подпроектам.</p><p data-no-translate>{data.rootTitle}</p>
 <fieldset disabled={busy||!data.canManage}><label><input type="checkbox" checked={data.policy.enabled} onChange={event=>change({...data.policy,enabled:event.target.checked})}/>Включить проверку выполненных задач</label>
 {kinds.map(kind=><div key={kind}><label>{labels[kind]}<select disabled={!data.policy.enabled} value={data.policy[kind].group} onChange={event=>change({...data.policy,[kind]:{...data.policy[kind],group:event.target.value}})}>
 <option value="everyone">Все участники проекта</option><option value="editors">Участники с правом редактирования</option><option value="organizers">Организаторы и администраторы</option><option value="selected">Выбранные участники</option></select></label>
 {data.policy[kind].group==="selected"?<fieldset disabled={!data.policy.enabled}><legend>Выберите участников</legend>{data.members.map(member=><label key={member.userId}><input type="checkbox" checked={data.policy[kind].userIds.includes(member.userId)} onChange={event=>change({...data.policy,[kind]:{...data.policy[kind],userIds:event.target.checked?[...data.policy[kind].userIds,member.userId]:data.policy[kind].userIds.filter(id=>id!==member.userId)}})}/><span data-no-translate>{member.displayName}</span></label>)}</fieldset>:null}</div>)}
 <button type="button" onClick={async()=>{setBusy(true);setError("");try{setData(await saveSharedReviewSettings(data.rootProjectId,data.policy,data.revision));setSaved(true);window.dispatchEvent(new Event("genesis:shared-updates"));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>Сохранить правила проверки</button></fieldset>
 {!data.canManage?<p>Настройки изменяет администратор основного проекта.</p>:null}{saved?<p role="status">Правила проверки сохранены.</p>:null}</>:<p role="status">Загрузка…</p>}{error?<p role="alert">{error}</p>:null}
 </section>;
}

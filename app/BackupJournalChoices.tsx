import {useState} from 'react';
import type {BackupJournalChoices,BackupJournalConflict} from './backup-private-journals';

type Props={groups:BackupJournalConflict[];choices:BackupJournalChoices;disabled:boolean;
  onChange:(value:BackupJournalChoices)=>void;c:(ru:string,english:string)=>string};
function excerpt(document:unknown):string {
  if(!document||typeof document!=='object'||Array.isArray(document))return '';
  const value=document as Record<string,unknown>;
  for(const row of Array.isArray(value.sessions)?value.sessions:[]){
    if(!row||typeof row!=='object')continue;
    for(const field of ['observationNote','goalText'])if(typeof row[field]==='string'&&row[field])return row[field];
  }
  for(const row of Array.isArray(value.works)?value.works:[])if(typeof row?.snapshot?.reflection==='string')return row.snapshot.reflection;
  return '';
}
/** Decisions exist only in this mounted recovery UI. The restore adapter checks
 * their source and variant digests again before generating any operations. */
export function BackupJournalChoicesPanel({groups,choices,disabled,onChange,c}:Props){
  const [expanded,setExpanded]=useState<string|null>(null);
  if(!groups.length)return null;
  return <div className="backup-journal-choices">
    <h4>{c('Выберите сохранённый вариант','Choose a saved version')}</h4>
    <p>{c('В архиве есть разные черновики. Сравните их и выберите вариант для восстановления. Остальные варианты останутся в исходном зашифрованном файле.','The archive contains different drafts. Compare them and choose a version to restore. The other versions will remain in the original encrypted file.')}</p>
    {groups.map(group=><fieldset key={group.section} disabled={disabled}>
      <legend>{group.section==='aurora'?c('Гно Метэр Басилея','Gno Meter Basileia'):c('Практики','Practices')}</legend>
      {group.variants.map((variant,index)=>{
        const id=`${group.section}:${variant.hash}`,note=excerpt(variant.document);
        return <div key={variant.hash} className="backup-variant">
          <label className="backup-check" htmlFor={`backup-variant-${id}`}>
            <input id={`backup-variant-${id}`} type="radio" name={`backup-variant-${group.section}`} checked={choices[group.section]?.variantHash===variant.hash}
              onChange={()=>onChange({...choices,[group.section]:{sourceHash:group.sourceHash,variantHash:variant.hash}})}/>
            <span className="backup-variant-label">{c('Вариант {number}','Version {number}').replace('{number}',String(index+1))}<span className="backup-variant-kind">{variant.latest?c('Последний черновик','Latest draft'):c('Ранний снимок','Earlier snapshot')}</span></span>
          </label>
          {note?<p className="backup-variant-note" data-no-translate>{note}</p>:null}
          <details open={expanded===id} onToggle={event=>{if(event.currentTarget.open)setExpanded(id);else if(expanded===id)setExpanded(null);}}>
            <summary>{c('Посмотреть данные варианта','View version contents')}</summary>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus enables keyboard scrolling of the complete archive version. */}
            {expanded===id?<pre tabIndex={0} data-no-translate>{JSON.stringify(variant.document,null,2)}</pre>:null}
          </details>
        </div>;
      })}
    </fieldset>)}
  </div>;
}

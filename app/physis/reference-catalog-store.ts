import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { physisRequest } from '../cloud-sync';
import { mergeCatalog, type CatalogOverride, type CatalogItem, type ReferenceCatalog } from './reference-catalog-domain';
type Transport = <T>(path:string, init?:RequestInit)=>Promise<T>;
export function useReferenceCatalog(owner: string, request: Transport = physisRequest): ReferenceCatalog {
  const [overrides,setOverrides]=useState<CatalogOverride[]>([]);
  const [canEdit,setCanEdit]=useState(false);const[loading,setLoading]=useState(true);const[error,setError]=useState('');
  const [loadedOwner,setLoadedOwner]=useState('');
  const generation=useRef(0);
  const reload=useCallback(async()=>{
    const epoch=++generation.current;setLoading(true);setError('');
    try {const result=await request<{overrides:CatalogOverride[];canEdit:boolean}>('/catalog');if(epoch===generation.current){setOverrides(result.overrides);setCanEdit(result.canEdit);setLoadedOwner(owner);}}
    catch {if(epoch===generation.current){setCanEdit(false);setError('Не удалось обновить общий справочник. Проверьте соединение и повторите загрузку.');}}
    finally {if(epoch===generation.current)setLoading(false);}
  },[owner,request]);
  useEffect(()=>{let active=true;const clock=generation;void Promise.resolve().then(()=>{if(active)void reload();});return()=>{active=false;clock.current++;};},[reload]);
  const editable=canEdit&&loadedOwner===owner;
  const save=useCallback(async(entry:CatalogItem,expectedRevision:number)=>{
    if(!editable)throw new Error('Редактирование общего справочника доступно администратору после подключения к серверу.');
    const epoch=generation.current;
    try{
      const result=await request<CatalogOverride>('/catalog',{method:'PUT',body:JSON.stringify({id:entry.id,expectedRevision,entry})});
      if(epoch===generation.current)setOverrides(rows=>[...rows.filter(row=>row.id!==result.id),result]);
    }catch(cause){
      if(cause instanceof Error && cause.message.includes('PHYSIS_CATALOG_CONFLICT')){await reload();throw new Error('Карточка уже изменена в другой вкладке. Ваш текст сохранён в форме. Закройте её и откройте актуальную карточку перед повторным сохранением.');}
      if(cause instanceof Error && cause.message.includes('PHYSIS_CATALOG_INVALID'))throw new Error('Проверьте обязательные поля, дату и ссылки на источники. Допускается до 32 дополнительных категорий по 80 символов и 16 ссылок.');
      if(cause instanceof Error && cause.message.includes('PHYSIS_CATALOG_ADMIN_REQUIRED')){setCanEdit(false);throw new Error('Права администратора больше не доступны. Обновите справочник после входа.');}
      throw cause;
    }
  },[editable,request,reload]);
  return {entries:useMemo(()=>mergeCatalog(overrides),[overrides]),canEdit:editable,loading,error,reload,save};
}

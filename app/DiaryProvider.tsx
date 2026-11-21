"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,useSyncExternalStore, type ReactNode } from 'react';
import { PERSONAL_DOCUMENT_READY_EVENT,usesPrivateProductStorage } from './cloud-sync';
import {privateAccountView,subscribePrivateAccount} from './e2ee/product-session';
import { DiaryRepository, type DiaryRecord, type DiaryEditorCapture } from './diary-storage';
import { reactToAdvice, type DiaryNote } from './diary-model';
import type { DailyAdvice } from './daily-advice';
import { DEFAULT_DREAM_SETTINGS, type DreamSettings } from './dream-journal-model';
import {usePersonalMigrationSource} from './use-personal-migration-source';

type State = { records: DiaryRecord[]; loading: boolean; error: boolean; offline: boolean; syncEnabled: boolean; pendingUploads: number; dreamSettings: DreamSettings;localHistory:'present'|'not-on-this-device'|null };
type Context = State & { busy: boolean;privateContent:boolean; refresh: () => Promise<void>; save: (note: DiaryNote, record?: DiaryRecord) => Promise<void>;
  registerMigrationEditor:(read:()=>DiaryEditorCapture)=>(()=>void);captureMigration:()=>ReturnType<DiaryRepository['captureMigration']>;
  dreamToday: (zone:string,signal?:AbortSignal)=>Promise<string>; authorizeDreamVoice:()=>Promise<void>;
  remove: (record: DiaryRecord) => Promise<void>; setSyncEnabled: (enabled: boolean) => Promise<void>;
  setDreamTodayMode: (mode: DreamSettings['todayMode']) => Promise<void>; discardEditorDraft: (id: string, key?: string) => Promise<void>;
  react: (advice: DailyAdvice, reaction: 'favorite' | 'dislike') => Promise<void>; keepDraft: (note: DiaryNote, record?: DiaryRecord) => Promise<void>; discard: (key: string) => Promise<void>; discardOwn: (id: string) => Promise<void> };
const DiaryContext = createContext<Context | null>(null);
export function useDiary() { const value = useContext(DiaryContext); if (!value) throw new Error('DIARY_PROVIDER_MISSING'); return value; }

export function DiaryProvider({ userId, ready, children, repositoryOverride }: { userId: string; ready: boolean; children: ReactNode; repositoryOverride?:DiaryRepository }) {
  const vault=useSyncExternalStore(subscribePrivateAccount,privateAccountView,privateAccountView);
  const repository = useMemo(() => repositoryOverride ?? (typeof window !== 'undefined' && userId&&(!usesPrivateProductStorage(userId)||vault.phase==='ready'&&vault.ownerId===userId) ? new DiaryRepository(userId, localStorage) : null), [userId,repositoryOverride,vault]);
  const [state, setState] = useState<State>({ records: [], loading: true, error: false, offline: false, syncEnabled: true, pendingUploads: 0, dreamSettings: DEFAULT_DREAM_SETTINGS,localHistory:null });
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const repositoryLifetime=useRef(0);
  const activeRepository=useRef(repository);activeRepository.current=repository;
  const current=()=>{if(!repository||activeRepository.current!==repository)throw new Error('DIARY_SESSION_CLOSED');};
  usePersonalMigrationSource(repository&&!usesPrivateProductStorage(userId)?userId:null,'diary',()=>{
    if(!repository)throw new Error('DIARY_UNAVAILABLE');
    return{...repository.captureMigration(state.records),settled:!busy&&!state.loading};
  },repository);
  useEffect(()=>{const lifetime=++repositoryLifetime.current;++request.current;setBusy(false);setState({records:[],loading:true,error:false,offline:false,syncEnabled:true,pendingUploads:0,dreamSettings:DEFAULT_DREAM_SETTINGS,localHistory:null});
    return()=>{++request.current;queueMicrotask(()=>{if(!repositoryOverride&&(activeRepository.current!==repository||repositoryLifetime.current===lifetime))repository?.dispose();});};},[repository,repositoryOverride]);
  const registerMigrationEditor=useCallback((read:()=>DiaryEditorCapture)=>{if(!repository)return()=>{};return repository.registerMigrationEditor(read);},[repository]);
  const dreamToday=useCallback(async(zone:string,signal?:AbortSignal)=>{if(!repository)throw new Error('DIARY_UNAVAILABLE');return repository.dreamToday(zone,signal);},[repository]);
  const authorizeDreamVoice=useCallback(async()=>{if(!repository)throw new Error('DIARY_UNAVAILABLE');await repository.authorizeDreamVoice();},[repository]);
  const refresh = useCallback(async () => {
    if (!repository||activeRepository.current!==repository) return;
    const serial = ++request.current;
    try { const records = await repository.list(); if (serial === request.current&&activeRepository.current===repository) setState({ records, loading: false, error: false, offline: repository.offline, syncEnabled: repository.syncEnabled, pendingUploads: repository.pendingUploads, dreamSettings: repository.dreamSettings,localHistory:repository.localHistory }); }
    catch { if (serial === request.current) setState(previous => ({ ...previous, loading: false, error: true })); }
  }, [repository]);
  useEffect(() => {
    if (!ready || !repository) return;
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const update = () => void refresh();
    const timer = window.setTimeout(update, 0); window.addEventListener('online', update); window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT, update);
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearTimeout(timer); window.removeEventListener('online', update); window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT, update); document.removeEventListener('visibilitychange', visible); };
  }, [ready, repository, refresh]);
  const save = async (note: DiaryNote, record?: DiaryRecord) => {
    if (!repository || busy) throw new Error('DIARY_UNAVAILABLE'); setBusy(true); ++request.current;
    try { const { clearedDraftKey, ...saved } = await repository.save(note, record);current();++request.current; setState(previous => ({ ...previous, error: false, offline: repository.offline,
      syncEnabled: repository.syncEnabled, pendingUploads: repository.pendingUploads,
      records: [...previous.records.filter(row => row.draftKey ? row.draftKey !== clearedDraftKey : row.note.id !== note.id), saved] })); }
    catch (error) { await refresh(); throw error; }
    finally { if(activeRepository.current===repository)setBusy(false); }
  };
  return <DiaryContext value={{ ...state, busy,privateContent:usesPrivateProductStorage(userId), refresh, save, dreamToday, authorizeDreamVoice,registerMigrationEditor,
    captureMigration:()=>{if(!repository)throw new Error('DIARY_UNAVAILABLE');return repository.captureMigration(state.records);},
    remove: async record => {
      if (!repository || busy) throw new Error('DIARY_UNAVAILABLE'); setBusy(true); ++request.current;
      try { await repository.remove(record);current();++request.current; setState(previous => ({ ...previous, error: false,
        records: previous.records.filter(row => row.note.id !== record.note.id), pendingUploads: repository.pendingUploads })); }
      catch (error) { await refresh(); throw error; } finally { if(activeRepository.current===repository)setBusy(false); }
    },
    setSyncEnabled: async enabled => {
      if (!repository || busy) throw new Error('DIARY_UNAVAILABLE'); setBusy(true); ++request.current;
      try { const records = await repository.setSyncEnabled(enabled);current();++request.current;
        setState({ records, loading: false, error: false, offline: repository.offline, syncEnabled: repository.syncEnabled, pendingUploads: repository.pendingUploads, dreamSettings: repository.dreamSettings,localHistory:repository.localHistory }); }
      catch (error) { await refresh(); throw error; } finally { if(activeRepository.current===repository)setBusy(false); }
    },
    keepDraft: async (note, record) => { if (!repository) throw new Error('DIARY_UNAVAILABLE'); ++request.current; const draft = await repository.keepDraft(note, record);current();
      setState(previous => ({ ...previous, records: [...previous.records.filter(row => row.draftKey !== draft.draftKey), draft] })); },
    discard: async key => { if(!repository)throw new Error('DIARY_UNAVAILABLE');await repository.discardDraft(key);current();setState(previous => ({ ...previous, records: previous.records.filter(row => row.draftKey !== key) })); },
    discardOwn: async id => { if(!repository)throw new Error('DIARY_UNAVAILABLE');const key = await repository.discardOwnDraft(id);current();setState(previous => ({ ...previous, records: previous.records.filter(row => row.draftKey !== key) })); },
    discardEditorDraft: async (id, key) => {
      if (!repository) throw new Error('DIARY_UNAVAILABLE');
      ++request.current; const keys = await repository.discardEditorDraft(id, key);current();
      setState(previous => ({...previous, records: previous.records.filter(row => !row.draftKey || !keys.includes(row.draftKey))}));
    },
    setDreamTodayMode: async mode => {
      if (!repository || busy) throw new Error('DIARY_UNAVAILABLE'); setBusy(true); ++request.current;
      try { await repository.setDreamTodayMode(mode);current();setState(previous => ({...previous, dreamSettings: repository.dreamSettings})); }
      catch (error) { await refresh(); throw error; } finally { if(activeRepository.current===repository)setBusy(false); }
    },
    react: async (advice, reaction) => {
      if (!repository || state.loading || state.error) throw new Error('DIARY_UNAVAILABLE');
      const id = await repository.adviceId(advice.id);
      const record = state.records.find(row => row.note.id === id && !row.draftKey);
      await save(reactToAdvice(advice, id, reaction, record?.note), record);
    } }}>{children}</DiaryContext>;
}

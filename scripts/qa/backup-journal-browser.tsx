import {createRoot} from 'react-dom/client';
import {BackupPanel,type BackupPanelRuntime} from '../../app/BackupPanel';
import {prepareBackupRestore} from '../../app/backup-restore';
import {sealBackup,type BackupPayload} from '../../app/backup-format';
import {newSession} from '../../app/aurora/session';
import {snapshotFromSavedDraw,expectedSourceDraw} from '../../app/aurora/draw-policy';
import type {FrozenDevice} from '../../app/backup-device';
import type {GenesisUser} from '../../app/cloud-sync';
import '../../app/globals.css';
import '../../app/experimental-theme.css';
import '../../app/dark-theme.css';
import '../../app/dark-palettes.css';
import '../../app/universal-ui.css';
import '../../app/backup-native.css';

// Isolated browser fixture: no production IO, identities, keys or personal files.
const owner='synthetic-backup-owner',now='2026-11-05T09:00:00Z',params=new URL(location.href).searchParams;
const language=params.get('lang')??'en',dark=params.get('theme')==='dark';
document.documentElement.lang=language;document.documentElement.dataset.genesisTheme=dark?'standart-dark':'standart';
const primary=snapshotFromSavedDraw({id:'synthetic-source',seed:123,day:'2026-11-05',createdAt:now,cards:expectedSourceDraw(123)});
const documentFor=(note:string)=>{const session=newSession({id:'synthetic-session',ownerId:owner,now,primary,timezone:'Europe/Moscow'});session.observationNote=note;return{version:1,ownerId:owner,sessions:[session],removed:[]};};
const first=documentFor('An earlier synthetic note'),left=documentFor('Left private draft — choose deliberately'),right=documentFor('Right private draft — keep the other branch in the archive');
const writerA='11111111-1111-4111-8111-111111111111',writerB='22222222-2222-4222-8222-222222222222';
const base={version:1,ownerId:owner,sessions:[],removed:[]};
const payload:BackupPayload={schema:1,backupId:'33333333-3333-4333-8333-333333333333',source:'device_snapshot',ownerId:owner,createdAt:now,client:'web',billingEvidence:null,
  sections:[{id:'aurora',source:'device',completeness:'partial',capturedAt:now,revision:null,count:1,pending:3,notices:[],data:{journalVersion:1,document:right,cached:null,
    pendingCopies:[{key:`genesis-aurora-workspace-v1:${owner}:pending:writer:${writerA}:1:pending`,document:first,base,expectedRevision:0},
      {key:`genesis-aurora-workspace-v1:${owner}:pending:writer:${writerA}:2:pending`,document:left,base,expectedRevision:0},
      {key:`genesis-aurora-workspace-v1:${owner}:pending:writer:${writerB}:1:pending`,document:right,base,expectedRevision:0}]}}]};
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),file=new File([await sealBackup(payload,secret)],'synthetic-conflicting.genesisbackup');
const state={previews:0,writes:0,operations:[] as unknown[]};
Object.assign(window,{backupJournalQa:state});
const runtime:BackupPanelRuntime={
  authorizeBackup:async()=>({ownerId:owner,generation:0}),
  freezeBackupDevice:()=>({owner,at:now,sources:{},sync:{},storage:{}} as unknown as FrozenDevice),
  retainBackupSafety:async()=>({persistent:true}),
  materializeDeviceBackup:async()=>structuredClone(payload),materializeServerBackup:async()=>{throw new Error('UNEXPECTED_SERVER_SNAPSHOT');},
  prepareBackupRestore:(value,uid,selected,mode,choices)=>prepareBackupRestore(value,uid,selected,mode,{access:{check(){},
    request:async <T,>()=>({document:null}) as T,open:async()=>{throw new Error('UNEXPECTED_REMOTE_DOCUMENT');},
    seal:async()=>({iv:'synthetic-iv',ciphertext:'synthetic-ciphertext'})},current:async()=>({document:{},tasks:[],version:0}) as never,
    sealWorkspace:()=>{throw new Error('UNEXPECTED_WORKSPACE');}},choices),
  backupNeedsReconciliation:()=>false,captureAccountSessionGuard:()=>()=>{},holdBackupStaleChanges:async()=>{},
  backupRequest:async <T,>(path:string,body?:unknown)=>{
    if(path==='/status')return{enabled:true,noticeVersion:'synthetic',generation:0,driveEnabled:false,serverSigningConfigured:false} as T;
    if(path==='/preview'){state.previews++;state.operations=(body as {operations:unknown[]}).operations;return{stageId:'synthetic-stage',digest:'a'.repeat(64),counts:{},expiresIn:300} as T;}
    if(path==='/commit'){state.writes++;return{generation:1,duplicate:false} as T;}
    throw new Error('UNEXPECTED_BACKUP_REQUEST');
  },download:()=>{},readFile:async()=>file,
};
createRoot(document.getElementById('root')!).render(<BackupPanel user={{uid:owner,language} as GenesisUser} runtime={runtime}/>);

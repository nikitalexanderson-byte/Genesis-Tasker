import {payloadHash} from './forecast';
import type {AuroraDocument,AuroraSession} from './session';

type UprightPractice={version:1;binding:string;organon:AuroraSession['organon'];sphragisLetter:string|null;
 executions:AuroraSession['executions'];stage:number;highestStage:number;guidePage?:AuroraSession['guidePage'];legacyStage:number};
type StoredSession=AuroraSession&{uprightPractice?:UprightPractice};

// Installed clients forbid ritual fields on an all-upright session. Keep their
// version-1 view readable and preserve new practice data in an additive extension.
// Bind the active ritual to its inputs; an older client's edits must not revive it.
const binding=(session:AuroraSession)=>payloadHash({primary:session.primary.id,context:session.context,
 goal:session.goalText,tags:session.goalTags,curator:session.curatorId,state:session.profileState,
 preferences:session.organonPreferences,transformation:session.transformation??null});

export async function encodeAuroraStorage(document:AuroraDocument):Promise<AuroraDocument>{
 const sessions=await Promise.all(document.sessions.map(async session=>{
  if(!session.observationOnly||!session.organon&&!session.sphragisLetter&&!session.executions.length)return session;
  const legacyStage=session.stage===6||session.stage===7?8:session.stage;
  const uprightPractice:UprightPractice={version:1,binding:await binding(session),organon:session.organon,
   sphragisLetter:session.sphragisLetter,executions:session.executions,stage:session.stage,highestStage:session.highestStage,
   ...(session.guidePage?{guidePage:session.guidePage}:{}),legacyStage};
  return {...session,organon:null,sphragisLetter:null,executions:[],stage:legacyStage,
   highestStage:Math.max(session.highestStage,legacyStage),guidePage:{stage:legacyStage,part:0},uprightPractice};
 }));
 return {...document,sessions};
}

export async function decodeAuroraStorage(document:AuroraDocument):Promise<AuroraDocument>{
 if(!document||!Array.isArray(document.sessions))return document; // The document validator reports malformed envelopes.
 const sessions=await Promise.all(document.sessions.map(async (stored:StoredSession)=>{
  const {uprightPractice,...session}=stored;
  if(!uprightPractice)return session;
  if(!session.observationOnly||uprightPractice.version!==1||typeof uprightPractice.binding!=='string'
   ||!Array.isArray(uprightPractice.executions)||uprightPractice.executions.length>1000
   ||![uprightPractice.stage,uprightPractice.highestStage,uprightPractice.legacyStage].every(n=>Number.isInteger(n)&&n>=0&&n<=8)
   ||uprightPractice.highestStage<uprightPractice.stage||session.organon||session.sphragisLetter||session.executions.length)
   throw Error('AURORA_INVALID_UPRIGHT_PRACTICE');
  // Completed history survives even when a legacy client changes the goal.
  const restored={...session,executions:uprightPractice.executions};
  if(await binding(session)!==uprightPractice.binding)return restored;
  const samePage=session.stage===uprightPractice.legacyStage;
  return {...restored,organon:uprightPractice.organon,sphragisLetter:uprightPractice.sphragisLetter,
   ...(samePage?{stage:uprightPractice.stage,highestStage:uprightPractice.highestStage,guidePage:uprightPractice.guidePage}:{})};
 }));
 return {...document,sessions};
}

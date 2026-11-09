import {weatherFreshUntil,weatherTimestamp} from './weather-visuals';
import {isWeatherSnapshotV1} from './weather-contract';
import type {WeatherRequestV1,WeatherSnapshotV1} from './weather-types';

export type WeatherLoadSnapshot={status:'idle'|'loading'|'ready'|'error'|'requires-location';weather:WeatherSnapshotV1|null;evaluatedAt:number;visible:boolean};
type Runtime={now:()=>number;visible:()=>boolean;setTimer:(fn:()=>void,ms:number)=>unknown;clearTimer:(id:unknown)=>void};
const MIN_READ_INTERVAL=300_000,DEFAULT_RETRY=3_600_000;

/** A subscribed scene owns one abortable read and one deadline; hidden scenes never poll. */
export function createWeatherStore(request:WeatherRequestV1|null,fetchWeather:(request:WeatherRequestV1,signal:AbortSignal)=>Promise<WeatherSnapshotV1>,runtime:Runtime) {
  let snapshot:WeatherLoadSnapshot={status:request?'idle':'requires-location',weather:null,evaluatedAt:0,visible:false};
  const listeners=new Set<()=>void>();
  let controller:AbortController|null=null,timer:unknown=null,generation=0,nextReadAt=0,lastStarted=0;
  const emit=(next:WeatherLoadSnapshot)=>{snapshot=next;listeners.forEach(listener=>listener());};
  const stopTimer=()=>{if(timer!==null)runtime.clearTimer(timer);timer=null;};
  const expire=()=>{
    const now=runtime.now(),end=weatherFreshUntil(snapshot.weather);
    if(Number.isFinite(end)&&end<=now&&snapshot.weather)emit({...snapshot,weather:{...snapshot.weather,status:'stale'},evaluatedAt:now});
  };
  const schedule=()=>{
    stopTimer();if(!listeners.size||!request)return;
    const now=runtime.now(),end=weatherFreshUntil(snapshot.weather);
    const deadlines=[end>now?end:Infinity,runtime.visible()&&!controller?Math.max(nextReadAt,now+1):Infinity];
    const at=Math.min(...deadlines);if(!Number.isFinite(at))return;
    timer=runtime.setTimer(()=>{timer=null;expire();if(runtime.visible()&&runtime.now()>=nextReadAt)void load();else schedule();},Math.min(2_147_000_000,Math.max(1,at-now)));
  };
  async function load() {
    if(!request||controller||!listeners.size||!runtime.visible())return;
    const now=runtime.now();if(now<nextReadAt){schedule();return;}
    const token=++generation,active=new AbortController();controller=active;lastStarted=now;
    emit({...snapshot,status:snapshot.weather?'ready':'loading',evaluatedAt:now,visible:true});
    try {
      const weather=await fetchWeather(request,active.signal);
      if(token!==generation||active.signal.aborted)return;
      if(!isWeatherSnapshotV1(weather))throw new Error('Invalid weather schema');
      const fetched=runtime.now(),suggested=weatherTimestamp(weather.retryAt)||weatherTimestamp(weather.expiresAt);
      nextReadAt=Math.max(lastStarted+MIN_READ_INTERVAL,Number.isFinite(suggested)?suggested:fetched+DEFAULT_RETRY);
      emit({status:'ready',weather,evaluatedAt:fetched,visible:runtime.visible()});expire();
    } catch {
      if(token!==generation||active.signal.aborted)return;
      nextReadAt=runtime.now()+MIN_READ_INTERVAL;
      emit({...snapshot,status:'error',evaluatedAt:runtime.now(),visible:runtime.visible()});expire();
    } finally {if(token===generation){controller=null;schedule();}}
  }
  const resume=()=>{
    if(!listeners.size)return;
    const now=runtime.now(),visible=runtime.visible();
    emit({...snapshot,evaluatedAt:now,visible});expire();
    if(visible&&now>=nextReadAt)void load();else schedule();
  };
  return {
    getSnapshot:()=>snapshot,
    hasListeners:()=>listeners.size>0,
    subscribe:(listener:()=>void)=>{
      listeners.add(listener);if(listeners.size===1)resume();
      return ()=>{
        listeners.delete(listener);if(listeners.size)return;
        stopTimer();generation++;controller?.abort();controller=null;
        if(!snapshot.weather){nextReadAt=0;lastStarted=0;snapshot={...snapshot,status:request?'idle':'requires-location'};}
      };
    },resume,
  };
}

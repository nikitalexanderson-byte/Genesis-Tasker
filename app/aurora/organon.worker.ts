import {selectOrganon,type OrganonPreferences} from './organon';
import type {CuratorId} from './registry';
self.onmessage=(event:MessageEvent<{requestId:string;curatorId:CuratorId;preferences:OrganonPreferences}>)=>{
 try{self.postMessage({requestId:event.data.requestId,result:selectOrganon(event.data.curatorId,event.data.preferences,true)});}
 catch{self.postMessage({requestId:event.data.requestId,error:'AURORA_NO_COMFORTABLE_EXACT_FORM'});}
};

export const PLAN_GUIDANCE_TOPICS=['projects','habits','mindmaps','diary','dreams','overview'] as const;
export type PlanGuidanceTopic=typeof PLAN_GUIDANCE_TOPICS[number];
export type PlanGuidanceNotice={schemaVersion:1;id:string;topic:PlanGuidanceTopic;reason:'scheduled'|'return'|'quota'|'feature';createdAt:string;resource?:string;feature?:string};
export type PlanGuidanceClaim={show:boolean;eligible:boolean;nextAt:string|null;serverNow?:string;notice?:PlanGuidanceNotice;token?:string;leaseUntil?:string};
export type PlanGuidanceRequest={topic:PlanGuidanceTopic;reason:'scheduled'|'quota'|'feature';resource?:string;feature?:string};
export type PlanGuidanceShown={ok:boolean;notice:PlanGuidanceNotice|null;nextAt?:string|null};

export function planGuidanceTopic(section:string):PlanGuidanceTopic {
  if(/habit|rhythm/u.test(section))return 'habits';
  if(/mindmap/u.test(section))return 'mindmaps';
  if(/dream/u.test(section))return 'dreams';
  if(/diary/u.test(section))return 'diary';
  if(/project|task|affair/u.test(section))return 'projects';
  return 'overview';
}

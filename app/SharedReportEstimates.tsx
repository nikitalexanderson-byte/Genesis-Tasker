"use client";
import type { ReactNode } from 'react';
import type { ReportEstimateGroup, ReportMetric, TeamReport } from './shared-reports';
import { translateText, type Language } from './i18n';
import { planningText } from './shared-planning';

export function SharedReportEstimates({report,language,renderMetric}:{report:TeamReport;language:Language;renderMetric:(metric:ReportMetric,label?:string,value?:string)=>ReactNode}){
 const t=(value:string)=>translateText(value,language),number=new Intl.NumberFormat(language,{maximumFractionDigits:2});
 const values=(group:ReportEstimateGroup)=><dl className="report-estimate-values">{(['points','hours'] as const).map(unit=><div key={unit}><dt>{planningText(unit,language)}</dt><dd>{renderMetric(group[unit].estimated,planningText(unit,language),number.format(group[unit].value))}</dd><dt>{planningText('unestimated',language)}</dt><dd>{renderMetric(group[unit].unestimated)}</dd></div>)}</dl>;
 if(!report.estimates.available)return null;
 return <section className="report-estimates" data-no-translate><h3>{planningText('estimates',language)}</h3><p>{planningText('independent',language)}</p>{report.estimates.projects.map(project=><div className="report-estimate-project" key={project.projectId}><h4>{report.catalog.projects.find(row=>row.id===project.projectId)?.title??t('Проект')}</h4>{values(project)}
  {project.members.length?<details><summary>{planningText('byAssignee',language)}</summary>{project.members.map(member=><div key={member.id}><h5>{report.members.find(row=>row.id===member.id)?.title??t(member.id==='unassigned'?'Не назначен':'Бывший участник')}</h5>{values(member)}</div>)}</details>:null}
 </div>)}</section>;
}

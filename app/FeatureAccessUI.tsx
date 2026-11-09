"use client";
import {UpgradeButton} from './UpgradeUI';
import type {Language} from './i18n';
import {BILLING_FALLBACK_POLICY} from './billing';

export function FeatureAccessUI({language,feature,resource}:{language:Language;feature?:string;resource?:string}) {
  if(feature&&(feature==='calendar-sync'||BILLING_FALLBACK_POLICY.disabledFeatures.includes(feature)))return null;
  return <div className="feature-access-upgrade"><UpgradeButton language={language} feature={feature} resource={resource}/></div>;
}

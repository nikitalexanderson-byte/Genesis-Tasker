import type { SubscriptionPlan } from "./cloud-sync";
const subscriptionNames:Record<SubscriptionPlan,string> = {
  free:"Free",standart:"Standard",premium:"Premium",business:"Business",premium4life:"Elite",elite_plus:"Elite+",
};
export function subscriptionName(plan?:SubscriptionPlan):string {
  return plan ? subscriptionNames[plan] ?? "…" : "…";
}

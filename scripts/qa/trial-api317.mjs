/** Actual authenticated loopback HTTP acceptance; no provider or production access. */
export async function verifyTrialApi317({request,login,control,record,envelope}) {
  const labels={standart:'Trial-Standart',premium:'Trial-Premium',business:'Trial-Business'};
  const run=async(tier,id,expected,operation)=>{
    try {const result=await operation();record(tier,'trial.'+id,expected,result.actual,result.pass,{state:result.state??'trial',source:'User requirement 2026-11-03: one trial/account, exactly259200seconds; independent expected labels and policy'});}
    catch(error){record(tier,'trial.'+id,expected,{failure:String(error.message)},false,{state:'trial'});}
  };
  const code=r=>({status:r.status,error:r.data.error??null});
  await run('guest','anonymous-rejected',401,async()=>{const r=await request('anonymous','billing/trial','POST',{plan:'business'});return {actual:code(r),pass:r.status===401};});
  await login('trial-invalid');
  for(const plan of ['free','premium4life','elite','Trial-Premium','PREMIUM']) {
    await run('free','reject-plan-'+plan,400,async()=>{const r=await request('trial-invalid','billing/trial','POST',{plan});return {actual:code(r),pass:r.status===400};});
  }
  for(const extra of [{userId:'another-account'},{startsAt:'2099-01-01T00:00:00Z'},{endsAt:'2099-01-04T00:00:00Z'},{durationSeconds:999999},{featureAccess:{effectivePlan:'business'}}]) {
    const key=Object.keys(extra)[0];
    await run('free','reject-client-'+key,400,async()=>{const r=await request('trial-invalid','billing/trial','POST',{plan:'premium',...extra});return {actual:code(r),pass:r.status===400};});
  }
  await run('free','csrf-before-consumption',403,async()=>{const r=await request('trial-invalid','billing/trial','POST',{plan:'premium'},{csrf:false});return {actual:code(r),pass:r.status===403};});
  await run('free','invalid-does-not-consume','available',async()=>{const r=await request('trial-invalid','billing/catalog?client=web');return {actual:{status:r.status,trial:r.data.trial?.status,eligible:r.data.trial?.eligiblePlans},pass:r.status===200&&r.data.trial?.status==='available'&&JSON.stringify(r.data.trial.eligiblePlans)===JSON.stringify(['standart','premium','business'])};});
  for(const plan of Object.keys(labels)) {
    const fixture='trial-'+plan;await login(fixture);let original;
    await run(plan,'available-before-start','available',async()=>{const r=await request(fixture,'billing/catalog?client=web');return {actual:{status:r.status,trial:r.data.trial?.status},pass:r.status===200&&r.data.trial?.status==='available'&&r.data.trial.eligiblePlans.includes(plan)};});
    await run(plan,'activate-exact-window',{label:labels[plan],seconds:259200,paid:'free'},async()=>{
      const r=await request(fixture,'billing/trial','POST',{plan});original=r.data.trial;
      const seconds=(Date.parse(original?.endsAt)-Date.parse(original?.startsAt))/1000;
      return {actual:{status:r.status,label:original?.label,seconds,duration:original?.durationSeconds,paid:r.data.user?.subscriptionPlan,effective:r.data.user?.featureAccess?.effectivePlan,source:r.data.user?.featureAccess?.source},
        pass:r.status===200&&original?.status==='active'&&original.plan===plan&&original.label===labels[plan]&&original.durationSeconds===259200&&seconds===259200&&r.data.user?.subscriptionPlan==='free'&&r.data.user.featureAccess.effectivePlan===plan&&r.data.user.featureAccess.source==='trial'&&r.data.user.featureAccess.paidAccess?.effectivePlan==='free'};
    });
    await run(plan,'same-plan-idempotent','same original window',async()=>{const r=await request(fixture,'billing/trial','POST',{plan});return {actual:{status:r.status,startsAt:r.data.trial?.startsAt,endsAt:r.data.trial?.endsAt},pass:r.status===200&&!!original&&r.data.trial?.startsAt===original.startsAt&&r.data.trial?.endsAt===original.endsAt};});
    await run(plan,'other-plan-rejected',409,async()=>{const other=plan==='business'?'premium':'business';const r=await request(fixture,'billing/trial','POST',{plan:other});return {actual:code(r),pass:r.status===409&&r.data.error==='TRIAL_ALREADY_USED'};});
    await run(plan,'new-session-same-window','active unchanged trial',async()=>{const r=await login(fixture);return {actual:{status:r.status,plan:r.data.user?.trial?.plan,startsAt:r.data.user?.trial?.startsAt,endsAt:r.data.user?.trial?.endsAt},pass:r.status===200&&!!original&&r.data.user?.trial?.status==='active'&&r.data.user.trial.startsAt===original.startsAt&&r.data.user.trial.endsAt===original.endsAt&&r.data.user.featureAccess.effectivePlan===plan};});
    await run(plan,'server-feature-mutation',200,async()=>{const r=await request(fixture,'stoicheion/draws','POST',{kind:'timeline',seed:20261103});return {actual:code(r),pass:r.status===200};});
    await run(plan,'premium-feature-policy',plan==='standart'?403:200,async()=>{const r=await request(fixture,'stoicheion/draws','POST',{kind:'spread',seed:20261103});return {actual:code(r),pass:r.status===(plan==='standart'?403:200)};});
    await run(plan,'shared-feature-policy',plan==='business'?201:403,async()=>{const r=await request(fixture,'shared/spaces','POST',{title:'Synthetic trial '+plan});return {actual:code(r),pass:r.status===(plan==='business'?201:403)};});
    await run(plan,'zero-monetary-credit',{currentPlan:'free',credit:0},async()=>{const r=await request(fixture,'billing/quote?offerId=premium:12&provider=yookassa&client=web');return {actual:{status:r.status,currentPlan:r.data.currentPlan,credit:r.data.creditMinor},pass:r.status===200&&r.data.currentPlan==='free'&&r.data.creditMinor===0};});
  }
  await login('trial-expired');await control('trial-expired','seed-trial',{plan:'business','expires-in':-1});
  await control('trial-expired','seed-mindmaps',{count:1});
  await run('business','expired-authoritative-fallback','expired/free',async()=>{const r=await request('trial-expired','session');return {actual:{status:r.status,trial:r.data.user?.trial?.status,effective:r.data.user?.featureAccess?.effectivePlan},pass:r.status===200&&r.data.user?.trial?.status==='expired'&&r.data.user.featureAccess.effectivePlan==='free'};});
  await run('business','expired-replay-never-renews','expired with original past deadline',async()=>{const r=await request('trial-expired','billing/trial','POST',{plan:'business'});return {actual:{status:r.status,trial:r.data.trial?.status,endsAt:r.data.trial?.endsAt,serverNow:r.data.trial?.serverNow},pass:r.status===200&&r.data.trial?.status==='expired'&&Date.parse(r.data.trial.endsAt)<=Date.parse(r.data.trial.serverNow)&&r.data.user?.featureAccess?.effectivePlan==='free'};});
  await run('business','expired-server-denies-growth',403,async()=>{const r=await request('trial-expired','mindmaps/trial-after-expiry','PUT',envelope('trial-after-expiry'));return {actual:code(r),pass:r.status===403};});
  await run('business','expired-keeps-existing-data',1,async()=>{const r=await request('trial-expired','mindmaps');return {actual:{status:r.status,count:r.data.maps?.length},pass:r.status===200&&r.data.maps?.length===1};});
  await login('trial-paid');await control('trial-paid','seed-trial',{plan:'premium','expires-in':-1});
  await run('premium','expiry-preserves-real-paid','standart',async()=>{const r=await request('trial-paid','session');return {actual:{status:r.status,trial:r.data.user?.trial?.status,paid:r.data.user?.subscriptionPlan,effective:r.data.user?.featureAccess?.effectivePlan},pass:r.status===200&&r.data.user?.trial?.status==='expired'&&r.data.user.subscriptionPlan==='standart'&&r.data.user.featureAccess.effectivePlan==='standart'};});
  for(const fixture of ['business','premium4life']) {
    await login(fixture);
    await run(fixture,'no-trial-above-current-paid','ineligible',async()=>{const r=await request(fixture,'billing/catalog?client=web');return {actual:{status:r.status,trial:r.data.trial?.status,eligible:r.data.trial?.eligiblePlans},pass:r.status===200&&r.data.trial?.status==='ineligible'&&r.data.trial.eligiblePlans.length===0};});
    await run(fixture,'trial-cannot-downgrade-paid',409,async()=>{const r=await request(fixture,'billing/trial','POST',{plan:'premium'});return {actual:code(r),pass:r.status===409};});
  }
}

import type {BillingProvider} from './billing';
export type PaymentRegion='RU'|'outside-RU'|'unknown';
export type PaymentRouting={region:PaymentRegion;source:'ip'|'unknown';preferredProvider:BillingProvider;dataRevision?:string};
type Point=number[];
export type CountryBoundary=Point[][][];

function inRing(longitude:number,latitude:number,ring:Point[]):boolean {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i];const [xj,yj]=ring[j];
    if((yi>latitude)!==(yj>latitude)&&longitude<(xj-xi)*(latitude-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}

/** Local point-in-polygon lookup. Coordinates never leave this device. */
export function paymentRegionFromPosition(latitude:number,longitude:number,accuracy:number,boundary:CountryBoundary):PaymentRegion {
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0||accuracy>50_000)return 'unknown';
  const rad=Math.PI/180;const xScale=111.32*Math.max(.01,Math.cos(latitude*rad));const yScale=111.32;
  let nearest=Infinity;
  for(const polygon of boundary)for(const ring of polygon)for(let i=0;i<ring.length-1;i++){
    const a=ring[i],b=ring[i+1];
    // Separate polygon parts on either side of the date line keep each segment local.
    const ax=(a[0]-longitude)*xScale,ay=(a[1]-latitude)*yScale;
    const bx=(b[0]-longitude)*xScale,by=(b[1]-latitude)*yScale;
    const dx=bx-ax,dy=by-ay;const length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/length)):0;
    nearest=Math.min(nearest,Math.hypot(ax+t*dx,ay+t*dy));
  }
  // This overview map cannot resolve borders/coastlines precisely: retain the IP hint nearby.
  if(nearest<Math.max(15,accuracy/1000))return 'unknown';
  return boundary.some(polygon=>polygon.length&&inRing(longitude,latitude,polygon[0])&&!polygon.slice(1).some(ring=>inRing(longitude,latitude,ring)))?'RU':'outside-RU';
}

export async function locatePaymentRegion(geolocation:Pick<Geolocation,'getCurrentPosition'>):Promise<PaymentRegion> {
  const position=await new Promise<GeolocationPosition>((resolve,reject)=>geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10_000,maximumAge:60_000}));
  const boundary=await import('./billing-country-boundary.ts');
  return paymentRegionFromPosition(position.coords.latitude,position.coords.longitude,position.coords.accuracy,boundary.default);
}

/** Use existing device consent only. Opening pricing must never request a new location permission. */
export async function grantedDevicePaymentRegion(permissions:Pick<Permissions,'query'>|undefined,geolocation:Pick<Geolocation,'getCurrentPosition'>|undefined,signal?:AbortSignal):Promise<PaymentRegion|null> {
  if(!permissions||!geolocation||signal?.aborted)return null;
  try {
    const permission=await permissions.query({name:'geolocation'});
    if(permission.state!=='granted'||signal?.aborted)return null;
    const region=await locatePaymentRegion(geolocation);
    return signal?.aborted||region==='unknown'?null:region;
  } catch { return null; }
}

export function paymentProviderOrder(region:PaymentRegion):BillingProvider[] {
  return region==='RU'?['yookassa','lemon-squeezy','google-play']:['lemon-squeezy','yookassa','google-play'];
}

/** Keep a deliberate user choice; otherwise prefer configured methods in the regional order. */
export function preferredPaymentProvider(region:PaymentRegion,available:readonly BillingProvider[],manual?:BillingProvider|null):BillingProvider {
  if(manual&&available.includes(manual))return manual;
  const order=paymentProviderOrder(region);
  return order.find(provider=>available.includes(provider))??order[0];
}

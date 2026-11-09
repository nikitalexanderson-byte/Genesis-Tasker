import type {BillingOrder} from './billing';

export function billingReturnOrderId(url:string):string|null {
  const id=new URL(url).searchParams.get('billingOrder');
  return id&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)?id:null;
}

export function billingReturnCloseUrl(url:string):string {
  const next=new URL(url);next.searchParams.delete('billingOrder');return `${next.pathname}${next.search}${next.hash}`;
}

/** Settlement always wins over a paid receipt: no client-side grant or refund. */
export function billingReturnState(order:BillingOrder):{message:'settlementVerifying'|'settlementRefundPending'|'settlementRefunded'|'settlementCancelled'|'settlementFailed'|'paymentPending'|'paymentPaid';poll:boolean;paid:boolean} {
  if(order.settlement) {
    switch(order.settlement.status) {
      case 'verifying':return {message:'settlementVerifying',poll:true,paid:false};
      case 'refund-required':case 'refund-pending':return {message:'settlementRefundPending',poll:true,paid:false};
      case 'refunded':return {message:'settlementRefunded',poll:false,paid:false};
      case 'cancelled':return {message:'settlementCancelled',poll:false,paid:false};
      default:return {message:'settlementFailed',poll:false,paid:false};
    }
  }
  switch(order.status) {
    case 'paid':return {message:'paymentPaid',poll:false,paid:true};
    case 'pending':return {message:'paymentPending',poll:true,paid:false};
    case 'payment-verifying':case 'settlement-required':return {message:'settlementVerifying',poll:true,paid:false};
    case 'refunded':return {message:'settlementRefunded',poll:false,paid:false};
    case 'cancelled':return {message:'settlementCancelled',poll:false,paid:false};
    default:return {message:'settlementFailed',poll:false,paid:false};
  }
}

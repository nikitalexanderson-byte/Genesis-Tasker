import {REFUND_CONTACTS,refundContactLabel} from './public-service';

export function RefundContacts({language,className}:{language:string;className?:string}) {
  return <div className={className} data-refund-contacts>
    <p>{refundContactLabel(language)}</p>
    <ul>{REFUND_CONTACTS.map(address=><li key={address}><a href={`mailto:${address}`}>{address}</a></li>)}</ul>
  </div>;
}

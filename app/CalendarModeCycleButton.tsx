import type {CalendarMode} from './calendar-data';
import {CalendarModeIcon} from './CalendarModeIcon';
import {displayCalendarOrder} from './display-calendar-order';
import names from './display-calendar-order-copy.json';
import copy from './calendar-mode-cycle-copy.json';

export function CalendarModeCycleButton({mode,enabledCalendars,order,language,onChange}:{
  mode:CalendarMode;enabledCalendars:CalendarMode[];order:readonly CalendarMode[];language:string;
  onChange:(mode:CalendarMode)=>Promise<void>;
}) {
  const available=displayCalendarOrder(order).filter(value=>enabledCalendars.includes(value));
  if(available.length<2)return null;
  const next=available[(available.indexOf(mode)+1)%available.length];
  const locale=language in copy?language as keyof typeof copy:'en';
  const label=copy[locale].replace('{current}',names[locale][mode]).replace('{next}',names[locale][next]);
  return <button type="button" className="icon-button ux-action-button calendar-mode-cycle" data-no-translate
    data-calendar-mode={mode} aria-label={label} data-tooltip={label} onClick={()=>void onChange(next)}>
    <span key={mode} className="calendar-mode-cycle-glyph"><CalendarModeIcon mode={mode}/></span>
  </button>;
}

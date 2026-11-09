/** The same authored multicolor vectors are exported to Android drawables. */
import './mood-face.css';

const APP_BASE=(process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'').replace(/\/$/,'');

export function MoodFace({value,size=32}:{value:number;size?:number}) {
  const index=Math.max(0,Math.min(11,Math.round(value)+5));
  // eslint-disable-next-line @next/next/no-img-element -- Small local SVGs are precached and keep their fixed colors in the static/offline build.
  return <img className="mood-face" src={`${APP_BASE}/tracker-art/moods/mood-${index}.svg`} alt="" aria-hidden="true"
    width={size} height={size} draggable={false}
    style={{width:size,height:size,display:'inline-block',verticalAlign:'middle',flexShrink:0,filter:'none'}} />;
}

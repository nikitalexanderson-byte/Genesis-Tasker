import type {CSSProperties} from 'react';
import policy from './weather-visuals-v1.json';
import type {weatherVisualState} from './weather-visuals';
import './solar-weather-effects.css';

type Visuals=ReturnType<typeof weatherVisualState>;
export function SolarWeatherClouds({weather,paused}:{weather:Visuals;paused:boolean}) {
  return weather.cloudCover>0?<div className={`solar-weather-clouds${weather.storm?' storm':weather.cloudCover>.75?' overcast':''}${paused||!weather.cloudMoving?' solar-weather-paused':''}`} style={{opacity:weather.cloudCover*policy.cloud.opacity,'--weather-cloud-duration':`${weather.cloudDurationSeconds}s`} as CSSProperties}>
    <i/><i/><i/>
  </div>:null;
}

export function SolarWeatherEffects({weather,paused}:{weather:Visuals;paused:boolean}) {
  if(!weather.fresh)return null;
  const style={'--weather-drift':`${weather.drift}px`,'--weather-fog':weather.fogOpacity,'--weather-storm-glow':policy.motion.stormGlowOpacity,
    '--weather-cloud-duration':`${policy.motion.cloudSeconds}s`,'--weather-wind-duration':`${policy.motion.windSeconds}s`,'--weather-storm-duration':`${policy.motion.stormSeconds}s`} as CSSProperties;
  const duration=weather.precipitation==='snow'||weather.precipitation==='sleet'?policy.precipitation.snowSeconds:weather.precipitation==='hail'?policy.precipitation.hailSeconds:policy.precipitation.rainSeconds;
  return <div className={`solar-weather-effects${paused?' solar-weather-paused':''}`} style={style} data-weather-precipitation={weather.precipitation} data-weather-intensity={weather.intensity} data-weather-blizzard={weather.blizzard}>
    {weather.fogOpacity>0?<span className="solar-weather-fog"/>:null}
    {weather.thunderstorm?<span className="solar-weather-storm-glow"/>:null}
    {weather.windVisible?<span className={`solar-weather-wind${weather.windStrong?' strong':''}`}><i/><i/><i/></span>:null}
    {weather.particles?Array.from({length:weather.particles},(_,index)=>{
      const snow=weather.precipitation==='snow'||weather.precipitation==='sleet'&&index%2===0;
      const kind=snow?'snow':weather.precipitation==='hail'?'hail':'rain';
      const depth=(index%5)/4;
      const particleStyle={'--particle-x':`${((index*0.61803398875)%1)*100}%`,'--particle-y':`${((index*0.38196601125)%1)*100}%`,
        '--particle-duration':`${duration*(1.35-depth*.55)}s`,'--particle-delay':`${-(index*1.17)%duration}s`,
        '--particle-size':`${snow?1.2+depth*2.2:kind==='hail'?1.4+depth:0.55+depth*.55}px`,
        '--particle-length':`${weather.precipitation==='drizzle'?2+depth*2:4+depth*6}px`,
        '--particle-opacity':.16+depth*.38,'--particle-blur':`${snow&&depth>.7?.45:0}px`,
        '--particle-angle':`${-Math.atan2(weather.drift,350)*180/Math.PI}deg`,
        '--particle-sway':`${(index%2?-1:1)*(4+depth*9)}px`} as CSSProperties;
      return <i key={index} className={`solar-weather-particle ${kind}`} style={particleStyle}/>;
    }):null}
  </div>;
}

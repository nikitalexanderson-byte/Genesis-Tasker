import copy from './weather-copy.json';
import {useCivilWeather} from './use-civil-weather';
import {isWeatherFresh} from './weather-visuals';
import type {AutomaticSolarLocation,DeviceLocation} from './solar-times';
import type {TimeFormat} from './time-format';
import type {WeatherSnapshotV1} from './weather-types';
import type {WeatherLoadSnapshot} from './weather-store';
import {DEFAULT_WEATHER_DISPLAY, weatherPressure, weatherTemperature, type WeatherDisplay} from './weather-display';
import {useWeatherDisplay} from './use-weather-display';
import './solar-weather-summary.css';

export function weatherCopy(language:string) {return copy[language as keyof typeof copy]??copy.en;}
const finite=(value:number|null|undefined):value is number=>typeof value==='number'&&Number.isFinite(value);

export function SolarWeatherDetails({weather,loadStatus,now,language,onChooseCity,units=DEFAULT_WEATHER_DISPLAY}:{weather:WeatherSnapshotV1|null;loadStatus:WeatherLoadSnapshot['status'];now:Date;language:string;deviceTimeZone:string;timeFormat:TimeFormat;onChooseCity?:()=>void;units?:WeatherDisplay}) {
  const c=weatherCopy(language),fresh=isWeatherFresh(weather,now.valueOf());
  const current=weather?.current,number=new Intl.NumberFormat(language,{maximumFractionDigits:1});
  const temperature=(value:number)=>`${new Intl.NumberFormat(language,{maximumFractionDigits:0,signDisplay:'exceptZero'}).format(weatherTemperature(value,units.temperature)!)}${units.temperature==='fahrenheit'?'°F':'°C'}`;
  if(!current){
    const requiresCity=loadStatus==='requires-location'||weather?.status==='requires-location';
    if(requiresCity&&onChooseCity)return <button type="button" className="solar-weather-city-button" data-no-translate onClick={onChooseCity}>{c.requiresLocation}</button>;
    return <p className="solar-weather-status" role="status" data-no-translate>{loadStatus==='loading'||loadStatus==='idle'?c.loading:requiresCity?c.requiresLocation:c.unavailable}</p>;
  }
  const condition=current.precipitationKind==='hail'?'hail':current.condition;
  const conditionCopy=c.conditions[condition as keyof typeof c.conditions]??c.conditions.unknown;
  const speed=finite(current.windSpeedMps)?`${number.format(current.windSpeedMps)} m/s`:null;
  const rows=[
    [c.humidity,finite(current.humidityPercent)?`${number.format(current.humidityPercent)}%`:null],
    [c.pressure,finite(current.pressureMslHpa)?`${number.format(weatherPressure(current.pressureMslHpa,units.pressure)!)} ${units.pressure==='mmhg'?c.mmHg:c.hPa}`:null],
    [c.precipitation,finite(current.precipitationRateMmH)?`${number.format(current.precipitationRateMmH)} mm/h`:null],
  ].filter((row):row is [string,string]=>Boolean(row[1]));
  return <section className="solar-weather-summary" data-no-translate aria-label={c.title} data-weather-status={fresh?'fresh':'stale'}>
    <div className="solar-weather-readings">
    <div className="solar-weather-current">
      {finite(current.temperatureC)?<span className="solar-weather-reading">{temperature(current.temperatureC)}</span>:null}
      <span>{conditionCopy}</span>
      {speed?<span>{c.wind} {speed}</span>:null}
      {!fresh?<small>{c.stale}</small>:null}
    </div>
    <div className="solar-weather-details">
      <dl>{rows.map(([label,value])=><div key={label} className={label===c.pressure?'solar-weather-pressure':undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
    </div>
  </section>;
}

export function SolarWeatherSummary({ownerId,now,location,source,language,deviceTimeZone,timeFormat,onChooseCity}:{ownerId:string|null;now:Date;location:DeviceLocation|null;source:AutomaticSolarLocation['source']|null;language:string;deviceTimeZone:string;timeFormat:TimeFormat;onChooseCity?:()=>void}) {
  const loaded=useCivilWeather(ownerId,location,source);
  const {units}=useWeatherDisplay(ownerId);
  if(!ownerId)return null;
  return <SolarWeatherDetails weather={loaded.weather} loadStatus={loaded.status} now={new Date(Math.max(now.valueOf(),loaded.evaluatedAt))} language={language} deviceTimeZone={deviceTimeZone} timeFormat={timeFormat} onChooseCity={onChooseCity} units={units}/>;
}

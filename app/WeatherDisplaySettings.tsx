import copy from './weather-copy.json';
import {useWeatherDisplay} from './use-weather-display';
import type {Language} from './i18n';
import './weather-display-settings.css';

export function WeatherDisplaySettings({ownerId, language}: {ownerId: string; language: Language}) {
  const c = copy[language], {units, update} = useWeatherDisplay(ownerId);
  return <section className="account-preferences weather-display-settings" data-settings-group="appearance"
    aria-labelledby="weather-display-title" data-no-translate>
    <h3 id="weather-display-title">{c.displayTitle}</h3>
    <label><span>{c.temperatureUnit}</span>
      <select value={units.temperature} onChange={event => update({temperature: event.target.value === 'fahrenheit' ? 'fahrenheit' : 'celsius'})}>
        <option value="celsius">{c.celsius}</option><option value="fahrenheit">{c.fahrenheit}</option>
      </select>
    </label>
    <label><span>{c.pressure}</span>
      <select value={units.pressure} onChange={event => update({pressure: event.target.value === 'mmhg' ? 'mmhg' : 'hpa'})}>
        <option value="hpa" title={c.hectopascals}>{c.hPa}</option><option value="mmhg" title={c.millimetersMercury}>{c.mmHg}</option>
      </select>
    </label>
    <div className="weather-source-details">
      <a href="https://www.met.no/" target="_blank" rel="noreferrer">{c.source}: MET Norway</a>
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">{c.license}: CC BY 4.0</a>
    </div>
  </section>;
}

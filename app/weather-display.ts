export type WeatherTemperatureUnit = 'celsius' | 'fahrenheit';
export type WeatherPressureUnit = 'hpa' | 'mmhg';
export type WeatherDisplay = {temperature: WeatherTemperatureUnit; pressure: WeatherPressureUnit};
export const DEFAULT_WEATHER_DISPLAY: WeatherDisplay = {temperature: 'celsius', pressure: 'hpa'};

export function weatherDisplay(value: unknown): WeatherDisplay {
  const row = value as Partial<WeatherDisplay> | null;
  return {temperature: row?.temperature === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    pressure: row?.pressure === 'mmhg' ? 'mmhg' : 'hpa'};
}

/** Provider snapshots stay in Celsius and hPa; units affect presentation only. */
export function weatherTemperature(value: number | null | undefined, unit: WeatherTemperatureUnit): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? unit === 'fahrenheit' ? value * 9 / 5 + 32 : value : null;
}
export function weatherPressure(value: number | null | undefined, unit: WeatherPressureUnit): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? unit === 'mmhg' ? value * 0.750061683 : value : null;
}

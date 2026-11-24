import { z } from 'zod';

// ---------- Forecast ----------

export interface DailyForecast {
  date: string; // YYYY-MM-DD
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  windSpeedMaxKmh: number;
  et0Mm: number | null;
  /** true when min temp is ≤ 2 °C — practical frost risk threshold for olive */
  frostRisk: boolean;
}

export interface WeatherForecastResult {
  lat: number;
  lon: number;
  timezone: string;
  daily: DailyForecast[];
}

export const forecastQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;

// ---------- AEMET alerts ----------

export type AlertLevel = 'amarillo' | 'naranja' | 'rojo';

export interface AemetAlert {
  id: string;
  title: string;
  level: AlertLevel | null;
  area: string;
  phenomenon: string | null;
  publishedAt: string; // ISO
  link: string;
}

export interface WeatherAlertsResult {
  alerts: AemetAlert[];
  fetchedAt: string; // ISO
}

// ---------- Open-Meteo raw response shapes ----------

export interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  et0_fao_evapotranspiration: (number | null)[];
}

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: OpenMeteoDaily;
}

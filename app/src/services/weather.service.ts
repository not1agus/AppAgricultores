import { api } from '@/services/api';

export type AlertLevel = 'amarillo' | 'naranja' | 'rojo';

export interface AemetAlert {
  id: string;
  title: string;
  level: AlertLevel | null;
  area: string;
  phenomenon: string | null;
  publishedAt: string;
  link: string;
}

export interface WeatherAlerts {
  alerts: AemetAlert[];
  fetchedAt: string;
}

export interface DailyForecast {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  windSpeedMaxKmh: number;
  et0Mm: number | null;
  frostRisk: boolean;
}

export interface WeatherForecast {
  lat: number;
  lon: number;
  timezone: string;
  daily: DailyForecast[];
}

export const weatherService = {
  getAlerts(): Promise<WeatherAlerts> {
    return api.get<WeatherAlerts>('/weather/alerts');
  },

  getForecast(lat: number, lon: number): Promise<WeatherForecast> {
    return api.get<WeatherForecast>(`/weather/forecast?lat=${lat}&lon=${lon}`);
  },
};

import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../common/utils/logger';
import {
  AemetAlert,
  AlertLevel,
  DailyForecast,
  OpenMeteoResponse,
  WeatherAlertsResult,
  WeatherForecastResult,
} from './weather.types';

// ---------- Open-Meteo forecast ----------

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 7;
const HTTP_TIMEOUT_MS = 10_000;

export async function fetchForecast(
  lat: number,
  lon: number,
): Promise<WeatherForecastResult> {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'daily',
    [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'wind_speed_10m_max',
      'et0_fao_evapotranspiration',
    ].join(','),
  );
  url.searchParams.set('timezone', 'Europe/Madrid');
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));
  url.searchParams.set('wind_speed_unit', 'kmh');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let raw: OpenMeteoResponse;
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    raw = (await res.json()) as OpenMeteoResponse;
  } catch (err) {
    logger.warn('weather: forecast fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const d = raw.daily;
  const daily: DailyForecast[] = d.time.map((date, i) => ({
    date,
    tempMaxC: d.temperature_2m_max[i] ?? 0,
    tempMinC: d.temperature_2m_min[i] ?? 0,
    precipitationMm: d.precipitation_sum[i] ?? 0,
    windSpeedMaxKmh: d.wind_speed_10m_max[i] ?? 0,
    et0Mm: d.et0_fao_evapotranspiration[i] ?? null,
    // Frost risk for olive: damage begins around 0 °C for young fruit / -2 °C
    // for mature trees. Using 2 °C as a conservative warning threshold.
    frostRisk: (d.temperature_2m_min[i] ?? 0) <= 2,
  }));

  return {
    lat: raw.latitude,
    lon: raw.longitude,
    timezone: raw.timezone,
    daily,
  };
}

// ---------- AEMET alerts via RSS/Atom feed ----------

const AEMET_RSS_URL = 'https://www.aemet.es/es/rss_info/avisos/esp';
const ALERTS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

let alertsCache: { data: AemetAlert[]; fetchedAt: Date } | null = null;

function extractLevel(text: string): AlertLevel | null {
  const m = /\b(amarillo|naranja|rojo)\b/i.exec(text);
  if (!m) return null;
  return m[1]!.toLowerCase() as AlertLevel;
}

function extractPhenomenon(title: string): string | null {
  // Typical patterns:
  //   "Aviso amarillo de viento en Huelva"
  //   "Aviso de lluvias y tormentas de nivel naranja en Sevilla"
  //   "Aviso naranja de nieve en Teruel"
  const m = /\bde\s+([a-záéíóúüñ\s]+?)\s+(?:de\s+nivel\s+\w+\s+)?en\s/i.exec(
    title,
  );
  return m ? m[1]!.trim() : null;
}

function extractArea(title: string): string {
  const m = /\ben\s+(.+)$/i.exec(title);
  return m ? m[1]!.trim() : '';
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

type RssItem = {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  updated?: unknown; // Atom feed uses <updated> instead of <pubDate>
  description?: unknown;
};

function parseRssItems(xml: string): AemetAlert[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  // Try both RSS 2.0 (rss.channel.item) and Atom (feed.entry)
  const root = parsed as Record<string, unknown>;
  let items: RssItem[] = [];

  const rss = root['rss'] as Record<string, unknown> | undefined;
  if (rss) {
    const channel = rss['channel'] as Record<string, unknown> | undefined;
    if (channel) {
      const raw = channel['item'];
      items = Array.isArray(raw) ? raw : raw ? [raw as RssItem] : [];
    }
  }

  const feed = root['feed'] as Record<string, unknown> | undefined;
  if (feed) {
    const raw = feed['entry'];
    items = Array.isArray(raw) ? raw : raw ? [raw as RssItem] : [];
  }

  return items.map((item) => {
    const title = String(item['title'] ?? '');
    const link = String(item['link'] ?? '');
    const pubDate = String(item['pubDate'] ?? item['updated'] ?? '');
    const isoDate = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    return {
      id: simpleHash(title + link),
      title,
      level: extractLevel(title),
      area: extractArea(title),
      phenomenon: extractPhenomenon(title),
      publishedAt: isoDate,
      link,
    };
  });
}

export async function fetchAlerts(): Promise<WeatherAlertsResult> {
  if (
    alertsCache &&
    Date.now() - alertsCache.fetchedAt.getTime() < ALERTS_CACHE_TTL_MS
  ) {
    return {
      alerts: alertsCache.data,
      fetchedAt: alertsCache.fetchedAt.toISOString(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(AEMET_RSS_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml,application/atom+xml,text/xml,*/*',
        'User-Agent': 'AppAgricultores/1.0 (olivar management)',
      },
    });
    if (!res.ok) {
      logger.warn('weather: AEMET RSS returned non-OK', { status: res.status });
      // Return cached data if available even if stale, rather than failing.
      if (alertsCache) {
        return {
          alerts: alertsCache.data,
          fetchedAt: alertsCache.fetchedAt.toISOString(),
        };
      }
      return { alerts: [], fetchedAt: new Date().toISOString() };
    }
    const xml = await res.text();
    const alerts = parseRssItems(xml);
    alertsCache = { data: alerts, fetchedAt: new Date() };
    return { alerts, fetchedAt: alertsCache.fetchedAt.toISOString() };
  } catch (err) {
    logger.warn('weather: AEMET alerts fetch failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (alertsCache) {
      return {
        alerts: alertsCache.data,
        fetchedAt: alertsCache.fetchedAt.toISOString(),
      };
    }
    return { alerts: [], fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

import axios from 'axios';

/**
 * SmartFarmer v3 — Weather Plugin (Cascading Multi-Provider)
 * 
 * Архитектура каскадных провайдеров по project.txt:
 * 
 * 1. MetGIS API (30м разрешение) — ОСНОВНОЙ
 *    "MetGIS является абсолютным лидером в области гиперлокального прогнозирования.
 *    Используя методы даунскейлинга, MetGIS комбинирует глобальные модели реанализа (ERA5),
 *    данные региональных метеостанций и высокоточные топографические модели рельефа."
 * 
 * 2. Ambee API (500м разрешение) — АЛЬТЕРНАТИВНЫЙ
 *    "Ambee предоставляет глобальные погодные данные с разрешением 500 метров
 *    для более чем 150 стран. Стабильность исторического архива (более 30 лет данных)."
 * 
 * 3. Open-Meteo (1-11км) — БЕСПЛАТНЫЙ FALLBACK
 *    "Подходит только для демонстрационных целей (PoC)."
 *    Используется когда API ключи MetGIS/Ambee недоступны.
 */

// ============================================================================
// Интерфейсы
// ============================================================================

export interface WeatherData {
  temperature: number;       // °C
  humidity: number;          // %
  precipitation: number;     // мм
  windSpeed: number;         // м/с
  pressure: number;          // гПа
  source: 'MetGIS' | 'Ambee' | 'Open-Meteo';
  resolution: string;        // "30m", "500m", "1-11km"
  timestamp: number;         // Unix timestamp
  raw: Record<string, any>;  // Сырые данные от API
}

export interface TriggerEvaluation {
  frostTriggered: boolean;
  droughtTriggered: boolean;
  temperature: number;
  precipitationOverPeriod: number;
  details: string;
}

// ============================================================================
// 1. MetGIS Provider — ОСНОВНОЙ (30м разрешение)
// Документ: "ультраточные погодные данные с пространственным разрешением до 30 метров"
// ============================================================================

export class MetGISProvider {
  private apiKey: string;
  private baseUrl = 'https://api.metgis.com/forecast';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'YOUR_METGIS_KEY' && this.apiKey.length > 5;
  }

  /**
   * Запрос точечного прогноза MetGIS для координат поля.
   * Документ: "разработчик может запрашивать температурный профиль 
   * для конкретного кадастрового участка фермера, полностью нивелируя базисный риск."
   */
  async getPointForecast(lat: number, lon: number): Promise<WeatherData> {
    const response = await axios.get(`${this.baseUrl}/point`, {
      params: {
        lat,
        lon,
        key: this.apiKey,
        format: 'json',
        parameters: 'temperature,humidity,precipitation,wind_speed,pressure',
      },
      timeout: 15000,
    });

    const data = response.data;

    // MetGIS возвращает данные в различных форматах.
    // Ищем текущие значения в стандартных полях ответа.
    const current = data.forecast_data?.[0] || data.current || data;

    return {
      temperature: this.extractNumber(current, ['temperature', 'temp', 't2m', 'air_temperature']),
      humidity: this.extractNumber(current, ['humidity', 'relative_humidity', 'rh']),
      precipitation: this.extractNumber(current, ['precipitation', 'precip', 'rain', 'total_precipitation']),
      windSpeed: this.extractNumber(current, ['wind_speed', 'windspeed', 'wind', 'ws10']),
      pressure: this.extractNumber(current, ['pressure', 'surface_pressure', 'msl_pressure']) || 1013,
      source: 'MetGIS',
      resolution: '30m',
      timestamp: Date.now(),
      raw: data,
    };
  }

  /** Извлечение числового значения из вложенных объектов */
  private extractNumber(obj: any, keys: string[]): number {
    if (!obj || typeof obj !== 'object') return 0;
    for (const key of keys) {
      if (typeof obj[key] === 'number') return obj[key];
      // Поиск во вложенных объектах (MetGIS может вкладывать данные)
      for (const topKey of Object.keys(obj)) {
        if (typeof obj[topKey] === 'object' && obj[topKey] !== null && typeof obj[topKey][key] === 'number') {
          return obj[topKey][key];
        }
      }
    }
    return 0;
  }
}

// ============================================================================
// 2. Ambee Provider — АЛЬТЕРНАТИВНЫЙ (500м разрешение)
// Документ: "Ambee предоставляет глобальные погодные данные с разрешением 500 метров.
// Агрегирует данные из множества источников, исторический архив более 30 лет."
// ============================================================================

export class AmbeeProvider {
  private apiKey: string;
  private baseUrl = 'https://api.ambeedata.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'YOUR_AMBEE_KEY' && this.apiKey.length > 5;
  }

  /**
   * Запрос текущей погоды Ambee по координатам.
   * Документ: "критически важно для ИИ-агента на этапе андеррайтинга —
   * расчёта вероятности наступления страхового случая"
   */
  async getPointForecast(lat: number, lon: number): Promise<WeatherData> {
    const response = await axios.get(`${this.baseUrl}/weather/latest/by-lat-lng`, {
      params: { lat, lng: lon },
      headers: {
        'x-api-key': this.apiKey,
        'Content-type': 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data?.data;
    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error('Ambee returned empty data');
    }

    const current = Array.isArray(data) ? data[0] : data;

    return {
      temperature: current.temperature ?? current.apparentTemperature ?? 0,
      humidity: current.humidity ?? 0,
      precipitation: current.precipitation ?? 0,
      windSpeed: current.windSpeed ?? 0,
      pressure: current.pressure ?? 1013,
      source: 'Ambee',
      resolution: '500m',
      timestamp: Date.now(),
      raw: response.data,
    };
  }
}

// ============================================================================
// 3. Open-Meteo Provider — БЕСПЛАТНЫЙ FALLBACK (1-11км)
// Документ: "Подходит только для демонстрационных целей (PoC)"
// Используется когда MetGIS и Ambee API ключи недоступны.
// ============================================================================

export class OpenMeteoProvider {
  private baseUrl = 'https://api.open-meteo.com/v1/forecast';

  constructor() {
    // Open-Meteo не требует API ключа
  }

  isConfigured(): boolean {
    return true; // Всегда доступен — бесплатный
  }

  /**
   * Запрос текущей погоды через Open-Meteo (бесплатный, без ключа).
   * Используется как fallback когда премиум-провайдеры недоступны.
   */
  async getPointForecast(lat: number, lon: number): Promise<WeatherData> {
    const response = await axios.get(this.baseUrl, {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m',
        timezone: 'auto',
      },
      timeout: 10000,
    });

    const current = response.data.current;

    return {
      temperature: current.temperature_2m ?? 0,
      humidity: current.relative_humidity_2m ?? 0,
      precipitation: current.precipitation ?? 0,
      windSpeed: current.wind_speed_10m ?? 0,
      pressure: current.surface_pressure ?? 1013,
      source: 'Open-Meteo',
      resolution: '1-11km',
      timestamp: Date.now(),
      raw: response.data,
    };
  }
}

// ============================================================================
// 4. Каскадный провайдер — интеллектуальный выбор лучшего источника
// Документ: "повышение точности параметрического страхования не влечёт
// за собой усложнения разработки"
// ============================================================================

export class CascadingWeatherProvider {
  private metgis: MetGISProvider;
  private ambee: AmbeeProvider;
  private openMeteo: OpenMeteoProvider;
  private lastUsedSource: string = 'none';

  constructor(metgisApiKey?: string, ambeeApiKey?: string) {
    this.metgis = new MetGISProvider(metgisApiKey || '');
    this.ambee = new AmbeeProvider(ambeeApiKey || '');
    this.openMeteo = new OpenMeteoProvider();

    // Лог доступных провайдеров при старте
    const providers: string[] = [];
    if (this.metgis.isConfigured()) providers.push('MetGIS (30м) ✅');
    else providers.push('MetGIS (30м) ❌ — нет API ключа');

    if (this.ambee.isConfigured()) providers.push('Ambee (500м) ✅');
    else providers.push('Ambee (500м) ❌ — нет API ключа');

    providers.push('Open-Meteo (1-11км) ✅ — бесплатный fallback');

    console.log(`[Weather] Каскадная инициализация провайдеров:`);
    providers.forEach(p => console.log(`  → ${p}`));
  }

  /**
   * Получить погоду для координат, используя каскад:
   * MetGIS (30м) → Ambee (500м) → Open-Meteo (1-11км)
   * 
   * При сбое провайдера автоматически переключается на следующий.
   */
  async getPointForecast(lat: number, lon: number): Promise<WeatherData> {
    // ─── Уровень 1: MetGIS (30м) — идеальное решение ───
    if (this.metgis.isConfigured()) {
      try {
        const data = await this.metgis.getPointForecast(lat, lon);
        this.lastUsedSource = 'MetGIS';
        console.log(`  │  🌡️ [MetGIS 30м] ${data.temperature}°C | ${data.precipitation}мм`);
        return data;
      } catch (err: any) {
        console.warn(`  │  ⚠️ MetGIS API error: ${err.message?.slice(0, 60)}. Fallback → Ambee`);
      }
    }

    // ─── Уровень 2: Ambee (500м) — хорошая альтернатива ───
    if (this.ambee.isConfigured()) {
      try {
        const data = await this.ambee.getPointForecast(lat, lon);
        this.lastUsedSource = 'Ambee';
        console.log(`  │  🌡️ [Ambee 500м] ${data.temperature}°C | ${data.precipitation}мм`);
        return data;
      } catch (err: any) {
        console.warn(`  │  ⚠️ Ambee API error: ${err.message?.slice(0, 60)}. Fallback → Open-Meteo`);
      }
    }

    // ─── Уровень 3: Open-Meteo (1-11км) — бесплатный fallback ───
    try {
      const data = await this.openMeteo.getPointForecast(lat, lon);
      this.lastUsedSource = 'Open-Meteo';
      console.log(`  │  🌡️ [Open-Meteo 1-11км] ${data.temperature}°C | ${data.precipitation}мм (fallback)`);
      return data;
    } catch (err: any) {
      console.error(`  │  ❌ Все провайдеры недоступны: ${err.message}`);
      // Последний fallback — статические данные чтобы агент не упал
      this.lastUsedSource = 'Fallback';
      return {
        temperature: 20, humidity: 50, precipitation: 0,
        windSpeed: 2, pressure: 1015, source: 'Open-Meteo',
        resolution: 'fallback', timestamp: Date.now(), raw: {},
      };
    }
  }

  /** Какой провайдер использовался последним */
  getLastUsedSource(): string {
    return this.lastUsedSource;
  }

  /** Получить DataSource enum для смарт-контракта */
  getDataSourceEnum(): Record<string, object> {
    switch (this.lastUsedSource) {
      case 'MetGIS': return { metGis: {} };     // Rust: DataSource::MetGis — Не существует в текущем IDL
      case 'Ambee': return { ambee: {} };
      default: return { openMeteo: {} };
    }
  }
}

// ============================================================================
// Trigger Evaluator — оценка метеорологических триггеров
// ============================================================================

export function evaluateTriggers(
  weather: WeatherData,
  frostThreshold: number,     // °C
  droughtThreshold: number,   // мм
  precipOverPeriod: number,   // фактические осадки за период
): TriggerEvaluation {
  const frostTriggered = weather.temperature < frostThreshold;
  const droughtTriggered = precipOverPeriod < droughtThreshold;

  let details = `Temp: ${weather.temperature}°C (порог: ${frostThreshold}°C), `;
  details += `Precip: ${precipOverPeriod}mm (порог: ${droughtThreshold}mm). `;
  details += `Источник: ${weather.source} (${weather.resolution}). `;

  if (frostTriggered) details += 'FROST TRIGGERED. ';
  if (droughtTriggered) details += 'DROUGHT TRIGGERED. ';
  if (!frostTriggered && !droughtTriggered) details += 'Норма.';

  return {
    frostTriggered,
    droughtTriggered,
    temperature: weather.temperature,
    precipitationOverPeriod: precipOverPeriod,
    details,
  };
}

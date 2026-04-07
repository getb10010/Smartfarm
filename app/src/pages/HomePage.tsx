import { useState, useEffect } from 'react';
import WeatherCard from '../components/Dashboard/WeatherCard';
import NdviCard from '../components/Dashboard/NdviCard';
import PolicyCard from '../components/Dashboard/PolicyCard';
import AlertBanner from '../components/Dashboard/AlertBanner';
import StatsGrid from '../components/Dashboard/StatsGrid';
import MapWidget from '../components/Dashboard/MapWidget';
import AiRecommendationCard from '../components/Dashboard/AiRecommendationCard';
import { useSmartFarmer } from '../lib/useSmartFarmer';
import './HomePage.css';

// Fallback data (показывается пока нет данных из блокчейна)
const FALLBACK_WEATHER = {
  temperature: 0,
  humidity: 0,
  precipitation: 0,
  windSpeed: 0,
  source: '—',
  resolution: '—',
  location: 'Ожидание данных...',
  forecast: 'Подключите кошелёк и купите полис для мониторинга',
};

const FALLBACK_NDVI = {
  current: 0,
  historical: 0,
  delta: 0,
  source: '—',
  lastUpdate: 'Нет данных',
};

const DEMO_RECOMMENDATION = {
  type: 'FrostWarning',
  urgency: 'high' as const,
  message: 'Ожидается понижение температуры до -5°C в ближайшие 12 часов. Рекомендуется провести превентивный полив участка для защиты озимой пшеницы от заморозков.',
  timestamp: 'Только что',
  teeHash: 'a1b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef01',
};

export default function HomePage() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [weatherData, setWeatherData] = useState(FALLBACK_WEATHER);
  const [ndviData, setNdviData] = useState(FALLBACK_NDVI);
  const [alertData, setAlertData] = useState<{ type: 'warning' | 'info' | 'success'; title: string; message: string; timestamp: string } | null>(null);

  const {
    connected,
    fetchMyPolicies,
    fetchAllWeatherReports,
    fetchAllNdviReports,
    fetchPool,
  } = useSmartFarmer();

  // Fetch actual policies from Solana whenever wallet is connected
  useEffect(() => {
    const loadPolicies = async () => {
      if (!connected) {
        setPolicies([]);
        return;
      }
      setLoading(true);
      try {
        const rawPolicies = await fetchMyPolicies();
        const formatted = rawPolicies.map((p: any) => {
          const statusStr = Object.keys(p.status || { unknown: {} })[0];
          const cropStr = Object.keys(p.cropType || { unknown: {} })[0];

          return {
            id: p.policyId?.toNumber?.() ?? p.policyId,
            crop: `🌱 ${cropStr}`,
            area: `${((p.areaHectaresX100 ?? 0) / 100).toFixed(1)} га`,
            status: statusStr.toLowerCase(),
            coverage: `${((p.maxCoverage?.toNumber?.() ?? p.maxCoverage ?? 0) / 1_000_000).toLocaleString()} USDC`,
            premium: `${((p.premiumPaid?.toNumber?.() ?? p.premiumPaid ?? 0) / 1_000_000).toLocaleString()} USDC`,
            triggers: `T < ${(p.frostTriggerTempX100 ?? 0) / 100}°C, Осадки < ${(p.droughtTriggerPrecipX100 ?? 0) / 100}мм/${p.droughtPeriodDays ?? 0}д`,
            ndviThreshold: `${(p.ndviDropTriggerX10000 ?? 0) / 100}% падение`,
            region: `[Lat: ${((p.latitude?.toNumber?.() ?? p.latitude ?? 0) / 1e6).toFixed(2)}, Lon: ${((p.longitude?.toNumber?.() ?? p.longitude ?? 0) / 1e6).toFixed(2)}]`
          };
        });
        setPolicies(formatted);
      } catch (err) {
        console.error("Ошибка загрузки полисов", err);
      } finally {
        setLoading(false);
      }
    };

    loadPolicies();
  }, [connected, fetchMyPolicies]);

  // Fetch live weather & NDVI from blockchain (Oracle-submitted reports)
  useEffect(() => {
    const loadOracleData = async () => {
      try {
        // Fetch latest weather report from blockchain
        const weatherReports = await fetchAllWeatherReports();
        if (weatherReports.length > 0) {
          const latest = weatherReports[0];
          const temp = (latest.temperatureX100 ?? 0) / 100;
          const precip = (latest.precipitationX100 ?? 0) / 100;
          const humid = (latest.humidityX100 ?? 0) / 100;
          const wind = (latest.windSpeedX100 ?? 0) / 100;
          const sourceKey = Object.keys(latest.dataSource || {})[0] || 'unknown';
          const sourceMap: Record<string, string> = { metGis: 'MetGIS', ambee: 'Ambee', dtnClearAg: 'DTN ClearAg', xweather: 'Xweather' };
          const ts = latest.timestamp?.toNumber?.() ?? latest.timestamp;
          const ago = ts ? getTimeAgo(ts * 1000) : '—';

          setWeatherData({
            temperature: temp,
            humidity: humid,
            precipitation: precip,
            windSpeed: wind,
            source: sourceMap[sourceKey] || sourceKey,
            resolution: '30м',
            location: 'Devnet Oracle',
            forecast: latest.frostTriggered
              ? '🥶 ЗАМОРОЗКИ ОБНАРУЖЕНЫ!'
              : latest.droughtTriggered
                ? '☀️ ЗАСУХА ОБНАРУЖЕНА!'
                : `Обновлено: ${ago}`,
          });

          // Update alert based on triggers
          if (latest.frostTriggered || latest.droughtTriggered) {
            setAlertData({
              type: 'warning',
              title: latest.frostTriggered ? '🥶 Сработал триггер заморозков!' : '☀️ Сработал триггер засухи!',
              message: latest.frostTriggered
                ? `Температура ${temp}°C опустилась ниже порога. ИИ-оракул зафиксировал событие в блокчейне.`
                : `Осадки ${precip}мм ниже порога. ИИ-оракул зафиксировал событие в блокчейне.`,
              timestamp: ago,
            });
          }
        }

        // Fetch latest NDVI report from blockchain
        const ndviReports = await fetchAllNdviReports();
        if (ndviReports.length > 0) {
          const latest = ndviReports[0];
          const mean = (latest.meanNdviX10000 ?? 0) / 10000;
          const hist = (latest.historicalMeanX10000 ?? 0) / 10000;
          const delta = (latest.deltaFromNormX100 ?? 0) / 100;
          const sourceKey = Object.keys(latest.satelliteSource || {})[0] || 'unknown';
          const sourceMap: Record<string, string> = { eosda: 'EOSDA', leaf: 'Leaf', farmonaut: 'Farmonaut' };
          const ts = latest.timestamp?.toNumber?.() ?? latest.timestamp;

          setNdviData({
            current: mean,
            historical: hist,
            delta: delta,
            source: sourceMap[sourceKey] || sourceKey,
            lastUpdate: ts ? getTimeAgo(ts * 1000) : '—',
          });
        }

        // Pool info for the alert if no triggers
        const pool = await fetchPool();
        if (pool && !alertData) {
          setAlertData({
            type: 'info',
            title: '✅ Подключено к Solana Devnet',
            message: `Страховой пул активен. Полисов в системе: ${pool.policyCount?.toNumber?.() ?? pool.policyCount ?? 0}. Данные читаются из блокчейна.`,
            timestamp: 'Сейчас',
          });
        }
      } catch (err) {
        console.warn('Не удалось загрузить данные оракула:', err);
      }
    };

    loadOracleData();
  }, [connected, fetchAllWeatherReports, fetchAllNdviReports, fetchPool]);

  // Default alert if nothing loaded
  const displayAlert = alertData || {
    type: 'info' as const,
    title: '🔗 SmartFarmer v3 — Devnet',
    message: 'Подключите кошелёк для просмотра данных из блокчейна. Оракул записывает погоду и NDVI каждый час.',
    timestamp: 'Сейчас',
  };

  return (
    <div className="page">
      {/* Hero — gradient title */}
      <div className="animate-slide-up stagger-1">
        <h1 className="home-hero-title">
          <span className="gradient-text">SmartFarmer</span>
          <span className="home-hero-version">v3</span>
        </h1>
        <p className="home-hero-subtitle">
          Параметрическое агрострахование • Solana Devnet • TEE Oracle
        </p>
      </div>

      {/* Alert */}
      <div className="animate-slide-up stagger-2">
        <AlertBanner alert={displayAlert} />
      </div>

      {/* Stats */}
      <div className="animate-slide-up stagger-3">
        <StatsGrid />
      </div>

      {/* Map */}
      <div className="animate-scale-in stagger-4">
        <h2 className="section-title">🗺️ Мониторинг поля</h2>
        <MapWidget lat={43.2567} lon={76.9286} ndviValue={ndviData.current || 0.65} label="Туркестанская обл." />
      </div>

      {/* Weather */}
      <div className="animate-slide-up stagger-5">
        <h2 className="section-title">🌤️ Метеоданные из блокчейна</h2>
        <WeatherCard data={weatherData} />
      </div>

      {/* NDVI */}
      <div className="animate-slide-up stagger-6">
        <h2 className="section-title">🛰️ Спутниковый NDVI</h2>
        <NdviCard data={ndviData} />
      </div>

      {/* AI Recommendation */}
      <div className="animate-slide-up stagger-7">
        <h2 className="section-title">🤖 ИИ-Агроном</h2>
        <AiRecommendationCard rec={DEMO_RECOMMENDATION} />
      </div>

      {/* Policies */}
      <div className="animate-slide-up stagger-8">
        <h2 className="section-title">📋 Активные полисы</h2>
        <div className="policies-list">
          {loading ? (
            <div className="policies-empty">
              <div className="skeleton" style={{ height: 80, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 80 }} />
            </div>
          ) : policies.length === 0 ? (
            <div className="policies-empty">
              <div className="policies-empty-icon">📋</div>
              <p>{connected ? "У вас пока нет купленных полисов." : "Подключите кошелек для просмотра."}</p>
            </div>
          ) : (
            policies.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Helper: human-readable relative time
function getTimeAgo(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

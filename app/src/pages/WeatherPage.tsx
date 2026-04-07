import './WeatherPage.css';

const FORECAST_DAYS = [
  { day: 'Пн', date: '31.03', tempHigh: 2, tempLow: -6, precip: 0, icon: '❄️', ndvi: null },
  { day: 'Вт', date: '01.04', tempHigh: -1, tempLow: -8, precip: 0, icon: '🥶', ndvi: 0.65 },
  { day: 'Ср', date: '02.04', tempHigh: 3, tempLow: -4, precip: 1.2, icon: '🌤️', ndvi: null },
  { day: 'Чт', date: '03.04', tempHigh: 7, tempLow: 0, precip: 5.8, icon: '🌧️', ndvi: null },
  { day: 'Пт', date: '04.04', tempHigh: 10, tempLow: 2, precip: 3.2, icon: '🌦️', ndvi: null },
  { day: 'Сб', date: '05.04', tempHigh: 12, tempLow: 4, precip: 0, icon: '☀️', ndvi: 0.62 },
  { day: 'Вс', date: '06.04', tempHigh: 14, tempLow: 5, precip: 0, icon: '☀️', ndvi: null },
];

const DATA_SOURCES = [
  { name: 'MetGIS', resolution: '30м', status: 'active', desc: 'Гиперлокальный даунскейлинг + топография' },
  { name: 'Ambee', resolution: '500м', status: 'active', desc: 'Глобальное покрытие, 30+ лет архива' },
  { name: 'EOSDA', resolution: '10м', status: 'active', desc: 'Sentinel-2 NDVI агрегация' },
  { name: 'Solcast', resolution: '90м', status: 'standby', desc: 'Солнечное излучение (дополнительно)' },
];

export default function WeatherPage() {
  return (
    <div className="page">
      <h1 className="page-title">🌤️ Метеоаналитика</h1>

      {/* Текущие условия */}
      <div className="glass-card weather-current animate-fade-in">
        <div className="wc-header">
          <div>
            <span className="wc-temp">-3.5°C</span>
            <span className="wc-feels">Ощущается как -7°C</span>
          </div>
          <div className="wc-icon">🥶</div>
        </div>
        <div className="wc-location">📍 Туркестанская область • 43.300°N, 68.250°E</div>
        <div className="wc-grid">
          <div className="wc-metric">
            <span className="wc-metric-label">Влажность</span>
            <span className="wc-metric-val">78%</span>
          </div>
          <div className="wc-metric">
            <span className="wc-metric-label">Давление</span>
            <span className="wc-metric-val">1013 гПа</span>
          </div>
          <div className="wc-metric">
            <span className="wc-metric-label">Ветер</span>
            <span className="wc-metric-val">4.8 м/с</span>
          </div>
          <div className="wc-metric">
            <span className="wc-metric-label">Осадки 24ч</span>
            <span className="wc-metric-val">2.1 мм</span>
          </div>
        </div>
        <span className="badge badge-success" style={{ marginTop: '0.75rem' }}>MetGIS • 30м разрешение</span>
      </div>

      {/* 7-дневный прогноз */}
      <h2 className="section-title">📅 7-дневный прогноз</h2>
      <div className="glass-card forecast-card animate-fade-in" style={{ animationDelay: '0.2s' }}>
        {FORECAST_DAYS.map((day, i) => (
          <div key={i} className={`forecast-day ${day.tempLow < -5 ? 'forecast-day--frost' : ''}`}>
            <span className="fd-day">{day.day}</span>
            <span className="fd-date">{day.date}</span>
            <span className="fd-icon">{day.icon}</span>
            <div className="fd-temps">
              <span className="fd-high">{day.tempHigh > 0 ? '+' : ''}{day.tempHigh}°</span>
              <span className="fd-low">{day.tempLow > 0 ? '+' : ''}{day.tempLow}°</span>
            </div>
            <span className="fd-precip">{day.precip > 0 ? `${day.precip}мм` : '—'}</span>
            {day.ndvi !== null && (
              <span className="fd-ndvi">🛰️ {day.ndvi}</span>
            )}
          </div>
        ))}
      </div>

      {/* Источники данных */}
      <h2 className="section-title" style={{ marginTop: '1.5rem' }}>📡 Источники данных</h2>
      <div className="data-sources">
        {DATA_SOURCES.map((src, i) => (
          <div key={i} className="glass-card source-card animate-fade-in" style={{ animationDelay: `${0.3 + i * 0.1}s` }}>
            <div className="source-header">
              <span className="source-name">{src.name}</span>
              <span className={`badge ${src.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                {src.status === 'active' ? '● Активен' : '○ Ожидание'}
              </span>
            </div>
            <div className="source-resolution">{src.resolution} разрешение</div>
            <div className="source-desc">{src.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

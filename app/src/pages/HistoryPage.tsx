import { useState, useEffect } from 'react';
import { useSmartFarmer } from '../lib/useSmartFarmer';
import './HistoryPage.css';

interface HistoryEvent {
  id: string;
  type: 'payout' | 'weather' | 'ndvi' | 'recommendation';
  icon: string;
  title: string;
  description: string;
  timestamp: number;
  details: Record<string, string>;
  badge: { label: string; class: string };
}


export default function HistoryPage() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'payout' | 'weather' | 'ndvi' | 'recommendation'>('all');

  const {
    connected,
    fetchAllPolicies,
    fetchAllWeatherReports,
    fetchAllNdviReports,
    fetchAllRecommendations,
  } = useSmartFarmer();

  useEffect(() => {
    const loadHistory = async () => {
      if (!connected) {
        setEvents([]);
        return;
      }
      setLoading(true);
      try {
        const allEvents: HistoryEvent[] = [];

        // 1. Policies with PaidOut status = payout events
        const policies = await fetchAllPolicies();
        policies.forEach((p: any) => {
          const status = Object.keys(p.status || {})[0]?.toLowerCase();
          const totalPaid = p.totalPaidOut?.toNumber?.() ?? p.totalPaidOut ?? 0;
          if (status === 'paidout' && totalPaid > 0) {
            const crop = Object.keys(p.cropType || {})[0] || 'unknown';
            const ts = p.coverageEnd?.toNumber?.() ?? p.coverageEnd ?? 0;
            allEvents.push({
              id: `payout-${p.policyId?.toNumber?.() ?? p.policyId}`,
              type: 'payout',
              icon: '💰',
              title: `Выплата по полису #${p.policyId?.toNumber?.() ?? p.policyId}`,
              description: `Автоматическая компенсация ${(totalPaid / 1_000_000).toFixed(0)} USDC для культуры ${crop}. Статус: выплачено.`,
              timestamp: ts * 1000,
              details: {
                'Сумма': `${(totalPaid / 1_000_000).toFixed(2)} USDC`,
                'Покрытие': `${((p.maxCoverage?.toNumber?.() ?? 0) / 1_000_000).toFixed(0)} USDC`,
                'Культура': crop,
                'Площадь': `${((p.areaHectaresX100 ?? 0) / 100).toFixed(1)} га`,
              },
              badge: { label: 'Выплачено', class: 'badge-success' },
            });
          }
        });

        // 2. Weather reports
        const weatherReports = await fetchAllWeatherReports();
        weatherReports.forEach((w: any, i: number) => {
          const temp = (w.temperatureX100 ?? 0) / 100;
          const precip = (w.precipitationX100 ?? 0) / 100;
          const humid = (w.humidityX100 ?? 0) / 100;
          const wind = (w.windSpeedX100 ?? 0) / 100;
          const ts = w.timestamp?.toNumber?.() ?? w.timestamp ?? 0;
          const sourceKey = Object.keys(w.dataSource || {})[0] || 'unknown';
          const sourceMap: Record<string, string> = { metGis: 'MetGIS', ambee: 'Ambee', dtnClearAg: 'DTN', xweather: 'Xweather' };
          const triggered = w.frostTriggered || w.droughtTriggered;

          allEvents.push({
            id: `weather-${i}-${ts}`,
            type: 'weather',
            icon: triggered ? '⚠️' : '🌡️',
            title: triggered
              ? `${w.frostTriggered ? '🥶 Заморозки!' : '☀️ Засуха!'} — ${temp}°C`
              : `Метеоотчёт — ${temp}°C`,
            description: `Осадки: ${precip}мм, Влажность: ${humid}%, Ветер: ${wind} м/с. Источник: ${sourceMap[sourceKey] || sourceKey}.`,
            timestamp: ts * 1000,
            details: {
              'Температура': `${temp}°C`,
              'Осадки': `${precip} мм`,
              'Влажность': `${humid}%`,
              'Источник': sourceMap[sourceKey] || sourceKey,
            },
            badge: triggered
              ? { label: w.frostTriggered ? 'ЗАМОРОЗКИ' : 'ЗАСУХА', class: 'badge-danger' }
              : { label: 'Норма', class: 'badge-info' },
          });
        });

        // 3. NDVI reports
        const ndviReports = await fetchAllNdviReports();
        ndviReports.forEach((n: any, i: number) => {
          const mean = (n.meanNdviX10000 ?? 0) / 10000;
          const hist = (n.historicalMeanX10000 ?? 0) / 10000;
          const delta = (n.deltaFromNormX100 ?? 0) / 100;
          const ts = n.timestamp?.toNumber?.() ?? n.timestamp ?? 0;
          const sourceKey = Object.keys(n.satelliteSource || {})[0] || 'unknown';
          const sourceMap: Record<string, string> = { eosda: 'EOSDA', leaf: 'Leaf', farmonaut: 'Farmonaut' };

          allEvents.push({
            id: `ndvi-${i}-${ts}`,
            type: 'ndvi',
            icon: n.ndviTriggered ? '🚨' : '🛰️',
            title: n.ndviTriggered
              ? `Спутник подтвердил ущерб — NDVI ${mean.toFixed(2)}`
              : `NDVI отчёт — ${mean.toFixed(2)}`,
            description: `Историческая норма: ${hist.toFixed(2)}, Дельта: ${delta.toFixed(1)}%. Спутник: ${sourceMap[sourceKey] || sourceKey}.`,
            timestamp: ts * 1000,
            details: {
              'Текущий NDVI': mean.toFixed(3),
              'Норма': hist.toFixed(3),
              'Изменение': `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
              'Источник': sourceMap[sourceKey] || sourceKey,
            },
            badge: n.ndviTriggered
              ? { label: 'УЩЕРБ', class: 'badge-danger' }
              : { label: 'В норме', class: 'badge-info' },
          });
        });

        // 4. Recommendations
        const recommendations = await fetchAllRecommendations();
        recommendations.forEach((r: any, i: number) => {
          const ts = r.timestamp?.toNumber?.() ?? r.timestamp ?? 0;
          const recTypeKey = Object.keys(r.recType || {})[0] || 'general';
          const urgencyKey = Object.keys(r.urgency || {})[0] || 'info';
          const recTypeMap: Record<string, string> = {
            irrigation: 'Ирригация', frostWarning: 'Заморозки', droughtWarning: 'Засуха',
            fertilization: 'Удобрения', harvest: 'Уборка', general: 'Общая',
          };
          const urgencyMap: Record<string, string> = {
            info: 'Инфо', medium: 'Средняя', high: 'Высокая', critical: 'Критическая',
          };
          const urgencyBadge: Record<string, string> = {
            info: 'badge-info', medium: 'badge-solana', high: 'badge-warning', critical: 'badge-danger',
          };

          allEvents.push({
            id: `rec-${i}-${ts}`,
            type: 'recommendation',
            icon: urgencyKey === 'critical' ? '🚨' : urgencyKey === 'high' ? '⚠️' : '🌱',
            title: `${recTypeMap[recTypeKey] || recTypeKey} [${urgencyMap[urgencyKey] || urgencyKey}]`,
            description: r.message || 'Рекомендация ИИ-агронома.',
            timestamp: ts * 1000,
            details: {
              'Тип': recTypeMap[recTypeKey] || recTypeKey,
              'Срочность': urgencyMap[urgencyKey] || urgencyKey,
            },
            badge: { label: urgencyMap[urgencyKey] || 'Инфо', class: urgencyBadge[urgencyKey] || 'badge-info' },
          });
        });

        // Sort by timestamp descending
        allEvents.sort((a, b) => b.timestamp - a.timestamp);
        setEvents(allEvents);
      } catch (err) {
        console.error('Error loading history:', err);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [connected, fetchAllPolicies, fetchAllWeatherReports, fetchAllNdviReports, fetchAllRecommendations]);

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);

  const counts = {
    all: events.length,
    payout: events.filter(e => e.type === 'payout').length,
    weather: events.filter(e => e.type === 'weather').length,
    ndvi: events.filter(e => e.type === 'ndvi').length,
    recommendation: events.filter(e => e.type === 'recommendation').length,
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📜 История событий</h1>
      </div>

      {/* Filter tabs */}
      <div className="history-filters">
        {([
          { key: 'all', label: 'Все', icon: '📋' },
          { key: 'payout', label: 'Выплаты', icon: '💰' },
          { key: 'weather', label: 'Погода', icon: '🌡️' },
          { key: 'ndvi', label: 'NDVI', icon: '🛰️' },
          { key: 'recommendation', label: 'Советы', icon: '🌱' },
        ] as const).map(f => (
          <button
            key={f.key}
            className={`history-filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            <span>{f.icon}</span>
            <span>{f.label}</span>
            {counts[f.key] > 0 && <span className="filter-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* Events list */}
      <div className="history-list">
        {!connected ? (
          <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <h3>Кошелёк не подключён</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Подключите кошелёк для просмотра истории событий из блокчейна.</p>
          </div>
        ) : loading ? (
          <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <div className="history-loading-spinner" />
            <h3>Загрузка из Solana...</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Чтение WeatherReport, NdviReport и Recommendation аккаунтов...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
            <h3>Нет событий</h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              {filter === 'all'
                ? 'История пуста. Оракул ещё не записывал данные в блокчейн.'
                : `Нет событий типа "${filter}".`}
            </p>
          </div>
        ) : (
          filtered.map((event, idx) => (
            <div
              key={event.id}
              className={`glass-card history-event animate-fade-in ${event.type === 'payout' ? 'history-event--payout' : ''}`}
              style={{ animationDelay: `${idx * 0.05}s` }}
            >
              <div className="history-event-header">
                <div className="history-event-icon">{event.icon}</div>
                <div className="history-event-meta">
                  <div className="history-event-title">{event.title}</div>
                  <div className="history-event-time">{formatTimestamp(event.timestamp)}</div>
                </div>
                <span className={`badge ${event.badge.class}`}>{event.badge.label}</span>
              </div>

              <p className="history-event-desc">{event.description}</p>

              <div className="history-event-details">
                {Object.entries(event.details).map(([key, value]) => (
                  <div key={key} className="history-detail">
                    <span className="history-detail-label">{key}</span>
                    <span className="history-detail-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Summary stats */}
      {events.length > 0 && (
        <div className="glass-card history-summary">
          <h4>📊 Сводка</h4>
          <div className="history-summary-grid">
            <div className="history-stat">
              <span className="history-stat-value">{counts.payout}</span>
              <span className="history-stat-label">Выплат</span>
            </div>
            <div className="history-stat">
              <span className="history-stat-value">{counts.weather}</span>
              <span className="history-stat-label">Метеоотчётов</span>
            </div>
            <div className="history-stat">
              <span className="history-stat-value">{counts.ndvi}</span>
              <span className="history-stat-label">NDVI снимков</span>
            </div>
            <div className="history-stat">
              <span className="history-stat-value">{counts.recommendation}</span>
              <span className="history-stat-label">Рекомендаций</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const date = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

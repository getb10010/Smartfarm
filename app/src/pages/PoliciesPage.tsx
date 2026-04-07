import { useState, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useSmartFarmer } from '../lib/useSmartFarmer';
import './PoliciesPage.css';

const STATUS_STYLES: Record<string, { label: string; class: string }> = {
  active: { label: 'Активен', class: 'badge-success' },
  triggeredawaitingndvi: { label: 'Ожидание NDVI', class: 'badge-warning' },
  paidout: { label: 'Выплачено', class: 'badge-info' },
  expired: { label: 'Истёк', class: 'badge-danger' },
  pending: { label: 'Ожидание', class: 'badge-solana' },
  cancelled: { label: 'Отменён', class: 'badge-danger' },
};

export default function PoliciesPage() {
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const { connected, publicKey, fetchPool, purchasePolicy, fetchMyPolicies } = useSmartFarmer();

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
          // Parse Anchor enums (e.g. { active: {} })
          const statusStr = Object.keys(p.status || { unknown: {} })[0];
          const cropStr = Object.keys(p.cropType || { unknown: {} })[0];

          // Determine start and end dates from UNIX timestamps
          const startStr = p.coverageStart ? new Date(p.coverageStart.toNumber() * 1000).toLocaleDateString() : '—';
          const endStr = p.coverageEnd ? new Date(p.coverageEnd.toNumber() * 1000).toLocaleDateString() : '—';

          return {
            id: p.policyId?.toNumber?.() ?? p.policyId,
            crop: `🌱 ${cropStr}`,
            area: ((p.areaHectaresX100 ?? 0) / 100).toFixed(1),
            status: statusStr.toLowerCase(),
            coverage: ((p.maxCoverage?.toNumber?.() ?? p.maxCoverage ?? 0) / 1_000_000).toFixed(0),
            premium: ((p.premiumPaid?.toNumber?.() ?? p.premiumPaid ?? 0) / 1_000_000).toFixed(0),
            totalPaid: ((p.totalPaidOut?.toNumber?.() ?? p.totalPaidOut ?? 0) / 1_000_000).toFixed(0),
            frostTrigger: (p.frostTriggerTempX100 ?? 0) / 100,
            droughtTrigger: (p.droughtTriggerPrecipX100 ?? 0) / 100,
            droughtDays: p.droughtPeriodDays ?? 0,
            ndviThreshold: (p.ndviDropTriggerX10000 ?? 0) / 100,
            region: `[Lat: ${((p.latitude?.toNumber?.() ?? p.latitude ?? 0) / 1e6).toFixed(2)}, Lon: ${((p.longitude?.toNumber?.() ?? p.longitude ?? 0) / 1e6).toFixed(2)}]`,
            start: startStr,
            end: endStr,
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

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📋 Мои полисы</h1>
        <button className="btn-primary" onClick={() => setShowBuyModal(true)}>
          + Купить полис
        </button>
      </div>

      <div className="policies-full-list">
        {!connected ? (
           <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
             <h3>Кошелёк не подключён</h3>
             <p style={{ color: 'var(--text-secondary)' }}>Подключите кошелёк (Devnet) для просмотра ваших полисов из блокчейна.</p>
           </div>
        ) : loading ? (
           <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
             <h3>Загрузка из Solana...</h3>
           </div>
        ) : policies.length === 0 ? (
           <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
             <h3>У вас нет активных полисов</h3>
             <p style={{ color: 'var(--text-secondary)' }}>Нажмите «Купить полис», чтобы заключить параметрический смарт-контракт.</p>
           </div>
        ) : (
          policies.map((policy) => {
            const info = STATUS_STYLES[policy.status] || STATUS_STYLES.active;
            return (
              <div key={policy.id} className="glass-card policy-full-card animate-fade-in">
                <div className="policy-full-header">
                  <div>
                    <div className="policy-full-name">{policy.crop}</div>
                    <div className="policy-full-id">Полис #{policy.id} • {policy.region}</div>
                  </div>
                  <span className={`badge ${info.class}`}>{info.label}</span>
                </div>

                <div className="policy-full-grid">
                  <div className="pf-item">
                    <span className="pf-label">Площадь</span>
                    <span className="pf-value">{policy.area} га</span>
                  </div>
                  <div className="pf-item">
                    <span className="pf-label">Премия</span>
                    <span className="pf-value">{policy.premium} USDC</span>
                  </div>
                  <div className="pf-item">
                    <span className="pf-label">Покрытие</span>
                    <span className="pf-value highlight">{policy.coverage} USDC</span>
                  </div>
                  <div className="pf-item">
                    <span className="pf-label">Выплачено</span>
                    <span className="pf-value">{policy.totalPaid} USDC</span>
                  </div>
                </div>

                <div className="policy-full-triggers">
                  <h4>Параметрические триггеры</h4>
                  <div className="trigger-chips">
                    <span className="trigger-chip">🥶 Заморозки &lt; {policy.frostTrigger}°C</span>
                    <span className="trigger-chip">☀️ Засуха &lt; {policy.droughtTrigger}мм / {policy.droughtDays}д</span>
                    <span className="trigger-chip">🛰️ NDVI падение &gt; {policy.ndviThreshold}%</span>
                  </div>
                </div>

                <div className="policy-full-dates">
                  <span>{policy.start}</span>
                  <span className="policy-date-separator">→</span>
                  <span>{policy.end}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showBuyModal && (
        <div className="modal-overlay" onClick={() => setShowBuyModal(false)}>
          <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">🌾 Купить полис</h2>
            <p className="modal-desc">
              Укажите координаты поля, выберите культуру и параметры триггеров.
              Оплата премии происходит автоматически через Solana.
            </p>
            <div className="modal-form">
              <div className="form-group">
                <label>Культура</label>
                <select className="form-select">
                  <option>🌾 Озимая пшеница</option>
                  <option>🌿 Яровая пшеница</option>
                  <option>🌱 Ячмень</option>
                  <option>🍚 Рис</option>
                  <option>☁️ Хлопок</option>
                  <option>🌻 Подсолнечник</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Широта</label>
                  <input type="number" className="form-input" placeholder="43.3" step="0.0001" defaultValue="43.3" />
                </div>
                <div className="form-group">
                  <label>Долгота</label>
                  <input type="number" className="form-input" placeholder="68.25" step="0.0001" defaultValue="68.25" />
                </div>
              </div>
              <div className="form-group">
                <label>Площадь (га)</label>
                <input type="number" className="form-input" placeholder="100" defaultValue="15" />
              </div>
              <div className="form-group">
                <label>Порог заморозков (°C)</label>
                <input type="number" className="form-input" placeholder="-5" defaultValue="-5" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Мин. осадки (мм)</label>
                  <input type="number" className="form-input" placeholder="10" defaultValue="20" />
                </div>
                <div className="form-group">
                  <label>За период (дней)</label>
                  <input type="number" className="form-input" placeholder="14" defaultValue="20" />
                </div>
              </div>
              <button 
                className="btn-solana modal-submit" 
                onClick={async () => {
                  if (!connected || !publicKey) {
                    alert("Подключите кошелек в правом верхнем углу!");
                    return;
                  }
                  try {
                    const POOL_ADMIN = new PublicKey("GA6jvomaWL41c5aPX8GnHxq2b2DD9h9GyxZpxSVbZYbr");
                    const pool = await fetchPool();
                    if (!pool) {
                       alert("Пул не найден!");
                       return;
                    }

                    const SPL_ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
                    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
                    const [farmerTokenAccount] = PublicKey.findProgramAddressSync(
                      [publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), pool.tokenMint.toBuffer()],
                      SPL_ATA_PROGRAM_ID
                    );

                    await purchasePolicy({
                      poolAdmin: POOL_ADMIN,
                      latitude: 43.3,
                      longitude: 68.25,
                      areaHectares: 15,
                      cropType: { winterWheat: {} },
                      frostTriggerTemp: -5,
                      droughtTriggerPrecip: 20,
                      droughtPeriodDays: 20,
                      ndviDropTrigger: 0.40,
                      premiumAmount: 15_000_000, // 15 USDC (scale to 6 decimals)
                      maxCoverage: 300_000_000, // 300 USDC
                      coverageStart: Math.floor(Date.now() / 1000),
                      coverageEnd: Math.floor(Date.now() / 1000) + 180 * 24 * 3600,
                      farmerTokenAccount
                    });
                    
                    alert("Успешно куплено!");
                    setShowBuyModal(false);
                    // Refresh policies
                    window.location.reload();
                  } catch (e: any) {
                    console.error(e);
                    alert("Ошибка: " + e.message);
                  }
                }}
              >
                ⚡ Купить полис
              </button>
            </div>
            <button className="modal-close" onClick={() => setShowBuyModal(false)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useState, useEffect } from 'react';
import { PROGRAM_ID } from '../lib/constants';
import { useTelegram } from '../lib/TelegramProvider';
import './ProfilePage.css';

const TECH_STACK = [
  { icon: '⛓️', name: 'Solana Blockchain', desc: '400мс блоки, микроцентовые комиссии' },
  { icon: '🛡️', name: 'Phala TEE', desc: 'Аппаратная изоляция ключей оракула' },
  { icon: '🤖', name: 'ElizaOS + SAK', desc: 'Автономный ИИ-агроном с RAG-памятью' },
  { icon: '🌡️', name: 'Open-Meteo API', desc: 'Метеоданные (1-11км разрешение)' },
  { icon: '🛰️', name: 'AgroMonitoring', desc: 'Спутниковый NDVI мониторинг' },
  { icon: '⏰', name: 'TukTuk / Gelato', desc: 'Децентрализованная автоматизация' },
  { icon: '🔔', name: 'Dialect Protocol', desc: 'Web3 push-уведомления' },
  { icon: '📱', name: 'Telegram Mini App', desc: 'Нулевое трение для фермеров' },
];

export default function ProfilePage() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { isTMA, user: tgUser, hapticFeedback } = useTelegram();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (connected && publicKey) {
      connection.getBalance(publicKey).then((bal) => {
        setBalance(bal / LAMPORTS_PER_SOL);
      }).catch(() => setBalance(null));
    } else {
      setBalance(null);
    }
  }, [connected, publicKey, connection]);

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  const handleCopyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      hapticFeedback('notification');
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">👤 Профиль</h1>

      {/* Telegram User Card */}
      {tgUser && (
        <div className="glass-card animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', marginBottom: '1rem' }}>
          {tgUser.photo_url ? (
            <img 
              src={tgUser.photo_url} 
              alt="Telegram avatar" 
              style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }} 
            />
          ) : (
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              👨‍🌾
            </div>
          )}
          <div>
            <h3 style={{ margin: '0 0 0.2rem', fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>
              {tgUser.first_name} {tgUser.last_name || ''}
            </h3>
            {tgUser.username && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                @{tgUser.username}
              </p>
            )}
            {isTMA && (
              <span className="badge badge-success" style={{ marginTop: '0.3rem', display: 'inline-block' }}>
                📱 Telegram Mini App
              </span>
            )}
          </div>
        </div>
      )}

      {/* Wallet Connection */}
      <div className="glass-card profile-wallet animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <div className="wallet-icon">{connected ? '✅' : '💳'}</div>
        <div className="wallet-info">
          {connected ? (
            <>
              <h3>Кошелёк подключён</h3>
              <p className="wallet-address" onClick={handleCopyAddress} style={{ cursor: 'pointer' }} title="Нажмите для копирования">
                {shortAddress} 📋
              </p>
              {balance !== null && (
                <p className="wallet-balance">{balance.toFixed(4)} SOL</p>
              )}
            </>
          ) : (
            <>
              <h3>Подключите кошелёк</h3>
              <p>Phantom или Solflare для работы с полисами</p>
            </>
          )}
        </div>
        <WalletMultiButton style={{
          backgroundColor: connected ? 'var(--color-success)' : 'var(--color-primary)',
          borderRadius: '12px',
          fontSize: '0.8rem',
          height: '40px',
          padding: '0 16px',
          fontFamily: 'inherit',
        }} />
      </div>

      {/* Contract Info */}
      {connected && (
        <div className="glass-card animate-fade-in" style={{ animationDelay: '0.1s', padding: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--color-text-primary)' }}>
            📋 Смарт-контракт
          </h3>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {PROGRAM_ID.toBase58()}
          </div>
        </div>
      )}

      {/* AI Agronomist */}
      <h2 className="section-title" style={{ marginTop: '1.5rem' }}>🤖 ИИ-Агроном</h2>
      <div className="glass-card ai-section animate-fade-in" style={{ animationDelay: '0.15s' }}>
        <div className="ai-avatar">🧑‍🌾</div>
        <div className="ai-info">
          <h3>Цифровой Агроном</h3>
          <p className="ai-desc">
            Автономный ИИ-агент на базе ElizaOS Character System.
            RAG-память для контекстных рекомендаций.
            TEE SHA-256 аттестация.
            Dialect push-уведомления.
          </p>
          <div className="ai-capabilities">
            <span className="ai-cap">Анализ метеоданных</span>
            <span className="ai-cap">Оценка NDVI</span>
            <span className="ai-cap">RAG-контекст</span>
            <span className="ai-cap">Автовыплаты</span>
            <span className="ai-cap">Push-алерты</span>
          </div>
        </div>
      </div>

      {/* Tech Stack */}
      <h2 className="section-title" style={{ marginTop: '1.5rem' }}>⚙️ Технологический стек v3</h2>
      <div className="tech-stack">
        {TECH_STACK.map((tech, i) => (
          <div
            key={i}
            className="glass-card tech-item animate-fade-in"
            style={{ animationDelay: `${0.2 + i * 0.05}s` }}
          >
            <span className="tech-icon">{tech.icon}</span>
            <div className="tech-info">
              <span className="tech-name">{tech.name}</span>
              <span className="tech-desc">{tech.desc}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Version Info */}
      <div className="version-info animate-fade-in" style={{ animationDelay: '0.6s' }}>
        <div className="badge badge-solana">SmartFarmer v3.0 • Solana Devnet</div>
        <p className="version-text">
          Параметрическое агрострахование на блокчейне Solana
          с верифицируемым ИИ-оракулом
        </p>
        {isTMA && (
          <p className="version-text" style={{ fontSize: '0.7rem', opacity: 0.6 }}>
            📱 Запущено как Telegram Mini App
          </p>
        )}
      </div>
    </div>
  );
}

# 🤖 SmartFarmer v3 — Руководство по автоматизации оракула

Три способа запуска автономного мониторинга полисов **без участия вашего компьютера**.

---

## Вариант 1: GitHub Actions CRON (Рекомендуемый для Devnet)

Автоматический запуск агента каждый час через GitHub Actions. **Бесплатно** для публичных репозиториев.

### Настройка

1. **Добавьте секреты** в `Settings → Secrets and variables → Actions → Secrets`:

   | Секрет | Описание |
   |--------|----------|
   | `SOLANA_PRIVATE_KEY` | Base58 приватный ключ оракула |
   | `HELIUS_RPC_URL` | RPC URL (Helius Devnet) |
   | `METGIS_API_KEY` | Ключ MetGIS (опционально) |
   | `AMBEE_API_KEY` | Ключ Ambee (опционально) |
   | `EOSDA_API_KEY` | Ключ EOSDA/AgroMonitoring (опционально) |

2. **Добавьте переменные** в `Settings → Secrets and variables → Actions → Variables`:

   | Переменная | Значение |
   |-----------|----------|
   | `CONTRACT_PROGRAM_ID` | `2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n` |
   | `DIALECT_ENABLED` | `false` |

3. **Запуште** репозиторий — CRON активируется автоматически.

4. **Ручной тест**: `Actions → SmartFarmer Oracle → Run workflow`

### Как это работает

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions Runner (Ubuntu)                          │
│                                                          │
│  ┌──── Каждый час (cron: '0 * * * *') ────┐            │
│  │                                          │            │
│  │  1. npm ci (установка зависимостей)      │            │
│  │  2. ORACLE_SINGLE_RUN=true               │            │
│  │  3. npx tsx src/index.ts                 │            │
│  │     ↓                                    │            │
│  │  Один цикл monitorPolicies() →           │            │
│  │     → Читает полисы из Solana Devnet     │            │
│  │     → Запрашивает погоду/NDVI            │            │
│  │     → Записывает отчёты в блокчейн       │            │
│  │     → process.exit(0)                    │            │
│  └──────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

---

## Вариант 2: Docker Compose (Self-Hosted)

Непрерывный мониторинг на вашем сервере или VPS.

### Настройка

1. **Создайте `.env`** в корне проекта:
   ```env
   SOLANA_PRIVATE_KEY=ваш_base58_ключ
   HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=ваш_ключ
   CONTRACT_PROGRAM_ID=2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n
   METGIS_API_KEY=ваш_ключ
   EOSDA_API_KEY=ваш_ключ
   ```

2. **Запуск**:
   ```bash
   docker compose up -d
   ```

3. **Мониторинг**:
   ```bash
   # Логи в реальном времени
   docker compose logs -f oracle
   
   # Статус
   docker compose ps
   
   # Перезапуск
   docker compose restart oracle
   
   # Остановка
   docker compose down
   ```

### Особенности
- Автоматический перезапуск при падении (`restart: unless-stopped`)
- Health check каждые 60 секунд
- Лимиты ресурсов: 1 CPU, 512MB RAM
- Логи с ротацией (макс. 3 × 10MB)

---

## Вариант 3: Phala TEE (Production)

Развёртывание в аппаратном анклаве Intel SGX через Phala Cloud.

### Настройка

1. **Установите dstack CLI**:
   ```bash
   npm i -g @aspect-build/dstack
   ```

2. **Запустите деплой**:
   ```bash
   bash deployment/scripts/deploy-tee.sh
   ```

3. **После деплоя**:
   ```bash
   # Верификация TEE аттестации
   phala attestation verify <deployment-id>
   
   # Получение TEE-публичного ключа
   dstack logs smartfarmer-oracle | grep "Oracle Identity"
   
   # Обновление контракта
   anchor idl update-authority --new-authority <TEE_PUBKEY>
   
   # Пополнение SOL для транзакций
   solana transfer <TEE_PUBKEY> 1 --url devnet
   ```

---

## Переменные окружения агента

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `SOLANA_PRIVATE_KEY` | Base58 ключ оракула | **Обязательно** |
| `HELIUS_RPC_URL` | Solana RPC | `https://api.devnet.solana.com` |
| `CONTRACT_PROGRAM_ID` | ID смарт-контракта | `2c4Qahh...` |
| `ORACLE_SINGLE_RUN` | Один цикл и выход | `false` |
| `MONITOR_INTERVAL_MS` | Интервал (мс) | `3600000` (1 час) |
| `TEE_MODE` | Режим TEE | `local_dev` |
| `DIALECT_ENABLED` | Уведомления | `false` |
| `METGIS_API_KEY` | MetGIS API | — |
| `EOSDA_API_KEY` | EOSDA/Agro API | — |
| `AMBEE_API_KEY` | Ambee API | — |

---

## Сравнение вариантов

| | GitHub Actions | Docker Compose | Phala TEE |
|---|---|---|---|
| **Стоимость** | Бесплатно | VPS ~$5/мес | Phala credits |
| **Мин. интервал** | 1 час | Любой | Любой |
| **TEE защита** | ❌ | ❌ | ✅ |
| **Uptime** | 99.9% | Зависит от VPS | 99.9% |
| **Настройка** | 5 мин | 10 мин | 30 мин |
| **Для кого** | Devnet/тесты | Staging | Production |

use anchor_lang::prelude::*;

// ============================================================================
// SmartFarmer v3 — State Accounts
// Архитектура параметрического агрострахования на Solana
// ============================================================================

/// Страховой пул — хранит средства для выплат компенсаций.
/// PDA seed: ["insurance_pool", admin.key()]
#[account]
#[derive(InitSpace)]
pub struct InsurancePool {
    /// Администратор пула (DAO или мультисиг)
    pub admin: Pubkey,

    /// Публичный ключ авторизованного ИИ-оракула (внутри Phala TEE)
    pub oracle_authority: Pubkey,

    /// SPL Token Mint для полисов (USDC или кастомный EVO токен)
    pub token_mint: Pubkey,

    /// Vault аккаунт (PDA), хранящий средства пула
    pub vault: Pubkey,

    /// Общий баланс пула (в наименьших единицах токена)
    pub total_balance: u64,

    /// Общий объём обязательств по активным полисам
    pub total_liability: u64,

    /// Счётчик полисов для генерации уникальных ID
    pub policy_count: u64,

    /// Флаг паузы (аварийная остановка)
    pub paused: bool,

    /// Bump seed для PDA
    pub bump: u8,

    /// Bump seed для vault PDA
    pub vault_bump: u8,
}

/// Страховой полис фермера.
/// PDA seed: ["policy", pool.key(), policy_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct Policy {
    /// ID полиса (автоинкремент из InsurancePool.policy_count)
    pub policy_id: u64,

    /// Ссылка на страховой пул
    pub pool: Pubkey,

    /// Кошелёк фермера (застрахованного)
    pub farmer: Pubkey,

    // ---- Параметры поля ----

    /// Широта центра поля (умноженная на 1e6 для хранения в integer)
    pub latitude: i64,

    /// Долгота центра поля (умноженная на 1e6 для хранения в integer)
    pub longitude: i64,

    /// Площадь поля в гектарах (умноженная на 100)
    pub area_hectares_x100: u32,

    /// Тип культуры
    pub crop_type: CropType,

    // ---- Параметры триггеров ----

    /// Критическая температура (°C * 100, для хранения в integer)
    /// Если температура опускается ниже — сработает триггер заморозков
    pub frost_trigger_temp_x100: i32,

    /// Критический уровень осадков (мм за период * 100)
    /// Если осадки ниже порога за drought_period_days — сработает триггер засухи
    pub drought_trigger_precip_x100: u32,

    /// Период мониторинга засухи в днях
    pub drought_period_days: u16,

    /// Критическое падение NDVI (delta * 10000, например 4000 = 0.40)
    /// Если NDVI падает более чем на это значение — подтверждение ущерба
    pub ndvi_drop_trigger_x10000: u16,

    // ---- Финансовые параметры ----

    /// Размер уплаченной премии (в наименьших единицах токена)
    pub premium_paid: u64,

    /// Максимальная сумма покрытия (в наименьших единицах токена)
    pub max_coverage: u64,

    // ---- Статус и временные рамки ----

    /// Текущий статус полиса
    pub status: PolicyStatus,

    /// Timestamp начала покрытия (Unix)
    pub coverage_start: i64,

    /// Timestamp окончания покрытия (Unix)
    pub coverage_end: i64,

    /// Timestamp создания полиса
    pub created_at: i64,

    /// Общая сумма выплаченных компенсаций
    pub total_paid_out: u64,

    /// Bump seed для PDA
    pub bump: u8,
}

/// Метеорологический отчёт от ИИ-оракула.
/// PDA seed: ["weather_report", policy.key(), report_index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct WeatherReport {
    /// Ссылка на полис
    pub policy: Pubkey,

    /// Индекс отчёта (для хронологии)
    pub report_index: u32,

    /// Температура (°C * 100)
    pub temperature_x100: i32,

    /// Осадки за период (мм * 100)
    pub precipitation_x100: u32,

    /// Влажность воздуха (% * 100)
    pub humidity_x100: u16,

    /// Скорость ветра (м/с * 100)
    pub wind_speed_x100: u16,

    /// Источник данных (MetGIS, Ambee и т.д.)
    pub data_source: DataSource,

    /// Сработал ли триггер заморозков
    pub frost_triggered: bool,

    /// Сработал ли триггер засухи
    pub drought_triggered: bool,

    /// Timestamp отчёта
    pub timestamp: i64,

    /// Хеш аттестации TEE (32 байта) — доказательство выполнения в Phala
    #[max_len(32)]
    pub tee_attestation_hash: Vec<u8>,

    /// Bump seed
    pub bump: u8,
}

/// Спутниковый отчёт NDVI от ИИ-оракула.
/// PDA seed: ["ndvi_report", policy.key(), report_index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct NdviReport {
    /// Ссылка на полис
    pub policy: Pubkey,

    /// Индекс отчёта
    pub report_index: u32,

    /// Средний NDVI (значение * 10000, например 7500 = 0.75)
    pub mean_ndvi_x10000: u16,

    /// Минимальный NDVI на поле (* 10000)
    pub min_ndvi_x10000: u16,

    /// Максимальный NDVI на поле (* 10000)
    pub max_ndvi_x10000: u16,

    /// Стандартное отклонение NDVI (* 10000)
    pub std_dev_x10000: u16,

    /// Историческая норма NDVI для данного периода (* 10000)
    pub historical_mean_x10000: u16,

    /// Процент изменения NDVI от нормы (* 100, знаковый)
    pub delta_from_norm_x100: i16,

    /// Сработал ли NDVI триггер (подтверждение биологического ущерба)
    pub ndvi_triggered: bool,

    /// Источник спутниковых данных (EOSDA, Leaf, Farmonaut)
    pub satellite_source: SatelliteSource,

    /// Timestamp снимка
    pub timestamp: i64,

    /// Хеш аттестации TEE
    #[max_len(32)]
    pub tee_attestation_hash: Vec<u8>,

    /// Bump seed
    pub bump: u8,
}

/// Запись агрономической рекомендации ИИ-агента.
/// PDA seed: ["recommendation", policy.key(), rec_index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct Recommendation {
    /// Ссылка на полис
    pub policy: Pubkey,

    /// Индекс рекомендации
    pub rec_index: u32,

    /// Тип рекомендации
    pub rec_type: RecommendationType,

    /// Уровень срочности
    pub urgency: Urgency,

    /// Текст рекомендации (до 512 символов, хранится ончейн для прозрачности)
    #[max_len(512)]
    pub message: String,

    /// Timestamp
    pub timestamp: i64,

    /// Bump seed
    pub bump: u8,
}

// ============================================================================
// Enums
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PolicyStatus {
    /// Полис создан, ожидает активации
    Pending,
    /// Полис активен, идёт мониторинг
    Active,
    /// Триггер сработал, ожидает подтверждения NDVI
    TriggeredAwaitingNdvi,
    /// Выплата произведена
    PaidOut,
    /// Полис истёк без страхового случая
    Expired,
    /// Полис отменён
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum CropType {
    /// Озимая пшеница
    WinterWheat,
    /// Яровая пшеница
    SpringWheat,
    /// Ячмень
    Barley,
    /// Рис
    Rice,
    /// Хлопок
    Cotton,
    /// Подсолнечник
    Sunflower,
    /// Другая культура
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DataSource {
    /// Open-Meteo — бесплатный и качественный гиперлокальный провайдер
    OpenMeteo,
    /// Ambee — 500м разрешение, глобальное покрытие
    Ambee,
    /// DTN ClearAg — агрометеорологическая аналитика
    DtnClearAg,
    /// Xweather (Vaisala) — корпоративный уровень
    Xweather,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum SatelliteSource {
    /// AgroMonitoring — актуальный провайдер NDVI статистики
    AgroMonitoring,
    /// Leaf API — мультипровайдерный агрегатор
    Leaf,
    /// Farmonaut — спутниковый мониторинг
    Farmonaut,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RecommendationType {
    /// Рекомендация по ирригации
    Irrigation,
    /// Предупреждение о заморозках
    FrostWarning,
    /// Предупреждение о засухе
    DroughtWarning,
    /// Рекомендация по удобрениям
    Fertilization,
    /// Рекомендация по уборке урожая
    Harvest,
    /// Общая рекомендация
    General,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Urgency {
    /// Информационное
    Info,
    /// Средняя срочность
    Medium,
    /// Высокая срочность
    High,
    /// Критическая ситуация
    Critical,
}

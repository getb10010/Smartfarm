use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n");

/// SmartFarmer v3 — Децентрализованная платформа параметрического агрострахования
/// 
/// Архитектура:
/// - Страховой пул (InsurancePool) с SPL Token vault
/// - Параметрические полисы с триггерами заморозков, засухи и NDVI
/// - ИИ-оракул (ElizaOS в Phala TEE) подаёт метео и спутниковые данные
/// - Автоматические выплаты при подтверждении ущерба
/// - Агрономические рекомендации ончейн
#[program]
pub mod smartfarmer {
    use super::*;

    /// Инициализация страхового пула.
    /// Вызывается администратором (DAO/мультисиг) один раз.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        instructions::initialize_pool::handle_initialize_pool(ctx, oracle_authority)
    }

    /// Покупка страхового полиса фермером.
    /// Фермер указывает поле, культуру, триггеры и оплачивает премию.
    pub fn purchase_policy(
        ctx: Context<PurchasePolicy>,
        latitude: i64,
        longitude: i64,
        area_hectares_x100: u32,
        crop_type: state::CropType,
        frost_trigger_temp_x100: i32,
        drought_trigger_precip_x100: u32,
        drought_period_days: u16,
        ndvi_drop_trigger_x10000: u16,
        premium_amount: u64,
        max_coverage: u64,
        coverage_start: i64,
        coverage_end: i64,
    ) -> Result<()> {
        instructions::purchase_policy::handle_purchase_policy(
            ctx,
            latitude,
            longitude,
            area_hectares_x100,
            crop_type,
            frost_trigger_temp_x100,
            drought_trigger_precip_x100,
            drought_period_days,
            ndvi_drop_trigger_x10000,
            premium_amount,
            max_coverage,
            coverage_start,
            coverage_end,
        )
    }

    /// Отправка метеорологического отчёта ИИ-оракулом (из Phala TEE).
    /// Данные из MetGIS/Ambee с гиперлокальным разрешением.
    pub fn submit_weather_report(
        ctx: Context<SubmitWeatherReport>,
        temperature_x100: i32,
        precipitation_x100: u32,
        humidity_x100: u16,
        wind_speed_x100: u16,
        data_source: state::DataSource,
        timestamp: i64,
        tee_attestation_hash: Vec<u8>,
    ) -> Result<()> {
        instructions::submit_weather_report::handle_submit_weather_report(
            ctx,
            temperature_x100,
            precipitation_x100,
            humidity_x100,
            wind_speed_x100,
            data_source,
            timestamp,
            tee_attestation_hash,
        )
    }

    /// Отправка спутникового NDVI-отчёта (данные EOSDA/Leaf API).
    /// Подтверждает или опровергает биологический ущерб посевам.
    pub fn submit_ndvi_report(
        ctx: Context<SubmitNdviReport>,
        mean_ndvi_x10000: u16,
        min_ndvi_x10000: u16,
        max_ndvi_x10000: u16,
        std_dev_x10000: u16,
        historical_mean_x10000: u16,
        satellite_source: state::SatelliteSource,
        timestamp: i64,
        tee_attestation_hash: Vec<u8>,
    ) -> Result<()> {
        instructions::submit_ndvi_report::handle_submit_ndvi_report(
            ctx,
            mean_ndvi_x10000,
            min_ndvi_x10000,
            max_ndvi_x10000,
            std_dev_x10000,
            historical_mean_x10000,
            satellite_source,
            timestamp,
            tee_attestation_hash,
        )
    }

    /// Автоматическая выплата компенсации фермеру.
    /// Вызывается после подтверждения ущерба метео + NDVI данными.
    pub fn trigger_payout(
        ctx: Context<TriggerPayout>,
        payout_amount: u64,
        timestamp: i64,
        tee_attestation_hash: Vec<u8>,
    ) -> Result<()> {
        instructions::trigger_payout::handle_trigger_payout(ctx, payout_amount, timestamp, tee_attestation_hash)
    }

    /// Агрономическая рекомендация от ИИ-агента.
    /// Превентивные советы (ирригация, защита от заморозков и т.д.).
    pub fn ai_recommendation(
        ctx: Context<AiRecommendation>,
        rec_type: state::RecommendationType,
        urgency: state::Urgency,
        message: String,
        timestamp: i64,
        tee_attestation_hash: Vec<u8>,
    ) -> Result<()> {
        instructions::ai_recommendation::handle_ai_recommendation(
            ctx,
            rec_type,
            urgency,
            message,
            timestamp,
            tee_attestation_hash,
        )
    }
}

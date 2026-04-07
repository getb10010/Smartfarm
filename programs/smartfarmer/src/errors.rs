use anchor_lang::prelude::*;

// ============================================================================
// SmartFarmer v3 — Custom Errors
// ============================================================================

#[error_code]
pub enum SmartFarmerError {
    // ---- Authorization errors ----

    #[msg("Unauthorized: only the pool admin can perform this action")]
    UnauthorizedAdmin,

    #[msg("Unauthorized: only the authorized oracle (TEE) can submit data")]
    UnauthorizedOracle,

    #[msg("Unauthorized: only the policy holder can perform this action")]
    UnauthorizedFarmer,

    // ---- Pool errors ----

    #[msg("Insurance pool is currently paused")]
    PoolPaused,

    #[msg("Insufficient funds in the insurance pool for this coverage")]
    InsufficientPoolFunds,

    #[msg("Pool total liability would exceed total balance")]
    LiabilityExceedsBalance,

    // ---- Policy errors ----

    #[msg("Policy is not in Active status")]
    PolicyNotActive,

    #[msg("Policy is not in TriggeredAwaitingNdvi status")]
    PolicyNotTriggered,

    #[msg("Policy has expired")]
    PolicyExpired,

    #[msg("Policy coverage period has not started yet")]
    PolicyNotStarted,

    #[msg("Policy has already been paid out")]
    PolicyAlreadyPaidOut,

    #[msg("Maximum coverage amount has been reached")]
    MaxCoverageReached,

    // ---- Parameter validation errors ----

    #[msg("Invalid coordinates: latitude must be between -90_000000 and 90_000000")]
    InvalidLatitude,

    #[msg("Invalid coordinates: longitude must be between -180_000000 and 180_000000")]
    InvalidLongitude,

    #[msg("Invalid field area: must be greater than 0")]
    InvalidArea,

    #[msg("Premium amount must be greater than 0")]
    InvalidPremium,

    #[msg("Coverage amount must be greater than premium")]
    InvalidCoverage,

    #[msg("Coverage end must be after coverage start")]
    InvalidCoveragePeriod,

    #[msg("Drought period days must be between 1 and 365")]
    InvalidDroughtPeriod,

    // ---- TEE attestation errors ----

    #[msg("Invalid TEE attestation: hash verification failed")]
    InvalidTeeAttestation,

    #[msg("TEE attestation hash must be exactly 32 bytes")]
    InvalidAttestationLength,

    #[msg("TEE attestation hash mismatch: data was tampered")]
    TeeHashMismatch,

    #[msg("TEE attestation is too old (replay protection)")]
    TeeAttestationTooOld,

    // ---- Trigger errors ----

    #[msg("Weather conditions do not meet trigger thresholds")]
    TriggerNotMet,

    #[msg("NDVI data does not confirm crop damage")]
    NdviNotConfirmed,

    // ---- Payout errors ----

    #[msg("Calculated payout amount is zero")]
    ZeroPayout,

    #[msg("Payout would exceed remaining coverage")]
    PayoutExceedsCoverage,

    // ---- Arithmetic errors ----

    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[msg("Arithmetic underflow occurred")]
    ArithmeticUnderflow,
}

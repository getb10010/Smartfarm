import { PublicKey } from '@solana/web3.js';

// ============================================================================
// SmartFarmer v3 — Constants
// ============================================================================

// Solana Program ID (обновить после деплоя)
export const PROGRAM_ID = new PublicKey('2c4QahhgmCXWFDuPVsa6i7gBYSUn2DGTNPpXZXwjs21n');

// RPC Endpoints (Helius для production)
export const RPC_ENDPOINTS = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

export const CURRENT_NETWORK = 'devnet' as const;
export const RPC_ENDPOINT = import.meta.env?.VITE_HELIUS_RPC_URL || RPC_ENDPOINTS[CURRENT_NETWORK];

// Метеорологические API (согласно документу: MetGIS 30м, Ambee 500м)
export const WEATHER_API = {
  METGIS_BASE_URL: 'https://api.metgis.com/forecast',
  AMBEE_BASE_URL: 'https://api.ambeedata.com',
};

// Спутниковые данные (EOSDA / Leaf API)
export const SATELLITE_API = {
  EOSDA_BASE_URL: 'https://api-connect.eos.com/api/gdw/api',
  LEAF_BASE_URL: 'https://api.withleaf.io',
};

// Типы культур (соответствуют CropType в смарт-контракте)
export const CROP_TYPES = [
  { id: 0, name: 'Озимая пшеница', nameEn: 'WinterWheat', icon: '🌾', ndviNorm: 0.72 },
  { id: 1, name: 'Яровая пшеница', nameEn: 'SpringWheat', icon: '🌿', ndviNorm: 0.68 },
  { id: 2, name: 'Ячмень', nameEn: 'Barley', icon: '🌱', ndviNorm: 0.65 },
  { id: 3, name: 'Рис', nameEn: 'Rice', icon: '🍚', ndviNorm: 0.78 },
  { id: 4, name: 'Хлопок', nameEn: 'Cotton', icon: '☁️', ndviNorm: 0.62 },
  { id: 5, name: 'Подсолнечник', nameEn: 'Sunflower', icon: '🌻', ndviNorm: 0.70 },
  { id: 6, name: 'Другая', nameEn: 'Other', icon: '🌍', ndviNorm: 0.60 },
] as const;

// Регионы Казахстана (согласно документу)
export const REGIONS = [
  { name: 'Туркестанская область', lat: 43.3, lon: 68.25 },
  { name: 'Костанайская область', lat: 53.2, lon: 63.6 },
  { name: 'Акмолинская область', lat: 51.9, lon: 69.4 },
  { name: 'Алматинская область', lat: 43.35, lon: 77.0 },
  { name: 'Жамбылская область', lat: 43.35, lon: 71.4 },
];

// Параметры по умолчанию для полисов
export const DEFAULT_POLICY_PARAMS = {
  frostTriggerTemp: -5, // °C — порог заморозков
  droughtTriggerPrecip: 10, // мм — минимум осадков
  droughtPeriodDays: 14, // дней наблюдения за засухой
  ndviDropTrigger: 0.40, // 40% падение NDVI
};

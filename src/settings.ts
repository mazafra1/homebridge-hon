export const PLATFORM_NAME = 'HonPlatform';
export const PLUGIN_NAME = 'homebridge-hon';

// hOn API base URLs (reverse-engineered from the official app)
export const HON_API_URL = 'https://api.hon.haier.com';
export const HON_AUTH_URL = 'https://account.hon.haier.com';

// Device type codes as used by the hOn API
export const DEVICE_TYPES = {
  AC: 'AC',       // Air Conditioner
  WM: 'WM',       // Washing Machine
  DW: 'DW',       // Dishwasher
  TD: 'TD',       // Tumble Dryer
  WD: 'WD',       // Washer-Dryer
  AP: 'AP',       // Air Purifier
  WC: 'WC',       // Wine Cooler
  OV: 'OV',       // Oven
} as const;

// AC operation modes (maps to hOn operationMode parameter)
export const AC_OP_MODE = {
  AUTO: '0',
  COOL: '1',
  DRY: '2',
  FAN: '3',
  HEAT: '4',
} as const;

// AC fan speed levels
export const AC_FAN_SPEED = {
  AUTO: '5',
  LOW: '1',
  MEDIUM: '2',
  HIGH: '3',
} as const;

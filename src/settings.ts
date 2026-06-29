export const PLATFORM_NAME = 'HonPlatform';
export const PLUGIN_NAME = 'homebridge-hon';

// hOn API base URLs
export const HON_API_URL = 'https://api-iot.he.services';
export const HON_AUTH_URL = 'https://account2.hon-smarthome.com';

// Device type codes as used by the hOn API
export const DEVICE_TYPES = {
  AC: 'AC',
  WM: 'WM',
  DW: 'DW',
  TD: 'TD',
  WD: 'WD',
  AP: 'AP',
  WC: 'WC',
  OV: 'OV',
} as const;

// AC operation modes
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

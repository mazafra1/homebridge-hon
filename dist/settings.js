"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AC_FAN_SPEED = exports.AC_OP_MODE = exports.DEVICE_TYPES = exports.HON_AUTH_URL = exports.HON_API_URL = exports.PLUGIN_NAME = exports.PLATFORM_NAME = void 0;
exports.PLATFORM_NAME = 'HonPlatform';
exports.PLUGIN_NAME = 'homebridge-hon';
// hOn API base URLs
exports.HON_API_URL = 'https://api-iot.he.services';
exports.HON_AUTH_URL = 'https://account2.hon-smarthome.com';
// Device type codes as used by the hOn API
exports.DEVICE_TYPES = {
    AC: 'AC',
    WM: 'WM',
    DW: 'DW',
    TD: 'TD',
    WD: 'WD',
    AP: 'AP',
    WC: 'WC',
    OV: 'OV',
};
// AC operation modes
exports.AC_OP_MODE = {
    AUTO: '0',
    COOL: '1',
    DRY: '2',
    FAN: '3',
    HEAT: '4',
};
// AC fan speed levels
exports.AC_FAN_SPEED = {
    AUTO: '5',
    LOW: '1',
    MEDIUM: '2',
    HIGH: '3',
};

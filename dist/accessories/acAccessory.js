"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcAccessory = void 0;
const settings_1 = require("../settings");
// Target temperatures (HomeKit range: 10–38°C)
const TEMP_MIN = 16;
const TEMP_MAX = 30;
// HeaterCoolerState values
const STATE_OFF = 0;
const STATE_IDLE = 1;
const STATE_HEATING = 2;
const STATE_COOLING = 3;
// TargetHeaterCoolerState values
const TARGET_AUTO = 0;
const TARGET_HEAT = 1;
const TARGET_COOL = 2;
class AcAccessory {
    constructor(accessory, api, email, password, hbApi, log) {
        this.accessory = accessory;
        this.api = api;
        this.email = email;
        this.password = password;
        this.hbApi = hbApi;
        // Cached state (avoids hammering API on every characteristic read)
        this.cache = {
            onOffStatus: '0',
            operationMode: settings_1.AC_OP_MODE.COOL,
            tempSel: '24',
            tempIndoor: '24',
            windSpeed: settings_1.AC_FAN_SPEED.AUTO,
            windDirectionHorizontal: '0',
            windDirectionVertical: '0',
            silentSleepStatus: '0',
            rapidModeStatus: '0',
            ecoModeStatus: '0',
            selfCleanStatus: '0',
        };
        this.cacheTime = 0;
        this.CACHE_TTL = 25000; // ms
        this.log = log;
        this.Characteristic = hbApi.hap.Characteristic;
        // Set accessory info
        this.accessory
            .getService(hbApi.hap.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, 'Haier / hOn')
            .setCharacteristic(this.Characteristic.Model, accessory.context.device?.modelName ?? 'AC')
            .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device?.macAddress ?? 'unknown');
        // HeaterCooler service
        this.service =
            this.accessory.getService(hbApi.hap.Service.HeaterCooler) ??
                this.accessory.addService(hbApi.hap.Service.HeaterCooler);
        this.service.setCharacteristic(this.Characteristic.Name, accessory.context.device?.nickName ?? 'Air Conditioner');
        // ── Active (on/off) ─────────────────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        // ── Current Heater-Cooler State ──────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
            .onGet(this.handleCurrentStateGet.bind(this));
        // ── Target Heater-Cooler State (mode) ───────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [TARGET_AUTO, TARGET_HEAT, TARGET_COOL] })
            .onGet(this.handleTargetStateGet.bind(this))
            .onSet(this.handleTargetStateSet.bind(this));
        // ── Current Temperature ──────────────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTempGet.bind(this));
        // ── Cooling Threshold Temperature ────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: TEMP_MIN, maxValue: TEMP_MAX, minStep: 1 })
            .onGet(this.handleTargetTempGet.bind(this))
            .onSet(this.handleTargetTempSet.bind(this));
        // ── Heating Threshold Temperature ────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
            .setProps({ minValue: TEMP_MIN, maxValue: TEMP_MAX, minStep: 1 })
            .onGet(this.handleTargetTempGet.bind(this))
            .onSet(this.handleTargetTempSet.bind(this));
        // ── Rotation Speed → Fan speed ───────────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
            .onGet(this.handleFanSpeedGet.bind(this))
            .onSet(this.handleFanSpeedSet.bind(this));
        // ── Swing Mode → horizontal swing ───────────────────────────────────────
        this.service
            .getCharacteristic(this.Characteristic.SwingMode)
            .onGet(this.handleSwingGet.bind(this))
            .onSet(this.handleSwingSet.bind(this));
    }
    // ─── Cache helpers ─────────────────────────────────────────────────────────
    async getStatus() {
        if (Date.now() - this.cacheTime < this.CACHE_TTL)
            return this.cache;
        try {
            this.cache = await this.api.getAcStatus(this.accessory.context.device.applianceId, this.email, this.password);
            this.cacheTime = Date.now();
        }
        catch (err) {
            this.log.warn('Could not refresh AC status, using cached values');
        }
        return this.cache;
    }
    async send(params) {
        // Optimistically update cache
        this.cache = { ...this.cache, ...params };
        this.cacheTime = Date.now();
        await this.api.sendAcCommand(this.accessory.context.device.applianceId, params, this.email, this.password);
    }
    // ─── Characteristic handlers ───────────────────────────────────────────────
    async handleActiveGet() {
        const s = await this.getStatus();
        return s.onOffStatus === '1'
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE;
    }
    async handleActiveSet(value) {
        const on = value === this.Characteristic.Active.ACTIVE ? '1' : '0';
        await this.send({ onOffStatus: on });
        this.log.info(`AC turned ${on === '1' ? 'ON' : 'OFF'}`);
    }
    async handleCurrentStateGet() {
        const s = await this.getStatus();
        if (s.onOffStatus !== '1')
            return STATE_IDLE;
        if (s.operationMode === settings_1.AC_OP_MODE.HEAT)
            return STATE_HEATING;
        if (s.operationMode === settings_1.AC_OP_MODE.COOL || s.operationMode === settings_1.AC_OP_MODE.DRY) {
            return STATE_COOLING;
        }
        // AUTO: compare current vs target temp
        const current = parseFloat(s.tempIndoor ?? '24');
        const target = parseFloat(s.tempSel ?? '24');
        return current > target ? STATE_COOLING : STATE_HEATING;
    }
    async handleTargetStateGet() {
        const s = await this.getStatus();
        if (s.operationMode === settings_1.AC_OP_MODE.HEAT)
            return TARGET_HEAT;
        if (s.operationMode === settings_1.AC_OP_MODE.COOL || s.operationMode === settings_1.AC_OP_MODE.DRY) {
            return TARGET_COOL;
        }
        return TARGET_AUTO;
    }
    async handleTargetStateSet(value) {
        let mode;
        if (value === TARGET_HEAT)
            mode = settings_1.AC_OP_MODE.HEAT;
        else if (value === TARGET_COOL)
            mode = settings_1.AC_OP_MODE.COOL;
        else
            mode = settings_1.AC_OP_MODE.AUTO;
        await this.send({ operationMode: mode });
        this.log.info(`AC mode set to ${mode}`);
    }
    async handleCurrentTempGet() {
        const s = await this.getStatus();
        return parseFloat(s.tempIndoor ?? '24');
    }
    async handleTargetTempGet() {
        const s = await this.getStatus();
        return Math.min(TEMP_MAX, Math.max(TEMP_MIN, parseFloat(s.tempSel ?? '24')));
    }
    async handleTargetTempSet(value) {
        const temp = String(Math.round(value));
        await this.send({ tempSel: temp });
        this.log.info(`AC target temperature set to ${temp}°C`);
    }
    // Fan speed: map 0-100 range to hOn wind speed values (0=off,25=low,50=med,75=high,100=auto)
    async handleFanSpeedGet() {
        const s = await this.getStatus();
        if (s.onOffStatus !== '1')
            return 0;
        switch (s.windSpeed) {
            case settings_1.AC_FAN_SPEED.LOW: return 25;
            case settings_1.AC_FAN_SPEED.MEDIUM: return 50;
            case settings_1.AC_FAN_SPEED.HIGH: return 75;
            default: return 100; // AUTO
        }
    }
    async handleFanSpeedSet(value) {
        const v = value;
        let speed;
        if (v <= 0)
            speed = settings_1.AC_FAN_SPEED.AUTO;
        else if (v <= 25)
            speed = settings_1.AC_FAN_SPEED.LOW;
        else if (v <= 50)
            speed = settings_1.AC_FAN_SPEED.MEDIUM;
        else if (v <= 75)
            speed = settings_1.AC_FAN_SPEED.HIGH;
        else
            speed = settings_1.AC_FAN_SPEED.AUTO;
        await this.send({ windSpeed: speed });
        this.log.info(`AC fan speed set to ${speed}`);
    }
    async handleSwingGet() {
        const s = await this.getStatus();
        return s.windDirectionHorizontal === '7'
            ? this.Characteristic.SwingMode.SWING_ENABLED
            : this.Characteristic.SwingMode.SWING_DISABLED;
    }
    async handleSwingSet(value) {
        const swingOn = value === this.Characteristic.SwingMode.SWING_ENABLED;
        await this.send({
            windDirectionHorizontal: swingOn ? '7' : '0',
            windDirectionVertical: swingOn ? '8' : '0',
        });
        this.log.info(`AC swing ${swingOn ? 'enabled' : 'disabled'}`);
    }
    // Called by platform polling loop to push updates to HomeKit
    async refreshCharacteristics() {
        // Invalidate cache to force fresh fetch
        this.cacheTime = 0;
        const s = await this.getStatus();
        const active = s.onOffStatus === '1'
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE;
        this.service.updateCharacteristic(this.Characteristic.Active, active);
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, parseFloat(s.tempIndoor ?? '24'));
        this.service.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, parseFloat(s.tempSel ?? '24'));
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, parseFloat(s.tempSel ?? '24'));
        this.log.debug(`AC refreshed: power=${s.onOffStatus} mode=${s.operationMode} ` +
            `current=${s.tempIndoor}°C target=${s.tempSel}°C`);
    }
}
exports.AcAccessory = AcAccessory;

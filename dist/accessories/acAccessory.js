"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcAccessory = void 0;
const settings_1 = require("../settings");
const TEMP_MIN = 16;
const TEMP_MAX = 30;
const STATE_INACTIVE = 0;
const STATE_IDLE = 1;
const STATE_HEATING = 2;
const STATE_COOLING = 3;
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
        this.CACHE_TTL = 25000;
        this.log = log;
        this.Characteristic = hbApi.hap.Characteristic;
        const info = this.accessory.getService(hbApi.hap.Service.AccessoryInformation)
            ?? this.accessory.addService(hbApi.hap.Service.AccessoryInformation);
        info
            .setCharacteristic(this.Characteristic.Manufacturer, 'Haier / hOn')
            .setCharacteristic(this.Characteristic.Model, accessory.context.device?.modelName ?? 'AC')
            .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device?.macAddress ?? accessory.context.device?.applianceId ?? 'unknown');
        this.service =
            this.accessory.getService(hbApi.hap.Service.HeaterCooler) ??
                this.accessory.addService(hbApi.hap.Service.HeaterCooler);
        this.service.setCharacteristic(this.Characteristic.Name, accessory.context.device?.nickName ?? 'Air Conditioner');
        this.service
            .getCharacteristic(this.Characteristic.Active)
            .onGet(this.handleActiveGet.bind(this))
            .onSet(this.handleActiveSet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
            .onGet(this.handleCurrentStateGet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [TARGET_AUTO, TARGET_HEAT, TARGET_COOL] })
            .onGet(this.handleTargetStateGet.bind(this))
            .onSet(this.handleTargetStateSet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTempGet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: TEMP_MIN, maxValue: TEMP_MAX, minStep: 1 })
            .onGet(this.handleTargetTempGet.bind(this))
            .onSet(this.handleTargetTempSet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
            .setProps({ minValue: TEMP_MIN, maxValue: TEMP_MAX, minStep: 1 })
            .onGet(this.handleTargetTempGet.bind(this))
            .onSet(this.handleTargetTempSet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
            .onGet(this.handleFanSpeedGet.bind(this))
            .onSet(this.handleFanSpeedSet.bind(this));
        this.service
            .getCharacteristic(this.Characteristic.SwingMode)
            .onGet(this.handleSwingGet.bind(this))
            .onSet(this.handleSwingSet.bind(this));
    }
    parseNumber(value, fallback) {
        const parsed = Number.parseFloat(value ?? '');
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    clampTemp(value) {
        return Math.min(TEMP_MAX, Math.max(TEMP_MIN, value));
    }
    async getStatus() {
        if (Date.now() - this.cacheTime < this.CACHE_TTL) {
            return this.cache;
        }
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
        const previous = { ...this.cache };
        this.cache = { ...this.cache, ...params };
        this.cacheTime = Date.now();
        try {
            await this.api.sendAcCommand(this.accessory.context.device.applianceId, params, this.email, this.password);
        }
        catch (err) {
            this.cache = previous;
            throw err;
        }
    }
    toCurrentState(s) {
        if (s.onOffStatus !== '1') {
            return STATE_INACTIVE;
        }
        if (s.operationMode === settings_1.AC_OP_MODE.HEAT) {
            return STATE_HEATING;
        }
        if (s.operationMode === settings_1.AC_OP_MODE.COOL || s.operationMode === settings_1.AC_OP_MODE.DRY) {
            return STATE_COOLING;
        }
        if (s.operationMode === settings_1.AC_OP_MODE.FAN) {
            return STATE_IDLE;
        }
        const current = this.parseNumber(s.tempIndoor, 24);
        const target = this.parseNumber(s.tempSel, 24);
        if (Math.abs(current - target) < 0.5) {
            return STATE_IDLE;
        }
        return current > target ? STATE_COOLING : STATE_HEATING;
    }
    toTargetState(s) {
        if (s.operationMode === settings_1.AC_OP_MODE.HEAT) {
            return TARGET_HEAT;
        }
        if (s.operationMode === settings_1.AC_OP_MODE.COOL || s.operationMode === settings_1.AC_OP_MODE.DRY) {
            return TARGET_COOL;
        }
        return TARGET_AUTO;
    }
    toRotationSpeed(s) {
        if (s.onOffStatus !== '1') {
            return 0;
        }
        switch (s.windSpeed) {
            case settings_1.AC_FAN_SPEED.LOW:
                return 25;
            case settings_1.AC_FAN_SPEED.MEDIUM:
                return 50;
            case settings_1.AC_FAN_SPEED.HIGH:
                return 75;
            default:
                return 100;
        }
    }
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
        return this.toCurrentState(s);
    }
    async handleTargetStateGet() {
        const s = await this.getStatus();
        return this.toTargetState(s);
    }
    async handleTargetStateSet(value) {
        let mode;
        if (value === TARGET_HEAT) {
            mode = settings_1.AC_OP_MODE.HEAT;
        }
        else if (value === TARGET_COOL) {
            mode = settings_1.AC_OP_MODE.COOL;
        }
        else {
            mode = settings_1.AC_OP_MODE.AUTO;
        }
        await this.send({
            operationMode: mode,
            onOffStatus: '1',
        });
        this.log.info(`AC mode set to ${mode}`);
    }
    async handleCurrentTempGet() {
        const s = await this.getStatus();
        return this.parseNumber(s.tempIndoor, 24);
    }
    async handleTargetTempGet() {
        const s = await this.getStatus();
        return this.clampTemp(this.parseNumber(s.tempSel, 24));
    }
    async handleTargetTempSet(value) {
        const temp = String(this.clampTemp(Math.round(value)));
        await this.send({ tempSel: temp, onOffStatus: '1' });
        this.log.info(`AC target temperature set to ${temp}°C`);
    }
    async handleFanSpeedGet() {
        const s = await this.getStatus();
        return this.toRotationSpeed(s);
    }
    async handleFanSpeedSet(value) {
        const v = Number(value);
        let speed;
        if (v <= 0) {
            speed = settings_1.AC_FAN_SPEED.AUTO;
        }
        else if (v <= 25) {
            speed = settings_1.AC_FAN_SPEED.LOW;
        }
        else if (v <= 50) {
            speed = settings_1.AC_FAN_SPEED.MEDIUM;
        }
        else if (v <= 75) {
            speed = settings_1.AC_FAN_SPEED.HIGH;
        }
        else {
            speed = settings_1.AC_FAN_SPEED.AUTO;
        }
        await this.send({
            windSpeed: speed,
            onOffStatus: '1',
        });
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
            onOffStatus: '1',
        });
        this.log.info(`AC swing ${swingOn ? 'enabled' : 'disabled'}`);
    }
    async refreshCharacteristics() {
        this.cacheTime = 0;
        const s = await this.getStatus();
        const active = s.onOffStatus === '1'
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE;
        this.service.updateCharacteristic(this.Characteristic.Active, active);
        this.service.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, this.toCurrentState(s));
        this.service.updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, this.toTargetState(s));
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.parseNumber(s.tempIndoor, 24));
        this.service.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, this.clampTemp(this.parseNumber(s.tempSel, 24)));
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, this.clampTemp(this.parseNumber(s.tempSel, 24)));
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, this.toRotationSpeed(s));
        this.service.updateCharacteristic(this.Characteristic.SwingMode, s.windDirectionHorizontal === '7'
            ? this.Characteristic.SwingMode.SWING_ENABLED
            : this.Characteristic.SwingMode.SWING_DISABLED);
        this.log.debug(`AC refreshed: power=${s.onOffStatus} mode=${s.operationMode} ` +
            `current=${s.tempIndoor}°C target=${s.tempSel}°C`);
    }
}
exports.AcAccessory = AcAccessory;

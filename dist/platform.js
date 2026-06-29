"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HonPlatform = void 0;
const settings_1 = require("./settings");
const honApi_1 = require("./honApi");
const acAccessory_1 = require("./accessories/acAccessory");
class HonPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.cachedAccessories = [];
        this.acAccessories = new Map();
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.honApi = new honApi_1.HonApiClient(log);
        this.log.debug('hOn platform initializing');
        this.api.on('didFinishLaunching', () => {
            void this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            if (this.pollingTimer) {
                clearInterval(this.pollingTimer);
                this.pollingTimer = undefined;
            }
        });
    }
    configureAccessory(accessory) {
        this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
        this.cachedAccessories.push(accessory);
    }
    async discoverDevices() {
        const { email, password, pollingInterval = 30 } = this.config;
        if (!email || !password) {
            this.log.error('Missing email or password in config – please check config.json');
            return;
        }
        try {
            await this.honApi.login(String(email), String(password));
            const appliances = await this.honApi.getAppliances(String(email), String(password));
            this.log.info(`Found ${appliances.length} appliance(s) in your hOn account`);
            for (const appliance of appliances) {
                this.log.info(` • ${appliance.nickName} (${appliance.applianceTypeName} / ${appliance.modelName})`);
                if (appliance.applianceTypeName === settings_1.DEVICE_TYPES.AC) {
                    this.setupAcAccessory(appliance, String(email), String(password));
                }
                else {
                    this.log.info(` ↳ Skipping unsupported type: ${appliance.applianceTypeName}`);
                }
            }
            const activeIds = new Set(appliances.map((a) => a.applianceId));
            const stale = this.cachedAccessories.filter((a) => !activeIds.has(a.context.device?.applianceId));
            if (stale.length > 0) {
                this.log.info(`Removing ${stale.length} stale accessory(ies)`);
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
                for (const accessory of stale) {
                    const applianceId = accessory.context.device?.applianceId;
                    if (applianceId) {
                        this.acAccessories.delete(applianceId);
                    }
                }
            }
            this.startPolling(Number(pollingInterval));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error(`Failed to connect to hOn cloud: ${msg}`);
        }
    }
    setupAcAccessory(appliance, email, password) {
        const uuid = this.api.hap.uuid.generate(appliance.applianceId);
        const existing = this.cachedAccessories.find((a) => a.UUID === uuid);
        if (existing) {
            this.log.info(`Restoring existing AC: ${appliance.nickName}`);
            existing.context.device = appliance;
            this.api.updatePlatformAccessories([existing]);
            const handler = new acAccessory_1.AcAccessory(existing, this.honApi, email, password, this.api, this.log);
            this.acAccessories.set(appliance.applianceId, handler);
            return;
        }
        this.log.info(`Adding new AC: ${appliance.nickName}`);
        const accessory = new this.api.platformAccessory(appliance.nickName, uuid);
        accessory.context.device = appliance;
        const handler = new acAccessory_1.AcAccessory(accessory, this.honApi, email, password, this.api, this.log);
        this.acAccessories.set(appliance.applianceId, handler);
        this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
    }
    startPolling(intervalSeconds) {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
        }
        const safeInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 5
            ? intervalSeconds
            : 30;
        this.log.info(`Starting polling every ${safeInterval}s`);
        this.pollingTimer = setInterval(() => {
            void this.pollAccessories();
        }, safeInterval * 1000);
    }
    async pollAccessories() {
        for (const [id, handler] of this.acAccessories) {
            try {
                await handler.refreshCharacteristics();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.log.warn(`Poll failed for ${id}: ${msg}`);
            }
        }
    }
}
exports.HonPlatform = HonPlatform;

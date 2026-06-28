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
        // Cache of restored accessories (avoids duplicating on restart)
        this.cachedAccessories = [];
        // Active accessory handlers
        this.acAccessories = new Map();
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.honApi = new honApi_1.HonApiClient(log);
        this.log.debug('hOn platform initializing');
        // Homebridge is ready – discover devices
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }
    // Called for each cached accessory on restart
    configureAccessory(accessory) {
        this.log.info('Restoring cached accessory:', accessory.displayName);
        this.cachedAccessories.push(accessory);
    }
    // ─── Device discovery ──────────────────────────────────────────────────────
    async discoverDevices() {
        const { email, password, pollingInterval = 30 } = this.config;
        if (!email || !password) {
            this.log.error('Missing email or password in config – please check config.json');
            return;
        }
        try {
            await this.honApi.login(email, password);
            const appliances = await this.honApi.getAppliances(email, password);
            this.log.info(`Found ${appliances.length} appliance(s) in your hOn account`);
            for (const appliance of appliances) {
                this.log.info(`  • ${appliance.nickName} (${appliance.applianceTypeName} / ${appliance.modelName})`);
                if (appliance.applianceTypeName === settings_1.DEVICE_TYPES.AC) {
                    this.setupAcAccessory(appliance, email, password);
                }
                else {
                    this.log.info(`    ↳ Skipping unsupported type: ${appliance.applianceTypeName}`);
                }
            }
            // Remove stale cached accessories no longer in the account
            const activeIds = appliances.map((a) => a.applianceId);
            const stale = this.cachedAccessories.filter((a) => !activeIds.includes(a.context.device?.applianceId));
            if (stale.length > 0) {
                this.log.info(`Removing ${stale.length} stale accessory(ies)`);
                this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
            }
            // Start polling loop
            this.startPolling(pollingInterval);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error('Failed to connect to hOn cloud:', msg);
        }
    }
    setupAcAccessory(appliance, email, password) {
        const uuid = this.api.hap.uuid.generate(appliance.applianceId);
        // Check if already registered
        const existing = this.cachedAccessories.find((a) => a.UUID === uuid);
        if (existing) {
            this.log.info(`Restoring existing AC: ${appliance.nickName}`);
            existing.context.device = appliance;
            this.api.updatePlatformAccessories([existing]);
            const handler = new acAccessory_1.AcAccessory(existing, this.honApi, email, password, this.api, this.log);
            this.acAccessories.set(appliance.applianceId, handler);
            return;
        }
        // Register new accessory
        this.log.info(`Adding new AC: ${appliance.nickName}`);
        const accessory = new this.api.platformAccessory(appliance.nickName, uuid);
        accessory.context.device = appliance;
        const handler = new acAccessory_1.AcAccessory(accessory, this.honApi, email, password, this.api, this.log);
        this.acAccessories.set(appliance.applianceId, handler);
        this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
    }
    // ─── Polling ───────────────────────────────────────────────────────────────
    startPolling(intervalSeconds) {
        if (this.pollingTimer)
            clearInterval(this.pollingTimer);
        this.log.info(`Starting polling every ${intervalSeconds}s`);
        this.pollingTimer = setInterval(async () => {
            for (const [id, handler] of this.acAccessories) {
                try {
                    await handler.refreshCharacteristics();
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.log.warn(`Poll failed for ${id}:`, msg);
                }
            }
        }, intervalSeconds * 1000);
    }
}
exports.HonPlatform = HonPlatform;

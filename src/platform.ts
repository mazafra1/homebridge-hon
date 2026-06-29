import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, DEVICE_TYPES } from './settings';
import { HonApiClient, HonAppliance } from './honApi';
import { AcAccessory } from './accessories/acAccessory';

export class HonPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly acAccessories = new Map<string, AcAccessory>();

  private readonly honApi: HonApiClient;
  private pollingTimer?: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.honApi = new HonApiClient(log);

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

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
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
        this.log.info(
          ` • ${appliance.nickName} (${appliance.applianceTypeName} / ${appliance.modelName})`,
        );

        if (appliance.applianceTypeName === DEVICE_TYPES.AC) {
          this.setupAcAccessory(appliance, String(email), String(password));
        } else {
          this.log.info(` ↳ Skipping unsupported type: ${appliance.applianceTypeName}`);
        }
      }

      const activeIds = new Set(appliances.map((a) => a.applianceId));
      const stale = this.cachedAccessories.filter(
        (a) => !activeIds.has(a.context.device?.applianceId),
      );

      if (stale.length > 0) {
        this.log.info(`Removing ${stale.length} stale accessory(ies)`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);

        for (const accessory of stale) {
          const applianceId = accessory.context.device?.applianceId;
          if (applianceId) {
            this.acAccessories.delete(applianceId);
          }
        }
      }

      this.startPolling(Number(pollingInterval));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`Failed to connect to hOn cloud: ${msg}`);
    }
  }

  private setupAcAccessory(
    appliance: HonAppliance,
    email: string,
    password: string,
  ): void {
    const uuid = this.api.hap.uuid.generate(appliance.applianceId);
    const existing = this.cachedAccessories.find((a) => a.UUID === uuid);

    if (existing) {
      this.log.info(`Restoring existing AC: ${appliance.nickName}`);
      existing.context.device = appliance;
      this.api.updatePlatformAccessories([existing]);

      const handler = new AcAccessory(
        existing,
        this.honApi,
        email,
        password,
        this.api,
        this.log,
      );
      this.acAccessories.set(appliance.applianceId, handler);
      return;
    }

    this.log.info(`Adding new AC: ${appliance.nickName}`);
    const accessory = new this.api.platformAccessory(appliance.nickName, uuid);
    accessory.context.device = appliance;

    const handler = new AcAccessory(
      accessory,
      this.honApi,
      email,
      password,
      this.api,
      this.log,
    );
    this.acAccessories.set(appliance.applianceId, handler);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private startPolling(intervalSeconds: number): void {
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

  private async pollAccessories(): Promise<void> {
    for (const [id, handler] of this.acAccessories) {
      try {
        await handler.refreshCharacteristics();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Poll failed for ${id}: ${msg}`);
      }
    }
  }
}
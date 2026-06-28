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

  // Cache of restored accessories (avoids duplicating on restart)
  private readonly cachedAccessories: PlatformAccessory[] = [];
  // Active accessory handlers
  private readonly acAccessories: Map<string, AcAccessory> = new Map();

  private readonly honApi: HonApiClient;
  private pollingTimer?: ReturnType<typeof setInterval>;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.honApi = new HonApiClient(log);

    this.log.debug('hOn platform initializing');

    // Homebridge is ready – discover devices
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  // Called for each cached accessory on restart
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  // ─── Device discovery ──────────────────────────────────────────────────────

  private async discoverDevices(): Promise<void> {
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
        this.log.info(
          `  • ${appliance.nickName} (${appliance.applianceTypeName} / ${appliance.modelName})`,
        );
        if (appliance.applianceTypeName === DEVICE_TYPES.AC) {
          this.setupAcAccessory(appliance, email, password);
        } else {
          this.log.info(
            `    ↳ Skipping unsupported type: ${appliance.applianceTypeName}`,
          );
        }
      }

      // Remove stale cached accessories no longer in the account
      const activeIds = appliances.map((a) => a.applianceId);
      const stale = this.cachedAccessories.filter(
        (a) => !activeIds.includes(a.context.device?.applianceId),
      );
      if (stale.length > 0) {
        this.log.info(`Removing ${stale.length} stale accessory(ies)`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      }

      // Start polling loop
      this.startPolling(pollingInterval as number);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('Failed to connect to hOn cloud:', msg);
    }
  }

  private setupAcAccessory(
    appliance: HonAppliance,
    email: string,
    password: string,
  ): void {
    const uuid = this.api.hap.uuid.generate(appliance.applianceId);

    // Check if already registered
    const existing = this.cachedAccessories.find((a) => a.UUID === uuid);
    if (existing) {
      this.log.info(`Restoring existing AC: ${appliance.nickName}`);
      existing.context.device = appliance;
      this.api.updatePlatformAccessories([existing]);
      const handler = new AcAccessory(
        existing, this.honApi, email, password, this.api, this.log,
      );
      this.acAccessories.set(appliance.applianceId, handler);
      return;
    }

    // Register new accessory
    this.log.info(`Adding new AC: ${appliance.nickName}`);
    const accessory = new this.api.platformAccessory(appliance.nickName, uuid);
    accessory.context.device = appliance;
    const handler = new AcAccessory(
      accessory, this.honApi, email, password, this.api, this.log,
    );
    this.acAccessories.set(appliance.applianceId, handler);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  private startPolling(intervalSeconds: number): void {
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    this.log.info(`Starting polling every ${intervalSeconds}s`);
    this.pollingTimer = setInterval(async () => {
      for (const [id, handler] of this.acAccessories) {
        try {
          await handler.refreshCharacteristics();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Poll failed for ${id}:`, msg);
        }
      }
    }, intervalSeconds * 1000);
  }
}

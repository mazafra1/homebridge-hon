import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import { HON_API_URL, HON_AUTH_URL } from './settings';

export interface HonAppliance {
  applianceId: string;
  applianceTypeName: string;  // 'AC', 'WM', etc.
  nickName: string;
  modelName: string;
  macAddress: string;
}

export interface AcStatus {
  onOffStatus: string;          // '0' = off, '1' = on
  operationMode: string;        // '0'=auto '1'=cool '2'=dry '3'=fan '4'=heat
  tempSel: string;              // target temperature (°C as string)
  tempIndoor: string;           // current indoor temperature
  windSpeed: string;            // fan speed: '1'=low '2'=medium '3'=high '5'=auto
  windDirectionHorizontal: string;
  windDirectionVertical: string;
  silentSleepStatus: string;    // '0'=off '1'=on
  rapidModeStatus: string;      // '0'=off '1'=on (turbo)
  ecoModeStatus: string;        // '0'=off '1'=on
  selfCleanStatus: string;
}

export class HonApiClient {
  private http: AxiosInstance;
  private token = '';
  private refreshToken = '';
  private tokenExpiry = 0;
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
    this.http = axios.create({
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Authentication ────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<void> {
    this.log.debug('Logging in to hOn cloud...');
    try {
      // Step 1: get login page & CSRF token
      const loginPageResp = await this.http.get(
        `${HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/auth`,
        {
          params: {
            client_id: 'hon-ios',
            response_type: 'code',
            redirect_uri: 'hon://oauth2/callback',
            scope: 'openid',
          },
          maxRedirects: 5,
        },
      );

      // Extract action URL from login form HTML
      const actionMatch = loginPageResp.data.match(/action="([^"]+)"/);
      if (!actionMatch) {
        throw new Error('Could not find login form action URL');
      }
      const actionUrl = actionMatch[1].replace(/&amp;/g, '&');

      // Step 2: submit credentials
      const formData = new URLSearchParams({
        username: email,
        password: password,
        credentialId: '',
      });

      const submitResp = await this.http.post(actionUrl, formData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 0,
        validateStatus: (s) => s === 302 || s === 200,
      });

      // Step 3: extract auth code from redirect location
      const location = submitResp.headers['location'] || '';
      const codeMatch = location.match(/[?&]code=([^&]+)/);
      if (!codeMatch) {
        throw new Error('Login failed: no auth code in redirect. Check credentials.');
      }
      const authCode = codeMatch[1];

      // Step 4: exchange code for tokens
      const tokenResp = await this.http.post(
        `${HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'hon-ios',
          code: authCode,
          redirect_uri: 'hon://oauth2/callback',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      this.token = tokenResp.data.access_token;
      this.refreshToken = tokenResp.data.refresh_token;
      this.tokenExpiry = Date.now() + (tokenResp.data.expires_in - 60) * 1000;
      this.log.info('Successfully logged in to hOn cloud');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('hOn login failed:', msg);
      throw err;
    }
  }

  private async ensureToken(email: string, password: string): Promise<void> {
    if (Date.now() < this.tokenExpiry) return;

    if (this.refreshToken) {
      try {
        const resp = await this.http.post(
          `${HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'hon-ios',
            refresh_token: this.refreshToken,
          }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        );
        this.token = resp.data.access_token;
        this.refreshToken = resp.data.refresh_token;
        this.tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
        this.log.debug('hOn token refreshed');
        return;
      } catch {
        this.log.warn('Token refresh failed, re-logging in...');
      }
    }
    await this.login(email, password);
  }

  // ─── Appliances ────────────────────────────────────────────────────────────

  async getAppliances(email: string, password: string): Promise<HonAppliance[]> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(`${HON_API_URL}/api/commands/v1/appliances`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return resp.data.payload?.appliances ?? [];
  }

  // ─── AC Status ─────────────────────────────────────────────────────────────

  async getAcStatus(
    applianceId: string,
    email: string,
    password: string,
  ): Promise<AcStatus> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(
      `${HON_API_URL}/api/commands/v1/appliances/${applianceId}/context`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    const params = resp.data.payload?.shadow?.parameters ?? {};
    return params as AcStatus;
  }

  // ─── AC Commands ───────────────────────────────────────────────────────────

  async sendAcCommand(
    applianceId: string,
    params: Partial<AcStatus>,
    email: string,
    password: string,
  ): Promise<void> {
    await this.ensureToken(email, password);
    await this.http.post(
      `${HON_API_URL}/api/commands/v1/appliances/${applianceId}/commands`,
      {
        applianceId,
        commandName: 'settings',
        parameters: params,
        ancillaryParameters: {
          programFamily: '[T]',
          programNameId: '241',
          programRules: {},
        },
      },
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    this.log.debug(`AC command sent to ${applianceId}:`, JSON.stringify(params));
  }
}

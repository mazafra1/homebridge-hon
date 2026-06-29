import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import { HON_API_URL, HON_AUTH_URL } from './settings';

export interface HonAppliance {
  applianceId: string;
  applianceTypeName: string;
  nickName: string;
  modelName: string;
  macAddress: string;
}

export interface AcStatus {
  onOffStatus: string;
  operationMode: string;
  tempSel: string;
  tempIndoor: string;
  windSpeed: string;
  windDirectionHorizontal: string;
  windDirectionVertical: string;
  silentSleepStatus: string;
  rapidModeStatus: string;
  ecoModeStatus: string;
  selfCleanStatus: string;
}

const CLIENT_ID = '3MVG9QDx8IX8nP5T2Ha8ofvlmjLZl5L_gvfbT9.HJvpHGKoAS_dcMN8LYpTSYeVFCraUnV.2Ag1Ki7m4znVO6';
const APP_VERSION = '2.4.7';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

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
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
  }

  // ─── Authentication ────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<void> {
    this.log.debug('Logging in to hOn cloud...');
    try {
      // Step 1: get login page
      const loginPageResp = await this.http.get(
        `${HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/auth`,
        {
          params: {
            client_id: CLIENT_ID,
            response_type: 'code',
            redirect_uri: 'hon://oauth2/callback',
            scope: 'openid',
            state: Math.random().toString(36).substring(2),
          },
          headers: { 'User-Agent': USER_AGENT },
          maxRedirects: 5,
        },
      );

      this.log.debug('Login page snippet:', String(loginPageResp.data).substring(0, 500));

      // Extract action URL from login form — try multiple patterns
      let actionUrl: string | null = null;

      // Pattern 1: action="..."
      const m1 = String(loginPageResp.data).match(/action="([^"]+)"/);
      if (m1) actionUrl = m1[1].replace(/&amp;/g, '&');

      // Pattern 2: action='...'
      if (!actionUrl) {
        const m2 = String(loginPageResp.data).match(/action='([^']+)'/);
        if (m2) actionUrl = m2[1].replace(/&amp;/g, '&');
      }

      if (!actionUrl) {
        throw new Error('Could not find login form action URL. Check debug logs for page HTML.');
      }

      this.log.debug('Form action URL:', actionUrl);

      // Step 2: submit credentials
      const submitResp = await this.http.post(
        actionUrl,
        new URLSearchParams({
          username: email,
          password: password,
          credentialId: '',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          maxRedirects: 0,
          validateStatus: (s) => s === 302 || s === 200,
        },
      );

      // Step 3: extract auth code from redirect
      const location = submitResp.headers['location'] || '';
      this.log.debug('Redirect location:', location);

      const codeMatch = location.match(/[?&]code=([^&]+)/);
      if (!codeMatch) {
        throw new Error('Login failed: no auth code in redirect. Check your hOn credentials.');
      }
      const authCode = codeMatch[1];

      // Step 4: exchange code for tokens
      const tokenResp = await this.http.post(
        `${HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code: authCode,
          redirect_uri: 'hon://oauth2/callback',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
        },
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
            client_id: CLIENT_ID,
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
      headers: {
        Authorization: `Bearer ${this.token}`,
        'x-hon-appversion': APP_VERSION,
        'User-Agent': USER_AGENT,
      },
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
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'x-hon-appversion': APP_VERSION,
          'User-Agent': USER_AGENT,
        },
      },
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
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'x-hon-appversion': APP_VERSION,
          'User-Agent': USER_AGENT,
        },
      },
    );
    this.log.debug(`AC command sent to ${applianceId}:`, JSON.stringify(params));
  }
}

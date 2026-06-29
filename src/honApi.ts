import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import { HON_API_URL, HON_AUTH_URL } from './settings';

// ─── Constants (from pyhon/const.py) ──────────────────────────────────────────
const CLIENT_ID = '3MVG9QDx8IX8nP5T2Ha8ofvlmjLZl5L_gvfbT9.HJvpHGKoAS_dcMN8LYpTSYeVFCraUnV.2Ag1Ki7m4znVO6';
const APP_VERSION = '2.6.5';
const APP = 'hon';
const USER_AGENT = 'Chrome/999.999.999.999';
const OS = 'android';
const OS_VERSION = 999;
const DEVICE_MODEL = 'pyhOn';
const MOBILE_ID = 'pyhOn';
const API_KEY = 'GRCqFhC6Gk@ikWXm1RmnSmX1cm,MxY-configuration';

// ─── Interfaces ────────────────────────────────────────────────────────────────
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

interface LoginData {
  url: string;
  fwUid: string;
  loaded: Record<string, string>;
}

interface AuthData {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  cognitoToken: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateNonce(): string {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeAuraData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`)
    .join('&');
}

// Make a relative URL absolute using HON_AUTH_URL as base
function toAbsoluteUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${HON_AUTH_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ─── Main client ───────────────────────────────────────────────────────────────
export class HonApiClient {
  private http: AxiosInstance;
  private auth: AuthData = { accessToken: '', refreshToken: '', idToken: '', cognitoToken: '' };
  private tokenExpiry = 0;
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
    this.http = axios.create({
      timeout: 20000,
      headers: { 'User-Agent': USER_AGENT },
      withCredentials: true,
    });

    this.http.interceptors.response.use((r) => {
      this.log.debug(`[HTTP] ${r.status} ${r.config.url}`);
      return r;
    });
  }

  // ── Step 1: introduce ─────────────────────────────────────────────────────
  private async introduce(): Promise<string> {
    const redirectUri = encodeURIComponent(`${APP}://mobilesdk/detect/oauth/done`);
    const nonce = generateNonce();
    const params = [
      `response_type=token+id_token`,
      `client_id=${CLIENT_ID}`,
      `redirect_uri=${redirectUri}`,
      `display=touch`,
      `scope=api openid refresh_token web`,
      `nonce=${nonce}`,
    ].join('&');

    const url = `${HON_AUTH_URL}/services/oauth2/authorize/expid_Login?${params}`;
    const resp = await this.http.get<string>(url, {
      responseType: 'text',
      maxRedirects: 10,
    });
    const text = resp.data;

    if (text.includes('oauth/done#access_token=')) {
      this.parseTokenData(text);
      throw new Error('NO_AUTH_NEEDED');
    }

    const matches = text.match(/(?:url|href)\s*=\s*'(.+?)'/);
    if (!matches) {
      this.log.error('introduce() response snippet:', text.substring(0, 500));
      throw new Error('Could not find login URL in introduce() response');
    }

    let loginUrl = matches[1];
    this.log.debug('introduce() raw loginUrl:', loginUrl);

    if (loginUrl.startsWith('/NewhOnLogin')) {
      loginUrl = `${HON_AUTH_URL}/s/login${loginUrl}`;
    }

    // Make sure it's an absolute URL
    loginUrl = toAbsoluteUrl(loginUrl);
    this.log.debug('introduce() final loginUrl:', loginUrl);
    return loginUrl;
  }

  // ── Step 2: handle redirects ──────────────────────────────────────────────
  private async handleRedirects(loginUrl: string): Promise<string> {
    const redirect1 = await this.manualRedirect(loginUrl);
    this.log.debug('redirect1:', redirect1);
    
    // If ProgressiveLogin appears, bypass it and use the original URL
    if (redirect1.includes('ProgressiveLogin')) {
      this.log.debug('ProgressiveLogin detected, bypassing...');
      return `${loginUrl}&System=IoT_Mobile_App&RegistrationSubChannel=hOn`;
    }
    
    const redirect2 = await this.manualRedirect(redirect1);
    this.log.debug('redirect2:', redirect2);
    return `${redirect2}&System=IoT_Mobile_App&RegistrationSubChannel=hOn`;
  }

  private async manualRedirect(url: string): Promise<string> {
    const resp = await this.http.get(url, {
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const location = resp.headers['location'];
    if (!location) return url;
    // Convert relative redirects to absolute
    return toAbsoluteUrl(location);
  }

  // ── Step 3: load login page, extract fwuid + loaded ──────────────────────
  private async loadLoginPage(loginUrl: string): Promise<LoginData> {
    const resp = await this.http.get<string>(loginUrl, {
      headers: { 'User-Agent': USER_AGENT },
      responseType: 'text',
      maxRedirects: 10,
    });
    const text = resp.data;

    const match = text.match(/"fwuid":"(.*?)","loaded":(\{.*?\})/);
    if (!match) {
      this.log.error('Login page snippet:', text.substring(0, 800));
      throw new Error('Could not find fwuid/loaded in login page');
    }

    const fwUid = match[1];
    const loaded: Record<string, string> = JSON.parse(match[2]);
    const urlPath = loginUrl.replace(HON_AUTH_URL, '');

    this.log.debug('fwuid:', fwUid);
    return { url: urlPath, fwUid, loaded };
  }

  // ── Full login sequence ────────────────────────────────────────────────────
  async login(email: string, password: string): Promise<void> {
    this.log.debug('Starting hOn login sequence...');
    this.auth = { accessToken: '', refreshToken: '', idToken: '', cognitoToken: '' };

    try {
      // Step 1
      let loginUrl: string;
      try {
        loginUrl = await this.introduce();
      } catch (e) {
        if ((e as Error).message === 'NO_AUTH_NEEDED') {
          this.log.info('Already authenticated');
          return;
        }
        throw e;
      }

      // Step 2
      loginUrl = await this.handleRedirects(loginUrl);

      // Step 3
      const loginData = await this.loadLoginPage(loginUrl);

      // Step 4: Aura POST with credentials
      const startUrlMatch = loginData.url.split('startURL=');
      const startUrl = startUrlMatch.length > 1
        ? decodeURIComponent(startUrlMatch[1]).split('%3D')[0]
        : '';

      const action = {
        id: '79;a',
        descriptor: 'apex://LightningLoginCustomController/ACTION$login',
        callingDescriptor: 'markup://c:loginForm',
        params: { username: email, password: password, startUrl },
      };
      const auraData: Record<string, unknown> = {
        message: { actions: [action] },
        'aura.context': {
          mode: 'PROD',
          fwuid: loginData.fwUid,
          app: 'siteforce:loginApp2',
          loaded: loginData.loaded,
          dn: [],
          globals: {},
          uad: false,
        },
        'aura.pageURI': loginData.url,
        'aura.token': null,
      };

      const auraResp = await this.http.post<string>(
        `${HON_AUTH_URL}/s/sfsites/aura`,
        encodeAuraData(auraData),
        {
          params: { r: 3, 'other.LightningLoginCustom.login': 1 },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          responseType: 'text',
          maxRedirects: 10,
        },
      );

      let redirectUrl: string;
      try {
        const result = JSON.parse(auraResp.data);
        redirectUrl = result?.events?.[0]?.attributes?.values?.url ?? '';
      } catch {
        this.log.error('Aura response:', String(auraResp.data).substring(0, 500));
        throw new Error('Could not parse Aura login response');
      }

      if (!redirectUrl) {
        this.log.error('Aura response:', String(auraResp.data).substring(0, 500));
        throw new Error('No redirect URL in Aura response. Check credentials.');
      }

      this.log.debug('Aura redirect URL:', redirectUrl);
      redirectUrl = toAbsoluteUrl(redirectUrl);

      // Step 5: Follow redirect URL to get tokens
      if (!await this.getToken(redirectUrl)) {
        throw new Error('Failed to extract tokens');
      }

      // Step 6: Exchange id_token for Cognito token
      if (!await this.apiAuth()) {
        throw new Error('Failed to get Cognito token from hOn API');
      }

      this.tokenExpiry = Date.now() + 8 * 60 * 60 * 1000;
      this.log.info('Successfully logged in to hOn cloud');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('hOn login failed:', msg);
      throw err;
    }
  }

  // ── Step 5: get tokens from redirect URL ──────────────────────────────────
  private async getToken(url: string): Promise<boolean> {
    const resp1 = await this.http.get<string>(url, { responseType: 'text', maxRedirects: 10 });
    if (resp1.status !== 200) return false;

    let hrefMatches = resp1.data.match(/href\s*=\s*["'](.+?)["']/);
    if (!hrefMatches) return false;

    let nextUrl = toAbsoluteUrl(hrefMatches[1]);
    this.log.debug('getToken nextUrl:', nextUrl);

    if (nextUrl.includes('ProgressiveLogin')) {
      const resp2 = await this.http.get<string>(nextUrl, { responseType: 'text', maxRedirects: 10 });
      if (resp2.status !== 200) return false;
      hrefMatches = resp2.data.match(/href\s*=\s*["'](.*?)["']/);
      if (!hrefMatches) return false;
      nextUrl = toAbsoluteUrl(hrefMatches[1]);
      this.log.debug('getToken nextUrl (after ProgressiveLogin):', nextUrl);
    }

    const resp3 = await this.http.get<string>(nextUrl, { responseType: 'text', maxRedirects: 10 });
    if (resp3.status !== 200) return false;

    return this.parseTokenData(resp3.data);
  }

  private parseTokenData(text: string): boolean {
    const access = text.match(/access_token=(.*?)&/);
    const refresh = text.match(/refresh_token=(.*?)&/);
    const id = text.match(/id_token=(.*?)&/);

    if (access) this.auth.accessToken = access[1];
    if (refresh) this.auth.refreshToken = decodeURIComponent(refresh[1]);
    if (id) this.auth.idToken = id[1];

    return !!(access && refresh && id);
  }

  // ── Step 6: exchange id_token for Cognito token ───────────────────────────
  private async apiAuth(): Promise<boolean> {
    const deviceData = {
      appVersion: APP_VERSION,
      os: OS,
      osVersion: String(OS_VERSION),
      deviceModel: DEVICE_MODEL,
      mobileId: MOBILE_ID,
    };
    const resp = await this.http.post(
      `${HON_API_URL}/auth/v1/login`,
      deviceData,
      { headers: { 'id-token': this.auth.idToken, 'Content-Type': 'application/json' } },
    );
    this.auth.cognitoToken = resp.data?.cognitoUser?.Token ?? '';
    if (!this.auth.cognitoToken) {
      this.log.error('apiAuth response:', JSON.stringify(resp.data));
      return false;
    }
    return true;
  }

  // ── Token refresh ─────────────────────────────────────────────────────────
  private async refresh(): Promise<boolean> {
    try {
      const resp = await this.http.post(
        `${HON_AUTH_URL}/services/oauth2/token`,
        null,
        {
          params: {
            client_id: CLIENT_ID,
            refresh_token: this.auth.refreshToken,
            grant_type: 'refresh_token',
          },
        },
      );
      if (resp.status >= 400) return false;
      this.auth.idToken = resp.data.id_token;
      this.auth.accessToken = resp.data.access_token;
      this.tokenExpiry = Date.now() + 8 * 60 * 60 * 1000;
      return await this.apiAuth();
    } catch {
      return false;
    }
  }

  private async ensureToken(email: string, password: string): Promise<void> {
    if (Date.now() < this.tokenExpiry) return;
    if (this.auth.refreshToken) {
      this.log.debug('Refreshing hOn token...');
      if (await this.refresh()) return;
      this.log.warn('Token refresh failed, re-logging in...');
    }
    await this.login(email, password);
  }

  private get apiHeaders(): Record<string, string> {
    return {
      'cognito-token': this.auth.cognitoToken,
      'id-token': this.auth.idToken,
      'x-hon-appversion': APP_VERSION,
      'x-api-key': API_KEY,
    };
  }

  // ─── Appliances ────────────────────────────────────────────────────────────
  async getAppliances(email: string, password: string): Promise<HonAppliance[]> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(
      `${HON_API_URL}/commands/v1/appliance`,
      { headers: this.apiHeaders },
    );
    return resp.data.payload?.appliances ?? [];
  }

  // ─── AC Status ─────────────────────────────────────────────────────────────
  async getAcStatus(applianceId: string, email: string, password: string): Promise<AcStatus> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(
      `${HON_API_URL}/commands/v1/appliances/${applianceId}/context`,
      { headers: this.apiHeaders },
    );
    return (resp.data.payload?.shadow?.parameters ?? {}) as AcStatus;
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
      `${HON_API_URL}/commands/v1/appliances/${applianceId}/commands`,
      {
        applianceId,
        commandName: 'settings',
        parameters: params,
        ancillaryParameters: { programFamily: '[T]', programNameId: '241', programRules: {} },
      },
      { headers: { ...this.apiHeaders, 'Content-Type': 'application/json' } },
    );
    this.log.debug(`AC command sent to ${applianceId}:`, JSON.stringify(params));
  }
}
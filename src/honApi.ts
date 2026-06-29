import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Logger } from 'homebridge';
import { HON_API_URL, HON_AUTH_URL } from './settings';

// ─── Constants ───────────────────────────────────────────────────────────────

const CLIENT_ID =
  '3MVG9QDx8IX8nP5T2Ha8ofvlmjLZl5L_gvfbT9.HJvpHGKoAS_dcMN8LYpTSYeVFCraUnV.2Ag1Ki7m4znVO6';
const APP_VERSION = '2.6.5';
const APP = 'hon';
const USER_AGENT = 'Chrome/999.999.999.999';
const OS = 'android';
const OS_VERSION = 999;
const DEVICE_MODEL = 'pyhOn';
const MOBILE_ID = 'pyhOn';
const API_KEY = 'GRCqFhC6Gk@ikWXm1RmnSmX1cm,MxY-configuration';

const BLOCKED_PATHS = [
  /services\/auth\/sso\//i,
  /accounts\.google\.com/i,
  /v3\/signin\/rejected/i,
  /authcallback\/Google/i,
  /apple\.com\/auth/i,
  /signin\/rejected/i,
];

// ─── Types ────────────────────────────────────────────────────────────────────

type LooseRecord = Record<string, unknown>;

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
  loaded: LooseRecord;
}

interface AuthData {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  cognitoToken: string;
}

// ─── Helpers (module-level, outside the class) ────────────────────────────────

function generateNonce(): string {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeAuraData(data: LooseRecord): string {
  return Object.entries(data)
    .map(([k, v]) =>
      `${encodeURIComponent(k)}=${encodeURIComponent(
        typeof v === 'string' ? v : JSON.stringify(v),
      )}`,
    )
    .join('&');
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${HON_AUTH_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function extractUrlFragmentTokens(input: string): {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
} {
  const fragmentIndex = input.indexOf('#');
  const queryIndex = input.indexOf('?');
  const source =
    fragmentIndex >= 0
      ? input.slice(fragmentIndex + 1)
      : queryIndex >= 0 && /access_token|refresh_token|id_token/.test(input)
        ? input.slice(queryIndex + 1)
        : input;

  const params = new URLSearchParams(source.replace(/^[?#]/, ''));
  return {
    accessToken: params.get('access_token') ?? undefined,
    refreshToken: params.get('refresh_token') ?? undefined,
    idToken: params.get('id_token') ?? undefined,
  };
}

function extractCandidateLinks(text: string): string[] {
  const results = new Set<string>();

  for (const match of text.matchAll(/(?:href|url)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1]?.trim();
    if (value) results.add(value);
  }
  for (const match of text.matchAll(
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
  )) {
    const value = match[1]?.trim();
    if (value) results.add(value);
  }
  for (const match of text.matchAll(
    /location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/gi,
  )) {
    const value = match[1]?.trim();
    if (value) results.add(value);
  }
  for (const match of text.matchAll(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/gi,
  )) {
    const value = match[1]?.trim();
    if (value) results.add(value);
  }

  return [...results]
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => !BLOCKED_PATHS.some((p) => p.test(u)));
}

function scoreContinuation(url: string): number {
  const absolute = toAbsoluteUrl(url);
  let score = 0;

  if (/oauth\/done#/i.test(absolute)) score += 5000;
  if (/access_token=|id_token=|refresh_token=/i.test(absolute)) score += 4000;
  if (/RemoteAccessAuthorizationPage\.apexp/i.test(absolute)) score += 2000;
  if (/ProgressiveLogin/i.test(absolute)) score += 1500;
  if (/NewhOnLogin/i.test(absolute)) score += 1400;
  if (/frontdoor\.jsp/i.test(absolute)) score += 1200;
  if (/retURL=/i.test(absolute)) score += 1000;
  if (/startURL=hon%3A|redirect_uri=hon%3A|hon:\/\/mobilesdk/i.test(absolute))
    score += 1000;
  if (/source=/i.test(absolute)) score += 500;
  if (/authorize|oauth|token/i.test(absolute)) score += 400;
  if (/login|auth|saml/i.test(absolute)) score += 100;

  if (absolute === `${HON_AUTH_URL}/` || absolute === `${HON_AUTH_URL}/?`)
    score -= 3000;
  if (
    /\/hOnRedirect\?/i.test(absolute) &&
    /startURL=%2Fs%2F/i.test(absolute)
  )
    score -= 2500;
  if (
    /\/s\/login\?/i.test(absolute) &&
    /startURL=%2F%2Fs%2F/i.test(absolute)
  )
    score -= 2500;
  if (
    /\/s\/login\?(?!.*RemoteAccessAuthorizationPage|.*ProgressiveLogin)/i.test(
      absolute,
    )
  )
    score -= 1200;
  if (/favicon|apple-touch-icon|manifest/i.test(absolute)) score -= 5000;
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico)(\?|$)/i.test(absolute))
    score -= 5000;
  if (/\$Resource\.|\{!URLFOR\(/i.test(absolute)) score -= 6000;
  if (BLOCKED_PATHS.some((p) => p.test(absolute))) score -= 9000;

  return score;
}

function pickBestAuthContinuation(text: string): string | null {
  const candidates = extractCandidateLinks(text).filter((url) => {
    if (!url) return false;
    if (url.startsWith('{!')) return false;
    if (url.includes('$Resource.')) return false;
    if (/^javascript:/i.test(url)) return false;
    if (url === '#' || url === '/') return false;
    if (/favicon|apple-touch-icon|manifest/i.test(url)) return false;
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico)(\?|$)/i.test(url)) return false;
    if (BLOCKED_PATHS.some((p) => p.test(url))) return false;
    return true;
  });

  const sorted = [...candidates].sort(
    (a, b) => scoreContinuation(b) - scoreContinuation(a),
  );
  return sorted[0] ?? null;
}

// ─── Main client class ────────────────────────────────────────────────────────

export class HonApiClient {
  private readonly http: AxiosInstance;
  private auth: AuthData = {
    accessToken: '',
    refreshToken: '',
    idToken: '',
    cognitoToken: '',
  };
  private tokenExpiry = 0;
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;

    const jar = new CookieJar();
    this.http = wrapper(
      axios.create({
        timeout: 20000,
        headers: { 'User-Agent': USER_AGENT },
        withCredentials: true,
        jar,
      }),
    );

    this.http.interceptors.response.use((r) => {
      this.log.debug(
        `[HTTP] ${r.status} ${String(r.config.method ?? 'GET').toUpperCase()} ${r.config.url}`,
      );
      return r;
    });
  }

  // ── Auth state helpers ────────────────────────────────────────────────────

  private clearAuth(): void {
    this.auth = {
      accessToken: '',
      refreshToken: '',
      idToken: '',
      cognitoToken: '',
    };
    this.tokenExpiry = 0;
  }

  private setTokenExpiry(): void {
    this.tokenExpiry = Date.now() + 8 * 60 * 60 * 1000;
  }

  private applyTokenBundle(tokens: Partial<AuthData>): void {
    if (tokens.accessToken) this.auth.accessToken = tokens.accessToken;
    if (tokens.refreshToken)
      this.auth.refreshToken = decodeURIComponent(tokens.refreshToken);
    if (tokens.idToken) this.auth.idToken = tokens.idToken;
  }

  private parseTokenData(text: string): boolean {
    const parsed = extractUrlFragmentTokens(text);
    this.applyTokenBundle(parsed);
    return Boolean(
      this.auth.accessToken && this.auth.refreshToken && this.auth.idToken,
    );
  }

  // ── Step 1: introduce ─────────────────────────────────────────────────────

  private async introduce(): Promise<string> {
    const redirectUri = encodeURIComponent(
      `${APP}://mobilesdk/detect/oauth/done`,
    );
    const nonce = generateNonce();
    const params = [
      'response_type=token+id_token',
      `client_id=${CLIENT_ID}`,
      `redirect_uri=${redirectUri}`,
      'display=touch',
      'scope=api openid refresh_token web',
      `nonce=${nonce}`,
    ].join('&');

    const url = `${HON_AUTH_URL}/services/oauth2/authorize/expid_Login?${params}`;
    const resp = await this.http.get<string>(url, {
      responseType: 'text',
      maxRedirects: 10,
    });
    const text = resp.data ?? '';

    if (
      (resp.request?.res?.responseUrl &&
        this.parseTokenData(
          String(resp.request.res.responseUrl),
        )) ||
      (text.includes('oauth/done#') && this.parseTokenData(text))
    ) {
      throw new Error('NO_AUTH_NEEDED');
    }

    const directPriority = extractCandidateLinks(text).find((candidate) =>
      /ProgressiveLogin|RemoteAccessAuthorizationPage\.apexp|NewhOnLogin|frontdoor\.jsp|oauth\/done#/i.test(
        candidate,
      ),
    );

    let loginUrl = directPriority ?? pickBestAuthContinuation(text) ?? '';
    if (!loginUrl) {
      this.log.error(
        `introduce() response snippet: ${text.substring(0, 700)}`,
      );
      throw new Error('Could not find login URL in introduce() response');
    }

    if (loginUrl.startsWith('/NewhOnLogin')) {
      loginUrl = `${HON_AUTH_URL}/s/login${loginUrl}`;
    }

    loginUrl = toAbsoluteUrl(loginUrl);
    this.log.debug(`introduce() final loginUrl: ${loginUrl}`);
    return loginUrl;
  }

  // ── Step 2: handleRedirects ───────────────────────────────────────────────

  private async manualRedirect(url: string): Promise<string> {
    const resp = await this.http.get<string>(url, {
      responseType: 'text',
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const location = resp.headers.location as string | undefined;
    if (location) {
      return toAbsoluteUrl(location);
    }

    const responseUrl = String(resp.request?.res?.responseUrl ?? '');
    if (responseUrl && responseUrl !== url) {
      return responseUrl;
    }

    return url;
  }

  private async handleRedirects(loginUrl: string): Promise<string> {
    if (
      /NewhOnLogin|ProgressiveLogin|RemoteAccessAuthorizationPage\.apexp/i.test(
        loginUrl,
      )
    ) {
      this.log.debug(
        `handleRedirects: loginUrl is already a login entry point, skipping redirect probing`,
      );
      return loginUrl;
    }

    const redirect1 = await this.manualRedirect(loginUrl);
    this.log.debug(`redirect1: ${redirect1}`);

    if (
      /NewhOnLogin|ProgressiveLogin|RemoteAccessAuthorizationPage\.apexp/i.test(
        redirect1,
      )
    ) {
      return redirect1;
    }

    const redirect2 = await this.manualRedirect(redirect1);
    this.log.debug(`redirect2: ${redirect2}`);

    return redirect2;
  }

  // ── Step 3: loadLoginPage ─────────────────────────────────────────────────

  private async loadLoginPage(loginUrl: string): Promise<LoginData> {
    let currentUrl = loginUrl;
    const visited = new Set<string>();

    const extractShellRedirect = (text: string): string | null => {
      const patterns = [
        /SfdcApp\.projectOneNavigator\.handleRedirect\(\s*['"]([^'"]+)['"]\s*\)/i,
        /window\.location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i,
        /window\.location\.href\s*=\s*['"]([^'"]+)['"]/i,
        /location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i,
        /location\.href\s*=\s*['"]([^'"]+)['"]/i,
        /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          const candidate = match[1].trim();
          if (BLOCKED_PATHS.some((p) => p.test(candidate))) continue;
          return candidate;
        }
      }
      return null;
    };

    for (let i = 0; i < 12; i++) {
      if (visited.has(currentUrl)) {
        throw new Error(
          `Login page redirect loop detected at ${currentUrl}`,
        );
      }
      visited.add(currentUrl);

      const resp = await this.http.get<string>(currentUrl, {
        headers: { 'User-Agent': USER_AGENT },
        responseType: 'text',
        maxRedirects: 10,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const responseUrl = String(
        resp.request?.res?.responseUrl ?? currentUrl,
      );
      const text = resp.data ?? '';

      // Check if we already landed on the OAuth callback
      if (
        responseUrl.includes('oauth/done#') &&
        this.parseTokenData(responseUrl)
      ) {
        throw new Error('TOKENS_ALREADY_EXTRACTED');
      }
      if (text.includes('oauth/done#') && this.parseTokenData(text)) {
        throw new Error('TOKENS_ALREADY_EXTRACTED');
      }

      // Check for fwuid/loaded — this is the real Aura login page
      const auraMatch = text.match(/"fwuid":"(.*?)","loaded":(\{.*?\})/s);
      if (auraMatch) {
        const fwUid = auraMatch[1];
        const loaded = JSON.parse(auraMatch[2]) as LooseRecord;
        const urlPath = responseUrl.replace(HON_AUTH_URL, '');
        this.log.debug(`fwuid: ${fwUid}`);
        return { url: urlPath, fwUid, loaded };
      }

      // Follow JS/Visualforce shell redirect
      const shellRedirect = extractShellRedirect(text);
      if (shellRedirect) {
        currentUrl = toAbsoluteUrl(shellRedirect);
        this.log.debug(`loadLoginPage redirect stub -> ${currentUrl}`);
        continue;
      }

      // Follow priority auth-related links
      const priorityLink = extractCandidateLinks(text).find((candidate) =>
        /NewhOnLogin|ProgressiveLogin|RemoteAccessAuthorizationPage\.apexp|hOnRedirect|frontdoor\.jsp|oauth\/done#/i.test(
          candidate,
        ),
      );
      if (priorityLink) {
        currentUrl = toAbsoluteUrl(priorityLink);
        this.log.debug(`loadLoginPage priority link -> ${currentUrl}`);
        continue;
      }

      // Last resort: best scored link
      const fallbackLink = pickBestAuthContinuation(text);
      if (fallbackLink) {
        currentUrl = toAbsoluteUrl(fallbackLink);
        this.log.debug(`loadLoginPage fallback link -> ${currentUrl}`);
        continue;
      }

      this.log.error(
        `Login page snippet: ${text.substring(0, 1200)}`,
      );
      throw new Error('Could not find fwuid/loaded in login page');
    }

    throw new Error(
      'Too many login-page redirects before reaching Aura login state',
    );
  }

  // ── Full login sequence ───────────────────────────────────────────────────

  async login(email: string, password: string): Promise<void> {
    this.log.debug('Starting hOn login sequence...');
    this.clearAuth();

    try {
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

      loginUrl = await this.handleRedirects(loginUrl);

      let loginData: LoginData;
      try {
        loginData = await this.loadLoginPage(loginUrl);
      } catch (e) {
        if ((e as Error).message === 'TOKENS_ALREADY_EXTRACTED') {
          if (
            !this.auth.idToken ||
            !this.auth.refreshToken ||
            !this.auth.accessToken
          ) {
            throw new Error(
              'OAuth callback reached but tokens were not parsed',
            );
          }
          if (!await this.apiAuth()) {
            throw new Error('Failed to get Cognito token from hOn API');
          }
          this.setTokenExpiry();
          this.log.info('Successfully logged in to hOn cloud');
          return;
        }
        throw e;
      }

      const startUrlMatch = loginData.url.split('startURL=');
      const startUrl =
        startUrlMatch.length > 1
          ? decodeURIComponent(startUrlMatch[1])
          : '';

      const action = {
        id: '79;a',
        descriptor:
          'apex://LightningLoginCustomController/ACTION$login',
        callingDescriptor: 'markup://c:loginForm',
        params: { username: email, password, startUrl },
      };

      const auraData: LooseRecord = {
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
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          responseType: 'text',
          maxRedirects: 10,
        },
      );

      let redirectUrl = '';
      try {
        const result = JSON.parse(auraResp.data) as LooseRecord;
        const events = Array.isArray(result.events)
          ? (result.events as LooseRecord[])
          : [];
        const first = events[0] ?? {};
        const attrs = (first.attributes as LooseRecord | undefined) ?? {};
        const values = (attrs.values as LooseRecord | undefined) ?? {};
        redirectUrl = String(values.url ?? '');
      } catch {
        this.log.error(
          `Aura response: ${String(auraResp.data).substring(0, 700)}`,
        );
        throw new Error('Could not parse Aura login response');
      }

      if (!redirectUrl) {
        this.log.error(
          `Aura response: ${String(auraResp.data).substring(0, 700)}`,
        );
        throw new Error(
          'No redirect URL in Aura response. Check credentials.',
        );
      }

      redirectUrl = toAbsoluteUrl(redirectUrl);
      this.log.debug(`Aura redirect URL: ${redirectUrl}`);

      if (!await this.getToken(redirectUrl)) {
        throw new Error('Failed to extract OAuth tokens after login');
      }

      if (
        !this.auth.idToken ||
        !this.auth.refreshToken ||
        !this.auth.accessToken
      ) {
        throw new Error(
          'OAuth flow finished without a complete token set',
        );
      }

      if (!await this.apiAuth()) {
        throw new Error('Failed to get Cognito token from hOn API');
      }

      this.setTokenExpiry();
      this.log.info('Successfully logged in to hOn cloud');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`hOn login failed: ${msg}`);
      throw err;
    }
  }

  // ── Step 5: getToken ──────────────────────────────────────────────────────

  private async getToken(url: string): Promise<boolean> {
    let currentUrl = url;
    const visited = new Set<string>();

    for (let i = 0; i < 10; i++) {
      if (visited.has(currentUrl)) {
        this.log.error(`Redirect loop detected at ${currentUrl}`);
        return false;
      }
      visited.add(currentUrl);

      const resp = await this.http.get<string>(currentUrl, {
        responseType: 'text',
        maxRedirects: 10,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const body = resp.data ?? '';
      const responseUrl = String(
        resp.request?.res?.responseUrl ?? currentUrl,
      );

      if (
        responseUrl.includes('oauth/done#') &&
        this.parseTokenData(responseUrl)
      ) {
        this.log.debug('OAuth tokens found in final response URL');
        return true;
      }
      if (body.includes('oauth/done#') && this.parseTokenData(body)) {
        this.log.debug('OAuth tokens found in response body');
        return true;
      }

      const inlineTokens = extractUrlFragmentTokens(body);
      if (
        inlineTokens.accessToken &&
        inlineTokens.refreshToken &&
        inlineTokens.idToken
      ) {
        this.applyTokenBundle(inlineTokens);
        this.log.debug('OAuth tokens found in parsed fragment content');
        return true;
      }

      const jsRedirects = [
        ...body.matchAll(
          /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
        ),
        ...body.matchAll(
          /location\.replace\(\s*["']([^"']+)["']\s*\)/gi,
        ),
        ...body.matchAll(
          /location\.assign\(\s*["']([^"']+)["']\s*\)/gi,
        ),
      ].map((m) => m[1]).filter(Boolean);

      for (const candidate of jsRedirects) {
        const absolute = toAbsoluteUrl(candidate);
        if (
          absolute.includes('oauth/done#') &&
          this.parseTokenData(absolute)
        ) {
          this.log.debug('OAuth tokens found in JavaScript redirect');
          return true;
        }
      }

      const priority = extractCandidateLinks(body).find((candidate) =>
        /ProgressiveLogin|RemoteAccessAuthorizationPage\.apexp|frontdoor\.jsp|oauth\/done#/i.test(
          candidate,
        ),
      );
      if (priority) {
        currentUrl = toAbsoluteUrl(priority);
        this.log.debug(`getToken priority nextUrl: ${currentUrl}`);
        continue;
      }

      const nextUrl = pickBestAuthContinuation(body);
      if (!nextUrl) {
        // Check for tokens in <form action="hon://...#access_token=...">
        const formActionMatch = body.match(/action=["']([^"']*oauth\/done#[^"']+)["']/i);
        if (formActionMatch?.[1]) {
          const decoded = formActionMatch[1].replace(/&amp;/g, '&');
          if (this.parseTokenData(decoded)) {
            this.log.debug('OAuth tokens found in form action attribute');
            return true;
          }
        }

        this.log.error(
          `No valid auth continuation found. Response snippet: ${body.substring(0, 900)}`,
        );
        return false;
      }

      currentUrl = toAbsoluteUrl(nextUrl);
      this.log.debug(`getToken nextUrl: ${currentUrl}`);
    }

    this.log.error('Exceeded redirect/token extraction attempts');
    return false;
  }

  // ── Step 6: apiAuth ───────────────────────────────────────────────────────

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
      {
        headers: {
          'id-token': this.auth.idToken,
          'Content-Type': 'application/json',
        },
      },
    );

    this.auth.cognitoToken = resp.data?.cognitoUser?.Token ?? '';
    if (!this.auth.cognitoToken) {
      this.log.error(`apiAuth response: ${JSON.stringify(resp.data)}`);
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
      this.setTokenExpiry();
      return await this.apiAuth();
    } catch {
      return false;
    }
  }

  private async ensureToken(
    email: string,
    password: string,
  ): Promise<void> {
    if (
      Date.now() < this.tokenExpiry &&
      this.auth.cognitoToken &&
      this.auth.idToken
    ) {
      return;
    }

    if (this.auth.refreshToken) {
      this.log.debug('Refreshing hOn token...');
      if (await this.refresh()) return;
      this.log.warn('Token refresh failed, re-logging in...');
    }

    await this.login(email, password);
  }

  // ── API headers ───────────────────────────────────────────────────────────

  private get apiHeaders(): Record<string, string> {
    return {
      'cognito-token': this.auth.cognitoToken,
      'id-token': this.auth.idToken,
      'x-hon-appversion': APP_VERSION,
      'x-api-key': API_KEY,
    };
  }

  // ── Public API methods ────────────────────────────────────────────────────

  async getAppliances(
    email: string,
    password: string,
  ): Promise<HonAppliance[]> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(
      `${HON_API_URL}/commands/v1/appliance`,
      { headers: this.apiHeaders },
    );

    // TEMP: log full response to find the real structure
    this.log.debug(`getAppliances raw: ${JSON.stringify(resp.data)}`);

    return (resp.data.payload?.appliances ?? []) as HonAppliance[];
  }

  async getAcStatus(
    applianceId: string,
    email: string,
    password: string,
  ): Promise<AcStatus> {
    await this.ensureToken(email, password);
    const resp = await this.http.get(
      `${HON_API_URL}/commands/v1/appliances/${applianceId}/context`,
      { headers: this.apiHeaders },
    );
    return (resp.data.payload?.shadow?.parameters ?? {}) as AcStatus;
  }

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
        ancillaryParameters: {
          programFamily: '[T]',
          programNameId: '241',
          programRules: {},
        },
      },
      {
        headers: {
          ...this.apiHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
    this.log.debug(
      `AC command sent to ${applianceId}: ${JSON.stringify(params)}`,
    );
  }
}
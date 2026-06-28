"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HonApiClient = void 0;
const axios_1 = __importDefault(require("axios"));
const settings_1 = require("./settings");
class HonApiClient {
    constructor(log) {
        this.token = '';
        this.refreshToken = '';
        this.tokenExpiry = 0;
        this.log = log;
        this.http = axios_1.default.create({
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    // ─── Authentication ────────────────────────────────────────────────────────
    async login(email, password) {
        this.log.debug('Logging in to hOn cloud...');
        try {
            // Step 1: get login page & CSRF token
            const loginPageResp = await this.http.get(`${settings_1.HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/auth`, {
                params: {
                    client_id: 'hon-ios',
                    response_type: 'code',
                    redirect_uri: 'hon://oauth2/callback',
                    scope: 'openid',
                },
                maxRedirects: 5,
            });
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
            const tokenResp = await this.http.post(`${settings_1.HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/token`, new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'hon-ios',
                code: authCode,
                redirect_uri: 'hon://oauth2/callback',
            }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            this.token = tokenResp.data.access_token;
            this.refreshToken = tokenResp.data.refresh_token;
            this.tokenExpiry = Date.now() + (tokenResp.data.expires_in - 60) * 1000;
            this.log.info('Successfully logged in to hOn cloud');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error('hOn login failed:', msg);
            throw err;
        }
    }
    async ensureToken(email, password) {
        if (Date.now() < this.tokenExpiry)
            return;
        if (this.refreshToken) {
            try {
                const resp = await this.http.post(`${settings_1.HON_AUTH_URL}/auth/realms/hon/protocol/openid-connect/token`, new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: 'hon-ios',
                    refresh_token: this.refreshToken,
                }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                this.token = resp.data.access_token;
                this.refreshToken = resp.data.refresh_token;
                this.tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
                this.log.debug('hOn token refreshed');
                return;
            }
            catch {
                this.log.warn('Token refresh failed, re-logging in...');
            }
        }
        await this.login(email, password);
    }
    // ─── Appliances ────────────────────────────────────────────────────────────
    async getAppliances(email, password) {
        await this.ensureToken(email, password);
        const resp = await this.http.get(`${settings_1.HON_API_URL}/api/commands/v1/appliances`, {
            headers: { Authorization: `Bearer ${this.token}` },
        });
        return resp.data.payload?.appliances ?? [];
    }
    // ─── AC Status ─────────────────────────────────────────────────────────────
    async getAcStatus(applianceId, email, password) {
        await this.ensureToken(email, password);
        const resp = await this.http.get(`${settings_1.HON_API_URL}/api/commands/v1/appliances/${applianceId}/context`, { headers: { Authorization: `Bearer ${this.token}` } });
        const params = resp.data.payload?.shadow?.parameters ?? {};
        return params;
    }
    // ─── AC Commands ───────────────────────────────────────────────────────────
    async sendAcCommand(applianceId, params, email, password) {
        await this.ensureToken(email, password);
        await this.http.post(`${settings_1.HON_API_URL}/api/commands/v1/appliances/${applianceId}/commands`, {
            applianceId,
            commandName: 'settings',
            parameters: params,
            ancillaryParameters: {
                programFamily: '[T]',
                programNameId: '241',
                programRules: {},
            },
        }, { headers: { Authorization: `Bearer ${this.token}` } });
        this.log.debug(`AC command sent to ${applianceId}:`, JSON.stringify(params));
    }
}
exports.HonApiClient = HonApiClient;

import { Logger } from 'homebridge';
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
export declare class HonApiClient {
    private readonly http;
    private auth;
    private tokenExpiry;
    private readonly log;
    constructor(log: Logger);
    private clearAuth;
    private setTokenExpiry;
    private applyTokenBundle;
    private parseTokenData;
    private introduce;
    private manualRedirect;
    private handleRedirects;
    private loadLoginPage;
    login(email: string, password: string): Promise<void>;
    private getToken;
    private apiAuth;
    private refresh;
    private ensureToken;
    private get apiHeaders();
    getAppliances(email: string, password: string): Promise<HonAppliance[]>;
    getAcStatus(applianceId: string, email: string, password: string): Promise<AcStatus>;
    sendAcCommand(applianceId: string, params: Partial<AcStatus>, email: string, password: string): Promise<void>;
}

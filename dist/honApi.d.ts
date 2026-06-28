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
    private http;
    private token;
    private refreshToken;
    private tokenExpiry;
    private readonly log;
    constructor(log: Logger);
    login(email: string, password: string): Promise<void>;
    private ensureToken;
    getAppliances(email: string, password: string): Promise<HonAppliance[]>;
    getAcStatus(applianceId: string, email: string, password: string): Promise<AcStatus>;
    sendAcCommand(applianceId: string, params: Partial<AcStatus>, email: string, password: string): Promise<void>;
}

import { registerPlugin } from '@capacitor/core';

export interface SmsIngestPermissionResult {
    sms: 'granted' | 'denied' | 'prompt';
}

export interface SmsIngestStateResult {
    enabled: boolean;
    permissionGranted?: boolean;
}

export interface SmsIngestPlugin {
    requestSmsPermission(): Promise<SmsIngestPermissionResult>;
    checkSmsPermission(): Promise<SmsIngestPermissionResult>;
    setEnabled(options: { enabled: boolean }): Promise<SmsIngestStateResult>;
    getEnabled(): Promise<SmsIngestStateResult>;
    initialize(): Promise<SmsIngestStateResult>;
    openAppSettings(): Promise<void>;
}

export const SmsIngest = registerPlugin<SmsIngestPlugin>('SmsIngest');


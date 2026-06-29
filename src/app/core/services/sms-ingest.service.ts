import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';
import { SmsIngest } from '../native/sms-ingest.plugin';

@Injectable({
    providedIn: 'root'
})
export class SmsIngestService {
    private platformService = inject(PlatformService);
    enabled = signal(false);
    permission = signal<'granted' | 'denied' | 'prompt'>('prompt');

    async initialize() {
        if (!this.platformService.isAndroid) {
            return;
        }

        try {
            await SmsIngest.setEnabled({ enabled: true });
            const init = await SmsIngest.initialize();
            const permission = await SmsIngest.checkSmsPermission();
            this.permission.set(permission.sms);
            this.enabled.set(!!init.enabled);
        } catch (error) {
            console.error('Failed to initialize SMS ingest:', error);
        }
    }

    async requestSmsPermission(): Promise<boolean> {
        if (!this.platformService.isAndroid) {
            this.permission.set('denied');
            return false;
        }
        try {
            const requested = await SmsIngest.requestSmsPermission();
            this.permission.set(requested.sms);
            return requested.sms === 'granted';
        } catch (error) {
            console.error('Failed to request SMS permission:', error);
            return false;
        }
    }

    async setEnabled(enabled: boolean): Promise<boolean> {
        if (!this.platformService.isAndroid) {
            this.enabled.set(false);
            this.permission.set('denied');
            return false;
        }

        try {
            if (enabled) {
                const granted = await this.requestSmsPermission();
                if (!granted) {
                    await SmsIngest.setEnabled({ enabled: false });
                    this.enabled.set(false);
                    return false;
                }
            }

            const state = await SmsIngest.setEnabled({ enabled });
            this.enabled.set(!!state.enabled);
            return !!state.enabled;
        } catch (error) {
            console.error('Failed to update SMS ingest setting:', error);
            return false;
        }
    }

    async openAppSettings() {
        if (!this.platformService.isAndroid) return;
        try {
            await SmsIngest.openAppSettings();
        } catch (error) {
            console.error('Failed to open app settings:', error);
        }
    }

    showManualPermissionNotice() {
        alert(
            'To use SMS auto-detect, please grant SMS permission manually:\n\n' +
            'Settings > Apps > Track Expense > Permissions > SMS > Allow'
        );
    }
}


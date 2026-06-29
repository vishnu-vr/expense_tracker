import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

@Injectable({
    providedIn: 'root'
})
export class PwaService {
    private deferredPrompt: any;
    showInstallButton = signal(false);

    constructor() {
        if (Capacitor.isNativePlatform()) {
            return;
        }

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallButton.set(true);
            console.log('PWA Service: beforeinstallprompt event fired');
        });

        window.addEventListener('appinstalled', () => {
            this.showInstallButton.set(false);
            this.deferredPrompt = null;
            console.log('PWA Service: App installed');
        });
    }

    async installPwa() {
        if (!this.deferredPrompt) {
            return;
        }
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`PWA Service: User response to install prompt: ${outcome}`);
        this.deferredPrompt = null;
        this.showInstallButton.set(false);
    }
}

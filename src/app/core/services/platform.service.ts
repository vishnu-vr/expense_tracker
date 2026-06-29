import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

@Injectable({
    providedIn: 'root'
})
export class PlatformService {
    readonly isNative = Capacitor.isNativePlatform();
    readonly platform = Capacitor.getPlatform();
    readonly isAndroid = this.platform === 'android';
    readonly isIos = this.platform === 'ios';
    readonly isWeb = this.platform === 'web';
}

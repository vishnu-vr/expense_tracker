/**
 * Patch Capacitor static APIs for tests. Restore after each test.
 */
import { Capacitor } from '@capacitor/core';

let originalGetPlatform: typeof Capacitor.getPlatform;
let originalIsNative: typeof Capacitor.isNativePlatform;

export function patchCapacitorPlatform(platform: 'web' | 'android' | 'ios', isNative: boolean): void {
    if (!originalGetPlatform) {
        originalGetPlatform = Capacitor.getPlatform.bind(Capacitor);
    }
    if (!originalIsNative) {
        originalIsNative = Capacitor.isNativePlatform.bind(Capacitor);
    }
    spyOn(Capacitor, 'getPlatform').and.returnValue(platform);
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(isNative);
}

export function restoreCapacitorMocks(): void {
    // Spy restoration happens in afterEach via jasmine - no-op placeholder for symmetry
}

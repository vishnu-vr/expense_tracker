import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore, enableMultiTabIndexedDbPersistence } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { environment } from '../environments/environment';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => {
        const firestore = getFirestore();
        enableMultiTabIndexedDbPersistence(firestore);
        return firestore;
    }),
    provideFunctions(() => getFunctions()),
    provideServiceWorker('ngsw-worker.js', {
        enabled: !isDevMode() && !Capacitor.isNativePlatform(),
        registrationStrategy: 'registerWhenStable:30000'
    })
]
};

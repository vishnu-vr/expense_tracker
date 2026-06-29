import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vapps.expensetracker',
  appName: 'Track Expense',
  webDir: 'dist/expense-tracker/browser',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#2563eb',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#2563eb',
      style: 'DARK',
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
  android: {
    backgroundColor: '#fafafa',
  },
};

export default config;

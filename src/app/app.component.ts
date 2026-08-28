import { Component, effect, inject, NgZone, OnInit } from '@angular/core';
import { RouterOutlet, RouterModule, Router } from '@angular/router';
import { Firestore, disableNetwork, enableNetwork } from '@angular/fire/firestore';
import { ChangelogDialogComponent } from './shared/components/changelog-dialog/changelog-dialog.component';
import { BottomNavComponent } from './shared/components/bottom-nav/bottom-nav.component';
import { PlatformService } from './core/services/platform.service';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { SmsIngestService } from './core/services/sms-ingest.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterModule, ChangelogDialogComponent, BottomNavComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'expense-tracker';
  private platformService = inject(PlatformService);
  private router = inject(Router);
  private ngZone = inject(NgZone);
  private smsIngestService = inject(SmsIngestService);
  private themeService = inject(ThemeService);
  private firestore = inject(Firestore);
  private isFirstActivation = true;
  private isResyncing = false;

  constructor() {
    effect(() => {
      const theme = this.themeService.effectiveTheme();
      if (this.platformService.isAndroid) {
        void this.applyStatusBarTheme(theme);
      }
    });
  }

  private async applyStatusBarTheme(theme: 'light' | 'dark') {
    if (theme === 'dark') {
      await StatusBar.setBackgroundColor({ color: '#161b2e' });
      await StatusBar.setStyle({ style: Style.Light });
    } else {
      await StatusBar.setBackgroundColor({ color: '#f1f5f9' });
      await StatusBar.setStyle({ style: Style.Dark });
    }
  }

  private handleDeepLink(url: string) {
    try {
      const parsed = new URL(url);
      const isAddTransactionHost = parsed.host === 'add-transaction';
      const isRootPath = parsed.pathname === '' || parsed.pathname === '/';
      const routePath = isAddTransactionHost && isRootPath
        ? '/add-transaction'
        : `${parsed.pathname || ''}`;
      const search = parsed.search || '';
      const target = `${routePath}${search}`.trim();
      if (target.length > 0 && target !== '/') {
        this.router.navigateByUrl(target);
        return;
      }
    } catch {
      // Fall back to older parsing behavior if URL parsing fails.
    }

    const slug = url.split('com.vapps.expensetracker').pop();
    if (slug) {
      this.router.navigateByUrl(slug);
    }
  }

  async ngOnInit() {
    if (!this.platformService.isNative) return;

    await SplashScreen.hide();

    if (this.platformService.isAndroid) {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await this.applyStatusBarTheme(this.themeService.effectiveTheme());
      await this.smsIngestService.initialize();
    }

    App.addListener('backButton', ({ canGoBack }) => {
      this.ngZone.run(() => {
        const currentUrl = this.router.url.split('?')[0];
        const isRootScreen = currentUrl === '/' || currentUrl === '/home' || currentUrl === '/transactions' || currentUrl === '/dashboard' || currentUrl === '/login';

        if (isRootScreen) {
          App.minimizeApp();
        } else if (canGoBack) {
          window.history.back();
        } else {
          App.minimizeApp();
        }
      });
    });

    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      this.ngZone.run(() => this.handleDeepLink(launch.url));
    }

    App.addListener('appUrlOpen', (data) => {
      this.ngZone.run(() => {
        this.handleDeepLink(data.url);
      });
    });

    // When the app returns to the foreground on Android, the WebView (and the
    // Firestore WebChannel used by onSnapshot) may have been paused/dropped by
    // the OS. Force a network reconnect so all active listeners re-sync from
    // the server instead of serving stale IndexedDB cache.
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      if (this.isFirstActivation) {
        this.isFirstActivation = false;
        return;
      }
      this.resyncFirestore();
    });
  }

  private async resyncFirestore() {
    if (this.isResyncing) return;
    this.isResyncing = true;
    try {
      await disableNetwork(this.firestore);
      await enableNetwork(this.firestore);
    } catch (err) {
      console.warn('Firestore resync on resume failed:', err);
    } finally {
      this.isResyncing = false;
    }
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FF } from '../firebase/ng-fire-mod';
import { PlatformService } from './platform.service';

/** Mutable wrappers so unit tests can `spyOn` Capacitor plugin calls. */
export const nativeCsvDelivery = {
    writeFile: Filesystem.writeFile.bind(Filesystem),
    getUri: Filesystem.getUri.bind(Filesystem),
    share: Share.share.bind(Share),
};

export interface ExportTransactionsRequest {
    from: string;
    to: string;
    timeZone: string;
}

export interface ExportTransactionsResult {
    csv: string;
    filename: string;
    count: number;
}

@Injectable({
    providedIn: 'root'
})
export class ExportService {
    private functions = inject(Functions);
    private platformService = inject(PlatformService);

    isExporting = signal(false);
    error = signal<string | null>(null);

    async exportTransactions(from: string, to: string): Promise<ExportTransactionsResult> {
        this.isExporting.set(true);
        this.error.set(null);

        try {
            const exportTransactionsCsv = FF.httpsCallable<
                ExportTransactionsRequest,
                ExportTransactionsResult
            >(this.functions, 'exportTransactionsCsv');

            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const result = await exportTransactionsCsv({ from, to, timeZone });
            const data = result.data;
            await this.deliverCsv(data.csv, data.filename);
            return data;
        } catch (err: any) {
            const errorMessage = err?.message || 'Failed to export transactions. Please try again.';
            this.error.set(errorMessage);
            throw err;
        } finally {
            this.isExporting.set(false);
        }
    }

    private async deliverCsv(csv: string, filename: string): Promise<void> {
        if (this.platformService.isNative) {
            await this.shareOnNative(csv, filename);
            return;
        }
        this.downloadInBrowser(csv, filename);
    }

    private downloadInBrowser(csv: string, filename: string): void {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    private async shareOnNative(csv: string, filename: string): Promise<void> {
        await nativeCsvDelivery.writeFile({
            path: filename,
            data: csv,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });
        const { uri } = await nativeCsvDelivery.getUri({
            path: filename,
            directory: Directory.Cache,
        });
        await nativeCsvDelivery.share({
            title: filename,
            url: uri,
        });
    }
}

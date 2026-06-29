import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SmsIngestService } from '../../core/services/sms-ingest.service';

@Component({
    selector: 'app-sms-permission-help',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './sms-permission-help.component.html'
})
export class SmsPermissionHelpComponent {
    private smsIngestService = inject(SmsIngestService);

    openAppSettings() {
        this.smsIngestService.openAppSettings();
    }
}


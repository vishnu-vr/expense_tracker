import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChangelogService } from '../../../core/services/changelog.service';

@Component({
    selector: 'app-changelog-dialog',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './changelog-dialog.component.html',
    styleUrl: './changelog-dialog.component.css'
})
export class ChangelogDialogComponent {
    changelog = inject(ChangelogService);

    dismiss(): void {
        this.changelog.dismiss();
    }
}

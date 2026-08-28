import { Component, inject, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Notification } from '../../../core/models/models';

@Component({
    selector: 'app-notification-bell',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './notification-bell.component.html',
    styleUrl: './notification-bell.component.css'
})
export class NotificationBellComponent {
    notificationService = inject(NotificationService);
    private authService = inject(AuthService);
    private elementRef = inject(ElementRef);
    private router = inject(Router);

    @HostListener('document:pointerdown', ['$event'])
    onDocumentPointerDown(event: PointerEvent) {
        // Close dropdown if clicked outside
        if (!this.elementRef.nativeElement.contains(event.target)) {
            this.notificationService.closeDropdown();
        }
    }

    toggleDropdown(event: Event) {
        event.stopPropagation();
        this.notificationService.toggleDropdown();
    }

    closeDropdown(event?: Event) {
        event?.stopPropagation();
        this.notificationService.closeDropdown();
    }

    onNotificationClick(notification: Notification, event: Event) {
        event.stopPropagation();
        this.notificationService.markAsRead(notification.id);
        this.notificationService.closeDropdown();
        
        // Navigate to transaction if it exists and wasn't deleted
        if (notification.transactionId && notification.type !== 'transaction_deleted') {
            this.router.navigate(['/edit-transaction', notification.transactionId]);
        }
    }

    markAllAsRead(event: Event) {
        event.stopPropagation();
        this.notificationService.markAllAsRead();
    }

    async enablePushNotifications(event: Event) {
        event.stopPropagation();
        await this.notificationService.requestPushPermission();
    }

    async loadMore(event: Event) {
        event.stopPropagation();
        await this.notificationService.loadMore();
    }

    isRead(notification: any): boolean {
        const user = this.authService.currentUser();
        if (!user) return false;
        return notification.readBy?.includes(user.uid);
    }

    getNotificationIcon(type: string): string {
        switch (type) {
            case 'transaction_added':
                return 'add_circle';
            case 'transaction_updated':
                return 'edit';
            case 'transaction_deleted':
                return 'delete';
            default:
                return 'notifications';
        }
    }

    getNotificationColor(type: string): string {
        switch (type) {
            case 'transaction_added':
                return 'text-green-500';
            case 'transaction_updated':
                return 'text-accent';
            case 'transaction_deleted':
                return 'text-red-500';
            default:
                return 'text-muted';
        }
    }
}


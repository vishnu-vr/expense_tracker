import { Injectable, effect, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { Tag } from '../models/models';
import { HomeService } from './home.service';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class TagService {
    private firestore = inject(Firestore);
    private homeService = inject(HomeService);
    private authService = inject(AuthService);
    private unsubscribeHomeTags: (() => void) | null = null;

    tags = signal<Tag[]>([]);

    constructor() {
        this.startTagSync();
    }

    private startTagSync() {
        effect(() => {
            const home = this.homeService.currentHome();
            if (this.unsubscribeHomeTags) {
                this.unsubscribeHomeTags();
                this.unsubscribeHomeTags = null;
            }

            if (!home) {
                this.tags.set([]);
                return;
            }

            const homeTagsCollection = FS.collection(this.firestore, 'homes', home.id, 'tags');
            this.unsubscribeHomeTags = FS.onSnapshot(homeTagsCollection, (snapshot) => {
                const firestoreTags = snapshot.docs.map((tagDoc) => ({
                    id: tagDoc.id,
                    ...tagDoc.data()
                } as Tag));

                firestoreTags.sort((a, b) => a.name.localeCompare(b.name));
                this.tags.set(firestoreTags);
            }, (error) => {
                console.error('Error loading tags from Firestore:', error);
                this.tags.set([]);
            });
        }, { allowSignalWrites: true });
    }

    getTagById(tagId: string): Tag | undefined {
        return this.tags().find((tag) => tag.id === tagId);
    }

    getTagsByIds(tagIds?: string[]): Tag[] {
        if (!tagIds?.length) {
            return [];
        }
        const tagMap = new Map(this.tags().map((tag) => [tag.id, tag]));
        return tagIds
            .map((id) => tagMap.get(id))
            .filter((tag): tag is Tag => !!tag);
    }

    async addTag(input: { name: string; color?: string; note?: string }): Promise<Tag> {
        const user = this.authService.currentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        const home = this.homeService.currentHome();
        if (!home) {
            throw new Error('No active home selected');
        }

        const name = input.name.trim();
        if (!name) {
            throw new Error('Tag name is required');
        }

        const duplicate = this.tags().some(
            (tag) => tag.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (duplicate) {
            throw new Error('A tag with this name already exists');
        }

        const tagId = this.generateTagId(name);
        const color = input.color?.trim() || '#3B82F6';
        const note = input.note?.trim() || '';
        const customTagRef = FS.doc(this.firestore, 'homes', home.id, 'tags', tagId);
        await FS.setDoc(customTagRef, {
            name,
            color,
            note,
            homeId: home.id,
            createdBy: user.uid,
            createdAt: new Date()
        });

        return { id: tagId, name, color, note, createdBy: user.uid };
    }

    async updateTag(tagId: string, input: { name: string; color?: string; note?: string }) {
        const home = this.requireHome();
        const name = input.name.trim();
        if (!name) {
            throw new Error('Tag name is required');
        }

        const duplicate = this.tags().some(
            (tag) => tag.id !== tagId && tag.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (duplicate) {
            throw new Error('A tag with this name already exists');
        }

        const customTagRef = FS.doc(this.firestore, 'homes', home.id, 'tags', tagId);
        await FS.updateDoc(customTagRef, {
            name,
            color: input.color?.trim() || '#3B82F6',
            note: input.note?.trim() || ''
        });
    }

    async deleteTag(tagId: string) {
        const home = this.requireHome();
        const customTagRef = FS.doc(this.firestore, 'homes', home.id, 'tags', tagId);
        await FS.deleteDoc(customTagRef);
    }

    private requireHome() {
        const user = this.authService.currentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }
        const home = this.homeService.currentHome();
        if (!home) {
            throw new Error('No active home selected');
        }
        return home;
    }

    private generateTagId(name: string): string {
        const slug = name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return `${slug || 'tag'}_${Date.now()}`;
    }
}

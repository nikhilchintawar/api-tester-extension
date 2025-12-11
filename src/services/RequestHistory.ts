import * as vscode from 'vscode';
import { OpenAPIStorage } from './OpenAPIStorage';

export interface SavedRequest {
    id: string;
    name: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    bodyType: 'none' | 'json' | 'form' | 'text' | 'xml';
    auth?: {
        type: 'none' | 'bearer' | 'basic' | 'apikey';
        token?: string;
        username?: string;
        password?: string;
        key?: string;
        value?: string;
        addTo?: 'header' | 'query';
    };
    response?: {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
        time: number;
        size: number;
    };
    createdAt: number;
    updatedAt: number;
    collectionId?: string;
}

/**
 * RequestHistory - Clean wrapper around OpenAPIStorage
 * All data is stored in OpenAPI 3.0 format
 */
export class RequestHistory {
    private storage: OpenAPIStorage;

    constructor(context: vscode.ExtensionContext, storage: OpenAPIStorage) {
        this.storage = storage;
    }

    // ========================================
    // Request Management - All delegate to OpenAPI Storage
    // ========================================

    async getSavedRequests(): Promise<SavedRequest[]> {
        return this.storage.getRequests();
    }

    async saveRequest(request: Omit<SavedRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedRequest> {
        return this.storage.saveRequest(request);
    }

    async updateRequest(id: string, updates: Partial<SavedRequest>): Promise<SavedRequest | null> {
        const requests = await this.getSavedRequests();
        const existing = requests.find(r => r.id === id);

        if (!existing) return null;

        const updated = { ...existing, ...updates };
        return this.storage.saveRequest(updated);
    }

    async deleteRequest(id: string): Promise<boolean> {
        const requests = await this.getSavedRequests();
        const request = requests.find(r => r.id === id);

        if (!request) return false;

        return this.storage.deleteRequest(request.url, request.method);
    }

    // ========================================
    // Export/Import - OpenAPI Format
    // ========================================

    async exportAsOpenAPI(title?: string): Promise<string> {
        return this.storage.exportJSON();
    }

    async importFromOpenAPI(json: string): Promise<{ imported: number; errors: string[] }> {
        return this.storage.importJSON(json);
    }

    async clear(): Promise<void> {
        return this.storage.clear();
    }
}

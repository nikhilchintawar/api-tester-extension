import * as vscode from 'vscode';

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

export interface RequestCollection {
    id: string;
    name: string;
    description?: string;
    requests: string[]; // Request IDs
    createdAt: number;
    updatedAt: number;
}

export interface RequestHistoryEntry {
    id: string;
    request: Omit<SavedRequest, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
    response?: {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
        time: number;
        size: number;
    };
    timestamp: number;
}

const STORAGE_KEYS = {
    REQUESTS: 'apiTester.savedRequests',
    COLLECTIONS: 'apiTester.collections',
    HISTORY: 'apiTester.history',
};

export class RequestHistory {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Saved Requests
    async getSavedRequests(): Promise<SavedRequest[]> {
        return this.context.globalState.get<SavedRequest[]>(STORAGE_KEYS.REQUESTS, []);
    }

    async saveRequest(request: Omit<SavedRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedRequest> {
        const requests = await this.getSavedRequests();
        const now = Date.now();

        // Check if request with same method and URL already exists
        const existingIndex = requests.findIndex(r =>
            r.method === request.method && r.url === request.url
        );

        if (existingIndex !== -1) {
            // Update existing request
            const existing = requests[existingIndex];
            requests[existingIndex] = {
                ...existing,
                ...request,
                id: existing.id, // Keep the same ID
                createdAt: existing.createdAt, // Keep original creation time
                updatedAt: now,
            };
            await this.context.globalState.update(STORAGE_KEYS.REQUESTS, requests);
            return requests[existingIndex];
        } else {
            // Create new request
            const newRequest: SavedRequest = {
                ...request,
                id: this.generateId(),
                createdAt: now,
                updatedAt: now,
            };

            requests.push(newRequest);
            await this.context.globalState.update(STORAGE_KEYS.REQUESTS, requests);

            return newRequest;
        }
    }

    async updateRequest(id: string, updates: Partial<SavedRequest>): Promise<SavedRequest | null> {
        const requests = await this.getSavedRequests();
        const index = requests.findIndex(r => r.id === id);
        
        if (index === -1) return null;

        requests[index] = {
            ...requests[index],
            ...updates,
            updatedAt: Date.now(),
        };

        await this.context.globalState.update(STORAGE_KEYS.REQUESTS, requests);
        return requests[index];
    }

    async deleteRequest(id: string): Promise<boolean> {
        const requests = await this.getSavedRequests();
        const filtered = requests.filter(r => r.id !== id);
        
        if (filtered.length === requests.length) return false;

        await this.context.globalState.update(STORAGE_KEYS.REQUESTS, filtered);
        return true;
    }

    // Collections
    async getCollections(): Promise<RequestCollection[]> {
        return this.context.globalState.get<RequestCollection[]>(STORAGE_KEYS.COLLECTIONS, []);
    }

    async createCollection(name: string, description?: string): Promise<RequestCollection> {
        const collections = await this.getCollections();
        const now = Date.now();
        
        const newCollection: RequestCollection = {
            id: this.generateId(),
            name,
            description,
            requests: [],
            createdAt: now,
            updatedAt: now,
        };

        collections.push(newCollection);
        await this.context.globalState.update(STORAGE_KEYS.COLLECTIONS, collections);
        
        return newCollection;
    }

    async addToCollection(collectionId: string, requestId: string): Promise<boolean> {
        const collections = await this.getCollections();
        const collection = collections.find(c => c.id === collectionId);
        
        if (!collection) return false;
        
        if (!collection.requests.includes(requestId)) {
            collection.requests.push(requestId);
            collection.updatedAt = Date.now();
            await this.context.globalState.update(STORAGE_KEYS.COLLECTIONS, collections);
        }
        
        return true;
    }

    async removeFromCollection(collectionId: string, requestId: string): Promise<boolean> {
        const collections = await this.getCollections();
        const collection = collections.find(c => c.id === collectionId);
        
        if (!collection) return false;
        
        collection.requests = collection.requests.filter(id => id !== requestId);
        collection.updatedAt = Date.now();
        await this.context.globalState.update(STORAGE_KEYS.COLLECTIONS, collections);
        
        return true;
    }

    async deleteCollection(id: string): Promise<boolean> {
        const collections = await this.getCollections();
        const filtered = collections.filter(c => c.id !== id);
        
        if (filtered.length === collections.length) return false;

        await this.context.globalState.update(STORAGE_KEYS.COLLECTIONS, filtered);
        return true;
    }

    // History
    async getHistory(limit: number = 50): Promise<RequestHistoryEntry[]> {
        const history = this.context.globalState.get<RequestHistoryEntry[]>(STORAGE_KEYS.HISTORY, []);
        return history.slice(0, limit);
    }

    async addToHistory(entry: Omit<RequestHistoryEntry, 'id' | 'timestamp'>): Promise<RequestHistoryEntry> {
        const history = await this.getHistory(100);
        
        const newEntry: RequestHistoryEntry = {
            ...entry,
            id: this.generateId(),
            timestamp: Date.now(),
        };

        // Add to beginning (most recent first)
        history.unshift(newEntry);

        // Keep only last 100 entries
        const trimmed = history.slice(0, 100);
        await this.context.globalState.update(STORAGE_KEYS.HISTORY, trimmed);
        
        return newEntry;
    }

    async clearHistory(): Promise<void> {
        await this.context.globalState.update(STORAGE_KEYS.HISTORY, []);
    }

    async deleteHistoryEntry(id: string): Promise<boolean> {
        const history = await this.getHistory(100);
        const filtered = history.filter(h => h.id !== id);
        
        if (filtered.length === history.length) return false;

        await this.context.globalState.update(STORAGE_KEYS.HISTORY, filtered);
        return true;
    }

    // Export/Import
    async exportData(): Promise<string> {
        const data = {
            requests: await this.getSavedRequests(),
            collections: await this.getCollections(),
            history: await this.getHistory(100),
            exportedAt: new Date().toISOString(),
            version: '1.0.0',
        };

        return JSON.stringify(data, null, 2);
    }

    async importData(jsonData: string): Promise<{ imported: number; errors: string[] }> {
        const errors: string[] = [];
        let imported = 0;

        try {
            const data = JSON.parse(jsonData);

            if (data.requests && Array.isArray(data.requests)) {
                const existing = await this.getSavedRequests();
                const existingIds = new Set(existing.map(r => r.id));
                
                for (const request of data.requests) {
                    if (!existingIds.has(request.id)) {
                        existing.push(request);
                        imported++;
                    }
                }
                
                await this.context.globalState.update(STORAGE_KEYS.REQUESTS, existing);
            }

            if (data.collections && Array.isArray(data.collections)) {
                const existing = await this.getCollections();
                const existingIds = new Set(existing.map(c => c.id));
                
                for (const collection of data.collections) {
                    if (!existingIds.has(collection.id)) {
                        existing.push(collection);
                        imported++;
                    }
                }
                
                await this.context.globalState.update(STORAGE_KEYS.COLLECTIONS, existing);
            }
        } catch (error) {
            errors.push(`Failed to parse import data: ${error}`);
        }

        return { imported, errors };
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

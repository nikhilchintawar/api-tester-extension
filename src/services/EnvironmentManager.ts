import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Environment {
    id: string;
    name: string;
    variables: Record<string, string>;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'apiTester.environments';

export class EnvironmentManager {
    private context: vscode.ExtensionContext;
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.setupFileWatcher();
        this.loadFromEnvFiles();
    }

    private setupFileWatcher(): void {
        // Watch for .env file changes
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.env*');
        
        this.fileWatcher.onDidChange(() => this.loadFromEnvFiles());
        this.fileWatcher.onDidCreate(() => this.loadFromEnvFiles());
        this.fileWatcher.onDidDelete(() => this.loadFromEnvFiles());
    }

    private async loadFromEnvFiles(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        for (const folder of workspaceFolders) {
            // Look for .env files
            const envFiles = [
                '.env',
                '.env.local',
                '.env.development',
                '.env.staging',
                '.env.production',
                '.env.test',
            ];

            for (const envFile of envFiles) {
                const envPath = path.join(folder.uri.fsPath, envFile);
                
                if (fs.existsSync(envPath)) {
                    try {
                        const content = fs.readFileSync(envPath, 'utf-8');
                        const variables = this.parseEnvFile(content);
                        
                        // Create or update environment from file
                        const envName = this.getEnvNameFromFile(envFile);
                        await this.createOrUpdateFromFile(envName, variables, envFile);
                    } catch (error) {
                        console.error(`Error reading ${envFile}:`, error);
                    }
                }
            }
        }
    }

    private parseEnvFile(content: string): Record<string, string> {
        const variables: Record<string, string> = {};
        const lines = content.split('\n');

        for (const line of lines) {
            // Skip comments and empty lines
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Parse KEY=VALUE
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();

                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                variables[key] = value;
            }
        }

        return variables;
    }

    private getEnvNameFromFile(filename: string): string {
        const mapping: Record<string, string> = {
            '.env': 'Default',
            '.env.local': 'Local',
            '.env.development': 'Development',
            '.env.staging': 'Staging',
            '.env.production': 'Production',
            '.env.test': 'Test',
        };

        return mapping[filename] || filename.replace('.env.', '').replace('.env', 'Default');
    }

    private async createOrUpdateFromFile(
        name: string, 
        variables: Record<string, string>,
        sourceFile: string
    ): Promise<void> {
        const environments = await this.getEnvironments();
        const existing = environments.find(e => e.name === `[File] ${name}`);

        if (existing) {
            existing.variables = variables;
            existing.updatedAt = Date.now();
        } else {
            environments.push({
                id: `file-${sourceFile}-${Date.now()}`,
                name: `[File] ${name}`,
                variables,
                isActive: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        await this.context.globalState.update(STORAGE_KEY, environments);
    }

    async getEnvironments(): Promise<Environment[]> {
        return this.context.globalState.get<Environment[]>(STORAGE_KEY, []);
    }

    async getActiveEnvironment(): Promise<Environment | null> {
        const environments = await this.getEnvironments();
        return environments.find(e => e.isActive) || null;
    }

    async createEnvironment(name: string, variables: Record<string, string> = {}): Promise<Environment> {
        const environments = await this.getEnvironments();
        const now = Date.now();

        const newEnv: Environment = {
            id: this.generateId(),
            name,
            variables,
            isActive: environments.length === 0, // First env is active by default
            createdAt: now,
            updatedAt: now,
        };

        environments.push(newEnv);
        await this.context.globalState.update(STORAGE_KEY, environments);

        return newEnv;
    }

    async updateEnvironment(id: string, updates: Partial<Environment>): Promise<Environment | null> {
        const environments = await this.getEnvironments();
        const index = environments.findIndex(e => e.id === id);

        if (index === -1) return null;

        environments[index] = {
            ...environments[index],
            ...updates,
            updatedAt: Date.now(),
        };

        await this.context.globalState.update(STORAGE_KEY, environments);
        return environments[index];
    }

    async setActiveEnvironment(id: string): Promise<boolean> {
        const environments = await this.getEnvironments();
        
        let found = false;
        for (const env of environments) {
            if (env.id === id) {
                env.isActive = true;
                found = true;
            } else {
                env.isActive = false;
            }
        }

        if (found) {
            await this.context.globalState.update(STORAGE_KEY, environments);
        }

        return found;
    }

    async deleteEnvironment(id: string): Promise<boolean> {
        const environments = await this.getEnvironments();
        const filtered = environments.filter(e => e.id !== id);

        if (filtered.length === environments.length) return false;

        // If we deleted the active environment, activate the first one
        if (!filtered.some(e => e.isActive) && filtered.length > 0) {
            filtered[0].isActive = true;
        }

        await this.context.globalState.update(STORAGE_KEY, filtered);
        return true;
    }

    async setVariable(envId: string, key: string, value: string): Promise<boolean> {
        const environments = await this.getEnvironments();
        const env = environments.find(e => e.id === envId);

        if (!env) return false;

        env.variables[key] = value;
        env.updatedAt = Date.now();

        await this.context.globalState.update(STORAGE_KEY, environments);
        return true;
    }

    async deleteVariable(envId: string, key: string): Promise<boolean> {
        const environments = await this.getEnvironments();
        const env = environments.find(e => e.id === envId);

        if (!env || !(key in env.variables)) return false;

        delete env.variables[key];
        env.updatedAt = Date.now();

        await this.context.globalState.update(STORAGE_KEY, environments);
        return true;
    }

    // Replace variables in a string
    interpolate(text: string, additionalVars: Record<string, string> = {}): string {
        // Get active environment variables
        const environments = this.context.globalState.get<Environment[]>(STORAGE_KEY, []);
        const activeEnv = environments.find(e => e.isActive);
        
        const variables = {
            ...(activeEnv?.variables || {}),
            ...additionalVars,
        };

        // Replace {{variable}} and ${variable} patterns
        return text.replace(/\{\{([^}]+)\}\}|\$\{([^}]+)\}/g, (match, var1, var2) => {
            const varName = (var1 || var2).trim();
            return variables[varName] ?? match;
        });
    }

    // Get all variables (merged from active environment)
    async getAllVariables(): Promise<Record<string, string>> {
        const activeEnv = await this.getActiveEnvironment();
        return activeEnv?.variables || {};
    }

    // Export environment
    async exportEnvironment(id: string): Promise<string | null> {
        const environments = await this.getEnvironments();
        const env = environments.find(e => e.id === id);

        if (!env) return null;

        return JSON.stringify(env, null, 2);
    }

    // Import environment
    async importEnvironment(jsonData: string): Promise<Environment | null> {
        try {
            const data = JSON.parse(jsonData);
            
            if (!data.name || !data.variables) {
                throw new Error('Invalid environment format');
            }

            return await this.createEnvironment(data.name, data.variables);
        } catch (error) {
            console.error('Failed to import environment:', error);
            return null;
        }
    }

    private generateId(): string {
        return `env-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    dispose(): void {
        this.fileWatcher?.dispose();
    }
}

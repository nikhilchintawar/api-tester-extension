import * as vscode from 'vscode';
import { EndpointDiscovery } from '../services/EndpointDiscovery';
import { RequestHistory } from '../services/RequestHistory';
import { EnvironmentManager } from '../services/EnvironmentManager';

interface Services {
    endpointDiscovery: EndpointDiscovery;
    requestHistory: RequestHistory;
    environmentManager: EnvironmentManager;
}

export class ApiTesterPanel {
    public static currentPanel: ApiTesterPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _services: Services;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, services: Services) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._services = services;

        this._update();
        this._panel.webview.onDidReceiveMessage(
            async (message) => { await this._handleMessage(message); },
            null,
            this._disposables
        );
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, services: Services): void {
        const column = vscode.ViewColumn.Beside;
        if (ApiTesterPanel.currentPanel) {
            ApiTesterPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel('apiTester', 'API Tester', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extensionUri],
        });
        ApiTesterPanel.currentPanel = new ApiTesterPanel(panel, extensionUri, services);
    }

    public postMessage(message: unknown): void {
        this._panel.webview.postMessage(message);
    }

    private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
        console.log('[API Tester] Received message from webview:', message.type);
        switch (message.type) {
            case 'sendRequest':
                await this._sendRequest(message);
                break;
            case 'discoverEndpoints':
                await this._discoverEndpoints();
                break;
            case 'saveRequest':
                console.log('[API Tester] Processing saveRequest');
                await this._saveRequest(message);
                break;
            case 'getSavedRequests':
                console.log('[API Tester] Processing getSavedRequests');
                await this._getSavedRequests();
                break;
            case 'deleteRequest':
                await this._deleteRequest(message.id as string);
                break;
            case 'getEnvironments':
                await this._getEnvironments();
                break;
            case 'setActiveEnvironment':
                await this._setActiveEnvironment(message.id as string);
                break;
            case 'createEnvironment':
                await this._createEnvironment(message.name as string, message.variables as Record<string, string>);
                break;
            case 'openFile':
                await this._openFile(message.file as string, message.line as number);
                break;
            case 'exportOpenAPI':
                await this._exportOpenAPI();
                break;
            case 'importOpenAPI':
                await this._importOpenAPI(message.json as string);
                break;
        }
    }

    private async _sendRequest(message: { [key: string]: unknown }): Promise<void> {
        const { method, url, headers, body, auth } = message as {
            method: string; url: string; headers: Record<string, string>;
            body?: string; auth?: { type: string; token?: string; username?: string; password?: string; key?: string; value?: string; addTo?: string; };
        };

        const interpolatedUrl = this._services.environmentManager.interpolate(url);
        const interpolatedBody = body ? this._services.environmentManager.interpolate(body) : undefined;
        const interpolatedHeaders: Record<string, string> = {};
        
        for (const [key, value] of Object.entries(headers)) {
            interpolatedHeaders[this._services.environmentManager.interpolate(key)] = this._services.environmentManager.interpolate(value);
        }

        if (auth) {
            switch (auth.type) {
                case 'bearer':
                    if (auth.token) interpolatedHeaders['Authorization'] = `Bearer ${this._services.environmentManager.interpolate(auth.token)}`;
                    break;
                case 'basic':
                    if (auth.username && auth.password) {
                        const credentials = Buffer.from(`${this._services.environmentManager.interpolate(auth.username)}:${this._services.environmentManager.interpolate(auth.password)}`).toString('base64');
                        interpolatedHeaders['Authorization'] = `Basic ${credentials}`;
                    }
                    break;
                case 'apikey':
                    if (auth.key && auth.value) {
                        interpolatedHeaders[this._services.environmentManager.interpolate(auth.key)] = this._services.environmentManager.interpolate(auth.value);
                    }
                    break;
            }
        }

        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            const fetchOptions: RequestInit = { method, headers: interpolatedHeaders, signal: controller.signal };
            if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) fetchOptions.body = interpolatedBody;

            const response = await fetch(interpolatedUrl, fetchOptions);
            clearTimeout(timeout);

            const responseTime = Date.now() - startTime;
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });

            let responseBody: string;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const json = await response.json();
                responseBody = JSON.stringify(json, null, 2);
            } else {
                responseBody = await response.text();
            }

            const responseSize = new TextEncoder().encode(responseBody).length;

            this.postMessage({ type: 'response', status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseBody, time: responseTime, size: responseSize });
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Request failed', time: responseTime });
        }
    }

    private async _discoverEndpoints(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this.postMessage({ type: 'endpointsDiscovered', endpoints: [], error: 'No workspace folder open' });
            return;
        }
        try {
            const endpoints = await this._services.endpointDiscovery.discoverEndpoints(workspaceFolders[0].uri.fsPath);
            this.postMessage({ type: 'endpointsDiscovered', endpoints });
        } catch (error) {
            this.postMessage({ type: 'endpointsDiscovered', endpoints: [], error: error instanceof Error ? error.message : 'Discovery failed' });
        }
    }

    private async _saveRequest(message: { [key: string]: unknown }): Promise<void> {
        console.log('[API Tester] ===== SAVE REQUEST START =====');
        console.log('[API Tester] Full message:', JSON.stringify(message, null, 2));
        console.log('[API Tester] Response field exists?', 'response' in message);
        console.log('[API Tester] Response value:', message.response);
        console.log('[API Tester] Response type:', typeof message.response);

        const requestToSave = {
            name: message.name as string,
            method: message.method as string,
            url: message.url as string,
            headers: message.headers as Record<string, string>,
            body: message.body as string | undefined,
            bodyType: (message.bodyType as 'none' | 'json' | 'form' | 'text' | 'xml') || 'json',
            auth: message.auth as any,
            response: message.response as any,
        };

        console.log('[API Tester] About to save with response:', requestToSave.response);

        const request = await this._services.requestHistory.saveRequest(requestToSave);

        console.log('[API Tester] Request saved successfully!');
        console.log('[API Tester] Saved request response field:', request.response);
        console.log('[API Tester] Saved request has response?', !!request.response);
        console.log('[API Tester] ===== SAVE REQUEST END =====');

        this.postMessage({ type: 'requestSaved', request });
    }

    private async _getSavedRequests(): Promise<void> {
        const requests = await this._services.requestHistory.getSavedRequests();
        console.log('[API Tester] Sending saved requests to webview:', requests.length, 'requests');
        this.postMessage({ type: 'savedRequests', requests });
    }

    private async _deleteRequest(id: string): Promise<void> {
        await this._services.requestHistory.deleteRequest(id);
        await this._getSavedRequests();
    }

    private async _getEnvironments(): Promise<void> {
        const environments = await this._services.environmentManager.getEnvironments();
        this.postMessage({ type: 'environments', environments });
    }

    private async _setActiveEnvironment(id: string): Promise<void> {
        await this._services.environmentManager.setActiveEnvironment(id);
        await this._getEnvironments();
    }

    private async _createEnvironment(name: string, variables: Record<string, string>): Promise<void> {
        await this._services.environmentManager.createEnvironment(name, variables);
        await this._getEnvironments();
    }

    private async _openFile(file: string, line: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open file: ${file}`);
        }
    }

    private async _exportOpenAPI(): Promise<void> {
        try {
            console.log('[API Tester] Starting OpenAPI export...');
            const openapi = await this._services.requestHistory.exportAsOpenAPI('My API Collection');
            console.log('[API Tester] Got OpenAPI JSON, length:', openapi.length);

            // Save to file
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('openapi.json'),
                filters: { 'OpenAPI': ['json'] }
            });

            console.log('[API Tester] Save dialog result:', uri?.fsPath || 'cancelled');

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(openapi, 'utf8'));
                vscode.window.showInformationMessage(`OpenAPI exported to ${uri.fsPath}`);
                console.log('[API Tester] Export successful!');
            } else {
                console.log('[API Tester] Export cancelled by user');
            }
        } catch (error) {
            console.error('[API Tester] Export error:', error);
            vscode.window.showErrorMessage(`Failed to export OpenAPI: ${error}`);
        }
    }

    private async _importOpenAPI(json: string): Promise<void> {
        try {
            const result = await this._services.requestHistory.importFromOpenAPI(json);

            if (result.errors.length > 0) {
                vscode.window.showWarningMessage(`Imported ${result.imported} requests with ${result.errors.length} errors`);
            } else {
                vscode.window.showInformationMessage(`Successfully imported ${result.imported} requests`);
            }

            // Refresh saved requests
            await this._getSavedRequests();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to import OpenAPI: ${error}`);
        }
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    public dispose(): void {
        ApiTesterPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Tester</title>
    <style>
        :root {
            --bg-primary: #0a0a0f;
            --bg-secondary: #12121a;
            --bg-tertiary: #1a1a24;
            --bg-hover: #252530;
            --border-color: #2a2a3a;
            --text-primary: #e8e8f0;
            --text-secondary: #9090a0;
            --text-muted: #606070;
            --accent-green: #00d97e;
            --accent-blue: #5b8def;
            --accent-orange: #f0a030;
            --accent-red: #ff5757;
            --accent-purple: #a78bfa;
            --accent-cyan: #22d3ee;
            --method-get: #00d97e;
            --method-post: #5b8def;
            --method-put: #f0a030;
            --method-patch: #a78bfa;
            --method-delete: #ff5757;
            --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
            --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: var(--font-sans); background: var(--bg-primary); color: var(--text-primary); line-height: 1.5; overflow: hidden; }
        #app { display: flex; height: 100vh; overflow: hidden; }
        
        .sidebar { width: 300px; background: var(--bg-secondary); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; }
        .sidebar-header { padding: 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 12px; background: linear-gradient(135deg, rgba(91,141,239,0.1), rgba(167,139,250,0.1)); }
        .sidebar-header h1 { font-size: 16px; font-weight: 700; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .logo { width: 28px; height: 28px; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .logo svg { width: 16px; height: 16px; stroke: white; fill: none; stroke-width: 2.5; }
        
        .sidebar-tabs { display: flex; padding: 8px; gap: 4px; background: var(--bg-tertiary); }
        .sidebar-tab { flex: 1; padding: 10px; font-size: 12px; font-weight: 600; color: var(--text-muted); background: none; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        .sidebar-tab:hover { color: var(--text-secondary); background: var(--bg-hover); }
        .sidebar-tab.active { color: var(--text-primary); background: var(--bg-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        
        .sidebar-content { flex: 1; overflow-y: auto; padding: 12px; }
        .sidebar-section { margin-bottom: 20px; }
        .sidebar-section-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }
        
        .request-item { display: flex; align-items: center; padding: 10px 12px; border-radius: 10px; cursor: pointer; transition: all 0.15s; gap: 10px; margin-bottom: 4px; border: 1px solid transparent; }
        .request-item:hover { background: var(--bg-hover); border-color: var(--border-color); }
        
        .method-badge { font-size: 9px; font-weight: 800; font-family: var(--font-mono); padding: 4px 8px; border-radius: 6px; min-width: 52px; text-align: center; letter-spacing: 0.5px; }
        .method-badge.get { background: rgba(0,217,126,0.15); color: var(--method-get); }
        .method-badge.post { background: rgba(91,141,239,0.15); color: var(--method-post); }
        .method-badge.put { background: rgba(240,160,48,0.15); color: var(--method-put); }
        .method-badge.patch { background: rgba(167,139,250,0.15); color: var(--method-patch); }
        .method-badge.delete { background: rgba(255,87,87,0.15); color: var(--method-delete); }
        
        .request-path { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        
        .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        
        .request-builder { padding: 20px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
        .url-bar { display: flex; gap: 10px; margin-bottom: 16px; }
        
        .method-select { min-width: 110px; padding: 12px 16px; font-size: 13px; font-weight: 700; font-family: var(--font-mono); background: var(--bg-tertiary); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); cursor: pointer; transition: all 0.2s; }
        .method-select:hover, .method-select:focus { border-color: var(--accent-blue); outline: none; }
        
        .url-input { flex: 1; padding: 12px 16px; font-size: 13px; font-family: var(--font-mono); background: var(--bg-primary); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); transition: all 0.2s; }
        .url-input:hover, .url-input:focus { border-color: var(--accent-blue); outline: none; }
        .url-input::placeholder { color: var(--text-muted); }
        
        .send-btn { padding: 12px 28px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px; }
        .send-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(91,141,239,0.4); }
        .send-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        
        .action-btn { padding: 10px 16px; font-size: 12px; font-weight: 600; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 10px; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
        .action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        
        .tabs { display: flex; gap: 4px; background: var(--bg-tertiary); padding: 4px; border-radius: 10px; width: fit-content; }
        .tab { padding: 8px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); background: none; border: none; border-radius: 8px; cursor: pointer; transition: all 0.15s; }
        .tab:hover { color: var(--text-secondary); }
        .tab.active { background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
        
        .tab-content { padding: 16px 0; }
        .tab-panel { display: none; }
        .tab-panel.active { display: block; }
        
        .key-value-editor { display: flex; flex-direction: column; gap: 8px; }
        .key-value-row { display: flex; gap: 8px; align-items: center; }
        .key-value-row input { flex: 1; padding: 10px 14px; font-size: 12px; font-family: var(--font-mono); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); }
        .key-value-row input:focus { border-color: var(--accent-blue); outline: none; }
        
        .remove-btn { padding: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; border-radius: 6px; transition: all 0.15s; }
        .remove-btn:hover { background: rgba(255,87,87,0.15); color: var(--accent-red); }
        
        .add-row-btn { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--accent-blue); background: none; border: 2px dashed var(--border-color); border-radius: 8px; cursor: pointer; transition: all 0.15s; width: fit-content; }
        .add-row-btn:hover { background: rgba(91,141,239,0.1); border-color: var(--accent-blue); }
        
        .body-editor { width: 100%; min-height: 160px; padding: 14px; font-size: 12px; font-family: var(--font-mono); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 10px; color: var(--text-primary); resize: vertical; line-height: 1.6; }
        .body-editor:focus { border-color: var(--accent-blue); outline: none; }
        
        .response-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-primary); }
        .response-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
        .response-status { display: flex; align-items: center; gap: 16px; }
        
        .status-badge { padding: 6px 14px; font-size: 13px; font-weight: 700; font-family: var(--font-mono); border-radius: 8px; }
        .status-badge.success { background: rgba(0,217,126,0.15); color: var(--accent-green); }
        .status-badge.redirect { background: rgba(240,160,48,0.15); color: var(--accent-orange); }
        .status-badge.client-error { background: rgba(255,87,87,0.15); color: var(--accent-red); }
        .status-badge.server-error { background: rgba(255,87,87,0.25); color: var(--accent-red); }
        
        .response-meta { display: flex; gap: 20px; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
        .response-body { flex: 1; overflow: auto; padding: 20px; }
        .response-body pre { font-family: var(--font-mono); font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
        
        .json-key { color: var(--accent-cyan); }
        .json-string { color: var(--accent-green); }
        .json-number { color: var(--accent-orange); }
        .json-boolean { color: var(--accent-purple); }
        .json-null { color: var(--accent-red); }
        
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; text-align: center; color: var(--text-secondary); }
        .empty-state-icon { width: 64px; height: 64px; margin-bottom: 20px; opacity: 0.4; }
        .empty-state h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
        .empty-state p { font-size: 14px; max-width: 300px; color: var(--text-muted); }
        
        .discover-btn { padding: 14px 24px; font-size: 13px; font-weight: 700; background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue)); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all 0.2s; margin-top: 20px; }
        .discover-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(167,139,250,0.4); }
        
        .spinner { width: 18px; height: 18px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: var(--bg-primary); }
        ::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--bg-hover); }
        
        .auth-fields { display: flex; flex-direction: column; gap: 14px; }
        .auth-field { display: flex; flex-direction: column; gap: 6px; }
        .auth-field label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .auth-field input, .auth-field select { padding: 10px 14px; font-size: 12px; font-family: var(--font-mono); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); }
        .auth-field input:focus { border-color: var(--accent-blue); outline: none; }
    </style>
</head>
<body>
    <div id="app"></div>
    <script>
        const vscode = acquireVsCodeApi();
        
        let state = {
            method: 'GET', url: '', headers: [{ key: '', value: '' }], queryParams: [{ key: '', value: '' }], body: '', bodyType: 'json',
            auth: { type: 'none' }, activeTab: 'params', responseTab: 'body', sidebarTab: 'discovered',
            response: null, loading: false, discoveredEndpoints: [], savedRequests: [], environments: []
        };

        const icons = {
            send: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
            plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
            trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
            folder: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
            clock: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
            search: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
            zap: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            rocket: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>'
        };

        function render() {
            document.getElementById('app').innerHTML = \`
                <div class="sidebar">
                    <div class="sidebar-header">
                        <div class="logo">\${icons.zap}</div>
                        <h1>API Tester</h1>
                    </div>
                    <div class="sidebar-tabs">
                        <button class="sidebar-tab \${state.sidebarTab === 'discovered' ? 'active' : ''}" onclick="setSidebarTab('discovered')">Discovered</button>
                        <button class="sidebar-tab \${state.sidebarTab === 'saved' ? 'active' : ''}" onclick="setSidebarTab('saved')">Saved</button>
                    </div>
                    <div class="sidebar-content">\${renderSidebarContent()}</div>
                </div>
                <div class="main-content">
                    <div class="request-builder">
                        <div class="url-bar">
                            <select class="method-select" onchange="setMethod(this.value)">
                                \${['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m => \`<option value="\${m}" \${state.method === m ? 'selected' : ''}>\${m}</option>\`).join('')}
                            </select>
                            <input type="text" class="url-input" placeholder="Enter URL or use {{variable}}" value="\${escapeHtml(state.url)}" oninput="setUrl(this.value)" onkeydown="if(event.key==='Enter')sendRequest()"/>
                            <button class="send-btn" onclick="sendRequest()" \${state.loading ? 'disabled' : ''}>\${state.loading ? '<div class="spinner"></div>' : icons.send} Send</button>
                            <button class="action-btn" onclick="newRequest()">New</button>
                            <button class="action-btn" onclick="saveCurrentRequest()">Save</button>
                        </div>
                        <div class="tabs">
                            \${['params','headers','body','auth'].map(t => \`<button class="tab \${state.activeTab === t ? 'active' : ''}" onclick="setActiveTab('\${t}')">\${t.charAt(0).toUpperCase()+t.slice(1)}</button>\`).join('')}
                        </div>
                        <div class="tab-content">\${renderTabContent()}</div>
                    </div>
                    <div class="response-panel">\${renderResponse()}</div>
                </div>
            \`;
        }

        function renderSidebarContent() {
            if (state.sidebarTab === 'discovered') {
                if (state.discoveredEndpoints.length === 0) {
                    return \`<div class="empty-state"><div class="empty-state-icon">\${icons.search}</div><h3>No Endpoints Found</h3><p>Scan your workspace to discover API endpoints from your code.</p><button class="discover-btn" onclick="discoverEndpoints()">\${icons.zap} Discover Endpoints</button></div>\`;
                }
                const grouped = {};
                state.discoveredEndpoints.forEach(ep => { if (!grouped[ep.framework]) grouped[ep.framework] = []; grouped[ep.framework].push(ep); });
                return Object.entries(grouped).map(([fw, eps]) => \`<div class="sidebar-section"><div class="sidebar-section-header">\${fw} <span>\${eps.length}</span></div>\${eps.map(ep => \`<div class="request-item" onclick='loadEndpoint(\${JSON.stringify(ep)})'><span class="method-badge \${ep.method.toLowerCase()}">\${ep.method}</span><span class="request-path">\${ep.path}</span></div>\`).join('')}</div>\`).join('');
            }
            if (state.sidebarTab === 'saved') {
                const openAPIButtons = \`
                    <div style="display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-color)">
                        <button class="action-btn" onclick="exportOpenAPI()" style="flex:1;font-size:11px">Export OpenAPI</button>
                        <button class="action-btn" onclick="importOpenAPI()" style="flex:1;font-size:11px">Import OpenAPI</button>
                    </div>
                \`;
                if (state.savedRequests.length === 0) {
                    return openAPIButtons + \`<div class="empty-state"><div class="empty-state-icon">\${icons.folder}</div><h3>No Saved Requests</h3><p>Save requests or import OpenAPI spec.</p></div>\`;
                }
                return openAPIButtons + state.savedRequests.map(req => \`<div class="request-item" onclick="loadSavedRequest('\${req.id}')"><span class="method-badge \${req.method.toLowerCase()}">\${req.method}</span><span class="request-path">\${req.name || req.url}</span><button class="remove-btn" onclick="event.stopPropagation();deleteRequest('\${req.id}')">\${icons.trash}</button></div>\`).join('');
            }
            return '';
        }

        function renderTabContent() {
            if (state.activeTab === 'params') return renderKeyValueEditor('params', state.queryParams);
            if (state.activeTab === 'headers') return renderKeyValueEditor('headers', state.headers);
            if (state.activeTab === 'body') {
                return \`<div style="margin-bottom:12px"><div class="tabs">\${['none','json','form','text','xml'].map(t => \`<button class="tab \${state.bodyType === t ? 'active' : ''}" onclick="setBodyType('\${t}')">\${t.charAt(0).toUpperCase()+t.slice(1)}</button>\`).join('')}</div></div>\${state.bodyType !== 'none' ? \`<textarea class="body-editor" placeholder="\${getBodyPlaceholder()}" oninput="setBody(this.value)">\${escapeHtml(state.body)}</textarea>\` : '<p style="color:var(--text-muted);font-size:12px">No body</p>'}\`;
            }
            if (state.activeTab === 'auth') {
                return \`<div style="margin-bottom:16px"><div class="tabs">\${['none','bearer','basic','apikey'].map(t => \`<button class="tab \${state.auth.type === t ? 'active' : ''}" onclick="setAuthType('\${t}')">\${t.charAt(0).toUpperCase()+t.slice(1)}</button>\`).join('')}</div></div>\${renderAuthFields()}\`;
            }
            return '';
        }

        function renderAuthFields() {
            if (state.auth.type === 'bearer') return \`<div class="auth-fields"><div class="auth-field"><label>Token</label><input type="text" placeholder="Bearer token or {{variable}}" value="\${escapeHtml(state.auth.token||'')}" oninput="setAuthField('token',this.value)"/></div></div>\`;
            if (state.auth.type === 'basic') return \`<div class="auth-fields"><div class="auth-field"><label>Username</label><input type="text" placeholder="Username" value="\${escapeHtml(state.auth.username||'')}" oninput="setAuthField('username',this.value)"/></div><div class="auth-field"><label>Password</label><input type="password" placeholder="Password" value="\${escapeHtml(state.auth.password||'')}" oninput="setAuthField('password',this.value)"/></div></div>\`;
            if (state.auth.type === 'apikey') return \`<div class="auth-fields"><div class="auth-field"><label>Key Name</label><input type="text" placeholder="X-API-Key" value="\${escapeHtml(state.auth.key||'')}" oninput="setAuthField('key',this.value)"/></div><div class="auth-field"><label>Value</label><input type="text" placeholder="API key value" value="\${escapeHtml(state.auth.value||'')}" oninput="setAuthField('value',this.value)"/></div></div>\`;
            return '<p style="color:var(--text-muted);font-size:12px">No authentication</p>';
        }

        function renderKeyValueEditor(type, items) {
            return \`<div class="key-value-editor">\${items.map((item,i) => \`<div class="key-value-row"><input type="text" placeholder="Key" value="\${escapeHtml(item.key)}" oninput="updateKeyValue('\${type}',\${i},'key',this.value)"/><input type="text" placeholder="Value" value="\${escapeHtml(item.value)}" oninput="updateKeyValue('\${type}',\${i},'value',this.value)"/><button class="remove-btn" onclick="removeKeyValue('\${type}',\${i})">\${icons.trash}</button></div>\`).join('')}<button class="add-row-btn" onclick="addKeyValue('\${type}')">\${icons.plus} Add</button></div>\`;
        }

        function renderResponse() {
            if (!state.response && !state.loading) return \`<div class="empty-state"><div class="empty-state-icon">\${icons.rocket}</div><h3>Ready to Send</h3><p>Enter a URL and click Send.</p></div>\`;
            if (state.loading) return \`<div class="empty-state"><div class="spinner" style="width:40px;height:40px;border-width:3px"></div><h3 style="margin-top:20px">Sending...</h3></div>\`;
            if (state.response.error) return \`<div class="response-header"><div class="response-status"><span class="status-badge client-error">Error</span></div><div class="response-meta">\${state.response.time}ms</div></div><div class="response-body"><pre style="color:var(--accent-red)">\${escapeHtml(state.response.error)}</pre></div>\`;
            return \`<div class="response-header"><div class="response-status"><span class="status-badge \${getStatusClass(state.response.status)}">\${state.response.status} \${state.response.statusText}</span></div><div class="response-meta"><span>\${state.response.time}ms</span><span>\${formatSize(state.response.size)}</span></div></div><div style="padding:8px 20px;border-bottom:1px solid var(--border-color)"><div class="tabs"><button class="tab \${state.responseTab==='body'?'active':''}" onclick="setResponseTab('body')">Body</button><button class="tab \${state.responseTab==='headers'?'active':''}" onclick="setResponseTab('headers')">Headers</button></div></div><div class="response-body"><pre>\${state.responseTab==='body'?highlightJson(state.response.body):Object.entries(state.response.headers||{}).map(([k,v])=>\`<span class="json-key">\${escapeHtml(k)}</span>: \${escapeHtml(v)}\`).join('\\n')}</pre></div>\`;
        }

        function escapeHtml(str) { if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        function highlightJson(str) { if(!str)return'';try{return syntaxHighlight(JSON.stringify(JSON.parse(str),null,2));}catch{return escapeHtml(str);} }
        function syntaxHighlight(json) { return escapeHtml(json).replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g,m=>{let c='json-number';if(/^"/.test(m)){c=/:$/.test(m)?'json-key':'json-string';}else if(/true|false/.test(m))c='json-boolean';else if(/null/.test(m))c='json-null';return'<span class="'+c+'">'+m+'</span>';}); }
        function getStatusClass(s) { if(s>=200&&s<300)return'success';if(s>=300&&s<400)return'redirect';if(s>=400&&s<500)return'client-error';return'server-error'; }
        function formatSize(b) { if(b<1024)return b+' B';if(b<1024*1024)return(b/1024).toFixed(1)+' KB';return(b/(1024*1024)).toFixed(1)+' MB'; }
        function truncateUrl(url) { try{const u=new URL(url);return u.pathname+u.search;}catch{return url.length>40?url.slice(0,40)+'...':url;} }
        function parseQueryParams(url) { try{const u=new URL(url);const p=[];u.searchParams.forEach((v,k)=>p.push({key:k,value:v}));return p.length?p:[{key:'',value:''}];}catch{return[{key:'',value:''}];} }
        function getBodyPlaceholder() { return{json:'{"key":"value"}',form:'key=value',xml:'<?xml?>\\n<root/>',text:''}[state.bodyType]||''; }

        function setMethod(m){state.method=m;render();}
        function setUrl(u){state.url=u;}
        function setActiveTab(t){state.activeTab=t;render();}
        function setResponseTab(t){state.responseTab=t;render();}
        function setSidebarTab(t){state.sidebarTab=t;render();if(t==='saved')vscode.postMessage({type:'getSavedRequests'});}
        function setBodyType(t){state.bodyType=t;if(t==='json'&&!state.headers.some(h=>h.key.toLowerCase()==='content-type'))state.headers.push({key:'Content-Type',value:'application/json'});render();}
        function setBody(b){state.body=b;}
        function setAuthType(t){state.auth={type:t};render();}
        function setAuthField(f,v){state.auth[f]=v;}
        function setEnvironment(id){vscode.postMessage({type:'setActiveEnvironment',id});}

        function updateKeyValue(type,i,field,value){
            if(type==='headers'){
                state.headers[i][field]=value;
            }else{
                state.queryParams[i][field]=value;
                updateUrlWithParams();
            }
        }
        function addKeyValue(type){
            console.log('[Webview] Add button clicked for:', type);
            if(type==='headers'){
                state.headers.push({key:'',value:''});
                console.log('[Webview] Added header row, total:', state.headers.length);
            }else{
                state.queryParams.push({key:'',value:''});
                console.log('[Webview] Adding param row, total:', state.queryParams.length);
            }
            render();
        }
        function removeKeyValue(type,i){
            if(type==='headers'){
                state.headers.splice(i,1);
                if(!state.headers.length)state.headers.push({key:'',value:''});
            }else{
                state.queryParams.splice(i,1);
                if(!state.queryParams.length)state.queryParams.push({key:'',value:''});
                updateUrlWithParams();
            }
            render();
        }
        function updateUrlWithParams(){
            if(!state.url)return;
            try{
                const u=new URL(state.url);
                u.search='';
                state.queryParams.forEach(p=>{if(p.key)u.searchParams.append(p.key,p.value);});
                state.url=u.toString();
            }catch(e){
                console.log('[Webview] Cannot update URL params - invalid URL:', state.url);
                // If URL is invalid, just log it - user needs to enter valid URL first
            }
        }

        function newRequest(){
            console.log('[Webview] New request button clicked');
            state.method='GET';
            state.url='';
            state.headers=[{key:'',value:''}];
            state.queryParams=[{key:'',value:''}];
            state.body='';
            state.bodyType='json';
            state.auth={type:'none'};
            state.response=null;
            state.activeTab='params';
            render();
        }
        function sendRequest(){if(!state.url)return;state.loading=true;state.response=null;render();const h={};state.headers.forEach(x=>{if(x.key)h[x.key]=x.value;});vscode.postMessage({type:'sendRequest',method:state.method,url:state.url,headers:h,body:state.bodyType!=='none'?state.body:undefined,auth:state.auth});}
        function discoverEndpoints(){vscode.postMessage({type:'discoverEndpoints'});}
        function loadEndpoint(ep){state.method=ep.method;state.url='http://localhost:3000'+ep.path;state.headers=[{key:'',value:''}];state.body='';state.bodyType=['POST','PUT','PATCH'].includes(ep.method)?'json':'none';render();}
        function loadSavedRequest(id){
            console.log('[Webview] Loading saved request:', id);
            const r=state.savedRequests.find(x=>x.id===id);
            console.log('[Webview] Found request:', r);
            if(r){
                console.log('[Webview] Request has response:', r.response);
                state.method=r.method;
                state.url=r.url;
                state.headers=Object.entries(r.headers||{}).map(([k,v])=>({key:k,value:v}));
                if(!state.headers.length)state.headers.push({key:'',value:''});

                // Parse query params from URL
                try{
                    const u=new URL(r.url);
                    const p=[];
                    u.searchParams.forEach((v,k)=>p.push({key:k,value:v}));
                    state.queryParams=p.length?p:[{key:'',value:''}];
                }catch{
                    state.queryParams=[{key:'',value:''}];
                }

                state.body=r.body||'';
                state.bodyType=r.bodyType||'json';
                state.auth=r.auth||{type:'none'};
                state.response=r.response||null;
                console.log('[Webview] Set state.response to:', state.response);
                state.activeTab='params';
                render();
            }
        }
        function saveCurrentRequest(){
            console.log('[Webview] Save button clicked');
            console.log('[Webview] Current state.response:', state.response);

            // Update URL with params before saving
            updateUrlWithParams();

            // Generate default name from method and URL
            let defaultName = state.method + ' ' + (state.url || 'Request');
            try {
                const u = new URL(state.url);
                defaultName = state.method + ' ' + u.pathname;
            } catch(e) {
                // Use full URL if parsing fails
            }

            const h={};
            state.headers.forEach(x=>{if(x.key)h[x.key]=x.value;});

            // Only include response if it exists and is not an error
            let responseToSave = undefined;
            if (state.response) {
                console.log('[Webview] state.response exists');
                console.log('[Webview] state.response.error?', state.response.error);
                console.log('[Webview] state.response.status?', state.response.status);

                if (!state.response.error && state.response.status) {
                    responseToSave = {
                        status: state.response.status,
                        statusText: state.response.statusText,
                        headers: state.response.headers,
                        body: state.response.body,
                        time: state.response.time,
                        size: state.response.size
                    };
                    console.log('[Webview] Created responseToSave object:', responseToSave);
                } else {
                    console.log('[Webview] NOT saving response - error or no status');
                }
            } else {
                console.log('[Webview] state.response is null/undefined - no response to save');
            }

            console.log('[Webview] Final responseToSave:', responseToSave);

            const payload = {
                type:'saveRequest',
                name:defaultName,
                method:state.method,
                url:state.url,
                headers:h,
                body:state.body,
                bodyType:state.bodyType,
                auth:state.auth,
                response:responseToSave
            };
            console.log('[Webview] Full payload with response:', JSON.stringify(payload).substring(0, 200));
            vscode.postMessage(payload);
        }
        function deleteRequest(id){vscode.postMessage({type:'deleteRequest',id});}
        function createEnvironment(){
            // For now, create with default name - we can improve this later with a proper UI
            const defaultName = 'Environment ' + (state.environments.length + 1);
            vscode.postMessage({type:'createEnvironment',name:defaultName,variables:{}});
        }

        function exportOpenAPI(){
            console.log('[Webview] Exporting OpenAPI...');
            vscode.postMessage({type:'exportOpenAPI'});
        }

        function importOpenAPI(){
            console.log('[Webview] Importing OpenAPI...');
            // For now, we need the user to paste JSON
            // In a real implementation, this would open a file picker
            const json = prompt('Paste your OpenAPI JSON here:');
            if(json){
                vscode.postMessage({type:'importOpenAPI',json});
            }
        }

        window.addEventListener('message',e=>{
            const m=e.data;
            console.log('[Webview] Received message:', m.type, m);
            switch(m.type){
                case'response':state.loading=false;state.response={status:m.status,statusText:m.statusText,headers:m.headers,body:m.body,time:m.time,size:m.size};render();break;
                case'error':state.loading=false;state.response={error:m.message,time:m.time};render();break;
                case'endpointsDiscovered':state.discoveredEndpoints=m.endpoints||[];state.sidebarTab='discovered';render();break;
                case'loadEndpoint':loadEndpoint(m.endpoint);break;
                case'savedRequests':
                    console.log('[Webview] Received saved requests:', m.requests);
                    if(m.requests && m.requests.length > 0){
                        console.log('[Webview] First request has response:', m.requests[0].response);
                    }
                    state.savedRequests=m.requests||[];
                    render();
                    break;
                case'requestSaved':
                    console.log('[Webview] Request saved, fetching updated list');
                    vscode.postMessage({type:'getSavedRequests'});
                    state.sidebarTab='saved';
                    break;
                case'environments':state.environments=m.environments||[];render();break;
            }
        });

        // Make functions globally available for onclick handlers
        window.addKeyValue = addKeyValue;
        window.removeKeyValue = removeKeyValue;
        window.updateKeyValue = updateKeyValue;
        window.newRequest = newRequest;
        window.saveCurrentRequest = saveCurrentRequest;
        window.sendRequest = sendRequest;
        window.discoverEndpoints = discoverEndpoints;
        window.loadSavedRequest = loadSavedRequest;
        window.loadEndpoint = loadEndpoint;
        window.deleteRequest = deleteRequest;
        window.createEnvironment = createEnvironment;
        window.setMethod = setMethod;
        window.setUrl = setUrl;
        window.setActiveTab = setActiveTab;
        window.setResponseTab = setResponseTab;
        window.setSidebarTab = setSidebarTab;
        window.setBodyType = setBodyType;
        window.setBody = setBody;
        window.setAuthType = setAuthType;
        window.setAuthField = setAuthField;
        window.setEnvironment = setEnvironment;
        window.exportOpenAPI = exportOpenAPI;
        window.importOpenAPI = importOpenAPI;

        console.log('[Webview] Initializing - Version 1.0.4');
        console.log('[Webview] addKeyValue function exists:', typeof window.addKeyValue);
        render();
        vscode.postMessage({type:'getEnvironments'});
        vscode.postMessage({type:'getSavedRequests'});
    </script>
</body>
</html>`;
    }
}

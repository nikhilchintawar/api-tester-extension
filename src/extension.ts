import * as vscode from 'vscode';
import { ApiTesterPanel } from './panels/ApiTesterPanel';
import { EndpointDiscovery } from './services/EndpointDiscovery';
import { RequestHistory } from './services/RequestHistory';
import { EnvironmentManager } from './services/EnvironmentManager';
import { OpenAPIStorage } from './services/OpenAPIStorage';

export function activate(context: vscode.ExtensionContext) {
    console.log('API Tester extension is now active!');

    const endpointDiscovery = new EndpointDiscovery();
    const openAPIStorage = new OpenAPIStorage(context);
    const requestHistory = new RequestHistory(context, openAPIStorage);
    const environmentManager = new EnvironmentManager(context);

    // Command to open the API Tester panel
    const openPanelCommand = vscode.commands.registerCommand('apiTester.openPanel', () => {
        ApiTesterPanel.createOrShow(context.extensionUri, {
            endpointDiscovery,
            requestHistory,
            environmentManager
        });
    });

    // Command to discover endpoints in current workspace
    const discoverEndpointsCommand = vscode.commands.registerCommand('apiTester.discoverEndpoints', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const endpoints = await endpointDiscovery.discoverEndpoints(workspaceFolders[0].uri.fsPath);
        
        if (endpoints.length === 0) {
            vscode.window.showInformationMessage('No API endpoints found in workspace');
            return;
        }

        vscode.window.showInformationMessage(`Found ${endpoints.length} API endpoints!`);
        
        // Open panel and send discovered endpoints
        ApiTesterPanel.createOrShow(context.extensionUri, {
            endpointDiscovery,
            requestHistory,
            environmentManager
        });
        
        ApiTesterPanel.currentPanel?.postMessage({
            type: 'endpointsDiscovered',
            endpoints
        });
    });

    // Command to test API from cursor position
    const testFromCursorCommand = vscode.commands.registerCommand('apiTester.testFromCursor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const endpoint = endpointDiscovery.findEndpointAtPosition(document, position);

        if (endpoint) {
            ApiTesterPanel.createOrShow(context.extensionUri, {
                endpointDiscovery,
                requestHistory,
                environmentManager
            });
            
            ApiTesterPanel.currentPanel?.postMessage({
                type: 'loadEndpoint',
                endpoint
            });
        } else {
            vscode.window.showInformationMessage('No API endpoint found at cursor position');
        }
    });

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(zap) API Tester';
    statusBarItem.command = 'apiTester.openPanel';
    statusBarItem.tooltip = 'Open API Tester';
    statusBarItem.show();

    // Code lens provider for inline "Test API" buttons
    const codeLensProvider = new ApiEndpointCodeLensProvider(endpointDiscovery);
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        [
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'python' },
            { scheme: 'file', language: 'go' },
            { scheme: 'file', language: 'java' },
            { scheme: 'file', language: 'rust' },
            { scheme: 'file', language: 'php' }
        ],
        codeLensProvider
    );

    // File system watcher for .openapi.json files
    const openAPIWatcher = vscode.workspace.createFileSystemWatcher('**/*.openapi.json');

    openAPIWatcher.onDidCreate(async (uri) => {
        const choice = await vscode.window.showInformationMessage(
            `Found OpenAPI file: ${uri.fsPath}. Import it?`,
            'Import',
            'Cancel'
        );

        if (choice === 'Import') {
            try {
                const content = await vscode.workspace.fs.readFile(uri);
                const json = Buffer.from(content).toString('utf8');
                const result = await openAPIStorage.importJSON(json);

                if (result.errors.length > 0) {
                    vscode.window.showErrorMessage(`Import completed with errors: ${result.errors.join(', ')}`);
                } else {
                    vscode.window.showInformationMessage(`Successfully imported ${result.imported} requests from OpenAPI file`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import OpenAPI file: ${error}`);
            }
        }
    });

    openAPIWatcher.onDidChange(async (uri) => {
        const choice = await vscode.window.showInformationMessage(
            `OpenAPI file updated: ${uri.fsPath}. Re-import it?`,
            'Re-import',
            'Cancel'
        );

        if (choice === 'Re-import') {
            try {
                const content = await vscode.workspace.fs.readFile(uri);
                const json = Buffer.from(content).toString('utf8');
                const result = await openAPIStorage.importJSON(json);

                if (result.errors.length > 0) {
                    vscode.window.showErrorMessage(`Import completed with errors: ${result.errors.join(', ')}`);
                } else {
                    vscode.window.showInformationMessage(`Successfully re-imported ${result.imported} requests from OpenAPI file`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import OpenAPI file: ${error}`);
            }
        }
    });

    // Command to import OpenAPI file from workspace
    const importOpenAPICommand = vscode.commands.registerCommand('apiTester.importOpenAPI', async () => {
        const files = await vscode.workspace.findFiles('**/*.openapi.json', '**/node_modules/**');

        if (files.length === 0) {
            vscode.window.showInformationMessage('No .openapi.json files found in workspace');
            return;
        }

        const items = files.map(file => ({
            label: vscode.workspace.asRelativePath(file),
            description: file.fsPath,
            uri: file
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an OpenAPI file to import'
        });

        if (selected) {
            try {
                const content = await vscode.workspace.fs.readFile(selected.uri);
                const json = Buffer.from(content).toString('utf8');
                const result = await openAPIStorage.importJSON(json);

                if (result.errors.length > 0) {
                    vscode.window.showErrorMessage(`Import completed with errors: ${result.errors.join(', ')}`);
                } else {
                    vscode.window.showInformationMessage(`Successfully imported ${result.imported} requests from ${selected.label}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import OpenAPI file: ${error}`);
            }
        }
    });

    context.subscriptions.push(
        openPanelCommand,
        discoverEndpointsCommand,
        testFromCursorCommand,
        importOpenAPICommand,
        statusBarItem,
        codeLensDisposable,
        openAPIWatcher
    );
}

class ApiEndpointCodeLensProvider implements vscode.CodeLensProvider {
    constructor(private endpointDiscovery: EndpointDiscovery) {}

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        const endpoints = this.endpointDiscovery.findEndpointsInDocument(document);

        for (const endpoint of endpoints) {
            const range = new vscode.Range(endpoint.line, 0, endpoint.line, 0);
            
            const testLens = new vscode.CodeLens(range, {
                title: `▶ Test ${endpoint.method} ${endpoint.path}`,
                command: 'apiTester.testFromCursor',
                arguments: [endpoint]
            });
            
            codeLenses.push(testLens);
        }

        return codeLenses;
    }
}

export function deactivate() {}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface DiscoveredEndpoint {
    method: string;
    path: string;
    file: string;
    line: number;
    framework: string;
    params?: string[];
    queryParams?: string[];
    bodySchema?: Record<string, unknown>;
    description?: string;
}

export class EndpointDiscovery {
    // Patterns for different frameworks
    private patterns: Record<string, RegExp[]> = {
        // Express.js patterns
        express: [
            /(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /(?:app|router)\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(get|post|put|patch|delete)/gi,
        ],
        // Fastify patterns
        fastify: [
            /fastify\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /\.route\s*\(\s*\{\s*method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*url:\s*['"`]([^'"`]+)['"`]/gi,
        ],
        // Hono patterns
        hono: [
            /(?:app|hono)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ],
        // NestJS patterns
        nestjs: [
            /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"`]?([^'"`\)]*)?['"`]?\s*\)/gi,
            /@Controller\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
        ],
        // Next.js API routes (file-based)
        nextjs: [
            /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/gi,
            /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/gi,
        ],
        // Flask (Python)
        flask: [
            /@(?:app|blueprint|bp)\.route\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/gi,
            /@(?:app|blueprint|bp)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ],
        // FastAPI (Python)
        fastapi: [
            /@(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ],
        // Django (Python)
        django: [
            /path\s*\(\s*['"`]([^'"`]+)['"`]\s*,/gi,
            /re_path\s*\(\s*r?['"`]([^'"`]+)['"`]\s*,/gi,
        ],
        // Go (Gin, Echo, Chi, net/http)
        go: [
            /\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*["']([^"']+)["']/gi,
            /HandleFunc\s*\(\s*["']([^"']+)["']/gi,
            /Handle\s*\(\s*["']([^"']+)["']/gi,
            /r\.Route\s*\(\s*["']([^"']+)["']/gi,
        ],
        // Spring Boot (Java)
        spring: [
            /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\s*\(\s*(?:value\s*=\s*)?["']?([^"'\)]+)?["']?\s*\)/gi,
            /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'](?:\s*,\s*method\s*=\s*RequestMethod\.(GET|POST|PUT|PATCH|DELETE))?/gi,
        ],
        // Rust (Actix, Axum, Rocket)
        rust: [
            /#\[(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']\s*\)\]/gi,
            /\.route\s*\(\s*["']([^"']+)["']\s*,\s*(?:get|post|put|patch|delete)\s*\(/gi,
        ],
        // PHP (Laravel)
        laravel: [
            /Route::(get|post|put|patch|delete|options)\s*\(\s*['"]([^'"]+)['"]/gi,
            /->(?:get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi,
        ],
        // Koa
        koa: [
            /router\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ],
    };

    async discoverEndpoints(workspacePath: string): Promise<DiscoveredEndpoint[]> {
        const endpoints: DiscoveredEndpoint[] = [];
        const files = await this.getAllSourceFiles(workspacePath);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const fileEndpoints = this.parseFileForEndpoints(content, file);
                endpoints.push(...fileEndpoints);
            } catch (error) {
                console.error(`Error parsing file ${file}:`, error);
            }
        }

        // Handle Next.js file-based routing
        const nextjsEndpoints = await this.discoverNextJsRoutes(workspacePath);
        endpoints.push(...nextjsEndpoints);

        return this.deduplicateEndpoints(endpoints);
    }

    private async getAllSourceFiles(dirPath: string): Promise<string[]> {
        const files: string[] = [];
        const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rs', '.php'];
        const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', 'target'];

        const walkDir = (currentPath: string) => {
            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    
                    if (entry.isDirectory()) {
                        if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                            walkDir(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (extensions.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error reading directory ${currentPath}:`, error);
            }
        };

        walkDir(dirPath);
        return files;
    }

    private parseFileForEndpoints(content: string, filePath: string): DiscoveredEndpoint[] {
        const endpoints: DiscoveredEndpoint[] = [];
        const lines = content.split('\n');
        const ext = path.extname(filePath).toLowerCase();

        // Determine which patterns to use based on file extension and content
        const applicableFrameworks = this.detectFrameworks(content, ext);

        for (const framework of applicableFrameworks) {
            const frameworkPatterns = this.patterns[framework];
            if (!frameworkPatterns) continue;

            for (const pattern of frameworkPatterns) {
                // Reset regex lastIndex
                pattern.lastIndex = 0;
                let match;

                while ((match = pattern.exec(content)) !== null) {
                    const endpoint = this.extractEndpointFromMatch(match, framework, filePath, content);
                    if (endpoint) {
                        // Find line number
                        const matchIndex = match.index;
                        let lineNumber = 0;
                        let charCount = 0;
                        
                        for (let i = 0; i < lines.length; i++) {
                            charCount += lines[i].length + 1; // +1 for newline
                            if (charCount > matchIndex) {
                                lineNumber = i;
                                break;
                            }
                        }

                        endpoint.line = lineNumber;
                        endpoints.push(endpoint);
                    }
                }
            }
        }

        return endpoints;
    }

    private detectFrameworks(content: string, ext: string): string[] {
        const frameworks: string[] = [];

        // JavaScript/TypeScript frameworks
        if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
            if (content.includes('express') || content.includes("require('express')") || content.includes('from "express"')) {
                frameworks.push('express');
            }
            if (content.includes('fastify') || content.includes("require('fastify')")) {
                frameworks.push('fastify');
            }
            if (content.includes('hono') || content.includes("from 'hono'")) {
                frameworks.push('hono');
            }
            if (content.includes('@nestjs') || content.includes('@Controller') || content.includes('@Get')) {
                frameworks.push('nestjs');
            }
            if (content.includes('export function GET') || content.includes('export const GET') || 
                content.includes('export async function GET')) {
                frameworks.push('nextjs');
            }
            if (content.includes('koa-router') || content.includes('@koa/router')) {
                frameworks.push('koa');
            }
        }

        // Python frameworks
        if (ext === '.py') {
            if (content.includes('flask') || content.includes('@app.route') || content.includes('@bp.route')) {
                frameworks.push('flask');
            }
            if (content.includes('fastapi') || content.includes('FastAPI') || content.includes('@app.get')) {
                frameworks.push('fastapi');
            }
            if (content.includes('django') || content.includes('urlpatterns') || content.includes('path(')) {
                frameworks.push('django');
            }
        }

        // Go frameworks
        if (ext === '.go') {
            frameworks.push('go');
        }

        // Java frameworks
        if (ext === '.java') {
            if (content.includes('@GetMapping') || content.includes('@PostMapping') || 
                content.includes('@RequestMapping') || content.includes('springframework')) {
                frameworks.push('spring');
            }
        }

        // Rust frameworks
        if (ext === '.rs') {
            frameworks.push('rust');
        }

        // PHP frameworks
        if (ext === '.php') {
            if (content.includes('Route::') || content.includes('Laravel')) {
                frameworks.push('laravel');
            }
        }

        return frameworks;
    }

    private extractEndpointFromMatch(
        match: RegExpExecArray,
        framework: string,
        filePath: string,
        _content: string
    ): DiscoveredEndpoint | null {
        let method = '';
        let routePath = '';

        switch (framework) {
            case 'express':
            case 'fastify':
            case 'hono':
            case 'koa':
            case 'fastapi':
                method = match[1]?.toUpperCase() || 'GET';
                routePath = match[2] || '/';
                break;

            case 'nestjs':
                const decorator = match[1]?.toLowerCase();
                if (decorator === 'controller') {
                    // Skip controller decorators, we want method decorators
                    return null;
                }
                method = decorator?.toUpperCase() || 'GET';
                routePath = match[2] || '/';
                break;

            case 'nextjs':
                method = match[1]?.toUpperCase() || 'GET';
                // Extract path from file location
                routePath = this.extractNextJsPath(filePath);
                break;

            case 'flask':
                if (match[2]) {
                    // Has methods array
                    const methods = match[2].replace(/['"]/g, '').split(',').map(m => m.trim());
                    method = methods[0]?.toUpperCase() || 'GET';
                } else {
                    method = match[1]?.toUpperCase() || 'GET';
                }
                routePath = match[1] || match[2] || '/';
                break;

            case 'django':
                method = 'GET'; // Django URL patterns don't specify method
                routePath = match[1] || '/';
                break;

            case 'go':
                if (match[1] && !match[1].startsWith('/')) {
                    method = match[1].toUpperCase();
                    routePath = match[2] || '/';
                } else {
                    method = 'GET';
                    routePath = match[1] || '/';
                }
                break;

            case 'spring':
                const mapping = match[1]?.toLowerCase();
                if (mapping?.includes('get')) method = 'GET';
                else if (mapping?.includes('post')) method = 'POST';
                else if (mapping?.includes('put')) method = 'PUT';
                else if (mapping?.includes('patch')) method = 'PATCH';
                else if (mapping?.includes('delete')) method = 'DELETE';
                else method = match[3]?.toUpperCase() || 'GET';
                routePath = match[2] || '/';
                break;

            case 'rust':
                method = match[0].match(/get|post|put|patch|delete/i)?.[0]?.toUpperCase() || 'GET';
                routePath = match[1] || '/';
                break;

            case 'laravel':
                method = match[1]?.toUpperCase() || 'GET';
                routePath = match[2] || '/';
                break;

            default:
                return null;
        }

        // Clean up the path
        routePath = routePath.replace(/^['"`]|['"`]$/g, '').trim();
        if (!routePath.startsWith('/')) {
            routePath = '/' + routePath;
        }

        // Extract path parameters
        const params = this.extractPathParams(routePath);

        return {
            method,
            path: routePath,
            file: filePath,
            line: 0, // Will be set later
            framework,
            params: params.length > 0 ? params : undefined,
        };
    }

    private extractPathParams(routePath: string): string[] {
        const params: string[] = [];
        
        // Express/Fastify style :param
        const colonParams = routePath.match(/:([^/]+)/g);
        if (colonParams) {
            params.push(...colonParams.map(p => p.slice(1)));
        }

        // Bracket style {param} or [param]
        const bracketParams = routePath.match(/[{[]([^\]}]+)[}\]]/g);
        if (bracketParams) {
            params.push(...bracketParams.map(p => p.slice(1, -1)));
        }

        // Angle bracket style <param>
        const angleParams = routePath.match(/<([^>]+)>/g);
        if (angleParams) {
            params.push(...angleParams.map(p => p.slice(1, -1)));
        }

        return params;
    }

    private extractNextJsPath(filePath: string): string {
        // Convert file path to API route
        // e.g., /app/api/users/[id]/route.ts -> /api/users/[id]
        const match = filePath.match(/(?:pages|app)(\/api\/[^.]+)/);
        if (match) {
            let routePath = match[1];
            // Remove route.ts, route.js, etc.
            routePath = routePath.replace(/\/route$/, '');
            // Remove index
            routePath = routePath.replace(/\/index$/, '');
            return routePath || '/api';
        }
        return '/api';
    }

    private async discoverNextJsRoutes(workspacePath: string): Promise<DiscoveredEndpoint[]> {
        const endpoints: DiscoveredEndpoint[] = [];
        
        // Look for Next.js app router API routes
        const apiPaths = [
            path.join(workspacePath, 'app', 'api'),
            path.join(workspacePath, 'src', 'app', 'api'),
            path.join(workspacePath, 'pages', 'api'),
            path.join(workspacePath, 'src', 'pages', 'api'),
        ];

        for (const apiPath of apiPaths) {
            if (fs.existsSync(apiPath)) {
                const routes = await this.walkNextJsApiDir(apiPath, apiPath);
                endpoints.push(...routes);
            }
        }

        return endpoints;
    }

    private async walkNextJsApiDir(basePath: string, currentPath: string): Promise<DiscoveredEndpoint[]> {
        const endpoints: DiscoveredEndpoint[] = [];
        
        try {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subEndpoints = await this.walkNextJsApiDir(basePath, fullPath);
                    endpoints.push(...subEndpoints);
                } else if (entry.isFile() && /^route\.(js|ts|jsx|tsx)$/.test(entry.name)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const relativePath = fullPath.replace(basePath, '').replace(/\/route\.[jt]sx?$/, '');
                    const apiPath = '/api' + (relativePath || '');
                    
                    // Check for exported HTTP methods
                    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
                    for (const method of methods) {
                        if (content.includes(`export function ${method}`) ||
                            content.includes(`export async function ${method}`) ||
                            content.includes(`export const ${method}`)) {
                            endpoints.push({
                                method,
                                path: apiPath,
                                file: fullPath,
                                line: 0,
                                framework: 'nextjs',
                                params: this.extractPathParams(apiPath),
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error walking Next.js API directory:`, error);
        }

        return endpoints;
    }

    private deduplicateEndpoints(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
        const seen = new Set<string>();
        return endpoints.filter(ep => {
            const key = `${ep.method}:${ep.path}:${ep.file}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    findEndpointsInDocument(document: vscode.TextDocument): DiscoveredEndpoint[] {
        const content = document.getText();
        return this.parseFileForEndpoints(content, document.uri.fsPath);
    }

    findEndpointAtPosition(document: vscode.TextDocument, position: vscode.Position): DiscoveredEndpoint | null {
        const endpoints = this.findEndpointsInDocument(document);
        
        // Find endpoint closest to and before/at the cursor position
        let closestEndpoint: DiscoveredEndpoint | null = null;
        let closestDistance = Infinity;

        for (const endpoint of endpoints) {
            if (endpoint.line <= position.line) {
                const distance = position.line - endpoint.line;
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestEndpoint = endpoint;
                }
            }
        }

        // Only return if within 10 lines of the endpoint definition
        if (closestEndpoint && closestDistance <= 10) {
            return closestEndpoint;
        }

        return null;
    }
}

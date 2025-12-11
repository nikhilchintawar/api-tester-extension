# API Tester - VS Code Extension

A powerful, Postman-like API testing tool built directly into VS Code. Test your APIs without leaving your editor!

![API Tester Screenshot](images/screenshot.png)

## ✨ Features

### 🔍 Automatic Endpoint Discovery
Scan your codebase and automatically discover API endpoints from popular frameworks:

- **JavaScript/TypeScript**: Express, Fastify, Hono, NestJS, Next.js (App Router), Koa
- **Python**: Flask, FastAPI, Django
- **Go**: Gin, Echo, Chi, net/http
- **Java**: Spring Boot
- **Rust**: Actix, Axum, Rocket
- **PHP**: Laravel

### 🚀 Full-Featured API Client
- Support for all HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Request headers management
- Multiple body types (JSON, Form, Text, XML)
- Query parameters builder
- Authentication support (Bearer, Basic, API Key)

### 🌍 Environment Variables
- Create multiple environments (Development, Staging, Production)
- Auto-load from `.env` files
- Use `{{variable}}` syntax anywhere in your requests
- Quick environment switching

### 📚 Request Management
- Save requests for quick access
- Organize into collections
- Full request history with response data
- Import/Export functionality

### 💡 Smart Code Integration
- CodeLens integration - "Test API" buttons appear above your route definitions
- Right-click context menu to test endpoints
- Navigate directly to source code from discovered endpoints

## 📦 Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "API Tester"
4. Click Install

### From VSIX File
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click "..." menu → "Install from VSIX..."
5. Select the downloaded file

### Build from Source
```bash
# Clone the repository
git clone https://github.com/your-username/api-tester.git
cd api-tester

# Install dependencies
npm install

# Compile
npm run compile

# Package
npm run package
```

## 🎯 Usage

### Opening API Tester
- Click the ⚡ icon in the status bar
- Use keyboard shortcut: `Ctrl+Shift+A` (Windows/Linux) or `Cmd+Shift+A` (Mac)
- Command Palette: "API Tester: Open API Tester"

### Discovering Endpoints
1. Open your project in VS Code
2. Open API Tester
3. Click "Discover Endpoints" button
4. All found endpoints will appear in the sidebar

### Making Requests
1. Select HTTP method (GET, POST, etc.)
2. Enter URL or use environment variables: `{{BASE_URL}}/api/users`
3. Add headers, body, or authentication as needed
4. Click "Send"

### Using Environment Variables
1. Click "Manage" in the environment selector
2. Create a new environment
3. Add variables as JSON: `{"BASE_URL": "http://localhost:3000", "API_KEY": "secret"}`
4. Use in requests: `{{BASE_URL}}/api/{{VERSION}}/users`

### Testing from Code
- Look for "▶ Test GET /api/users" CodeLens above your route definitions
- Right-click in editor → "Test API at Cursor"
- Use keyboard shortcut: `Ctrl+Shift+T` (Windows/Linux) or `Cmd+Shift+T` (Mac)

## ⚙️ Configuration

Open VS Code Settings and search for "API Tester":

| Setting | Default | Description |
|---------|---------|-------------|
| `apiTester.defaultBaseUrl` | `http://localhost:3000` | Default base URL for discovered endpoints |
| `apiTester.timeout` | `30000` | Request timeout in milliseconds |
| `apiTester.saveHistory` | `true` | Save request history |
| `apiTester.maxHistoryItems` | `100` | Maximum history items to keep |
| `apiTester.autoDiscoverOnOpen` | `false` | Auto-discover endpoints on workspace open |

## 🔧 Supported Frameworks

### JavaScript/TypeScript
```javascript
// Express
app.get('/api/users', handler);
router.post('/api/users', handler);

// NestJS
@Get('/users')
@Post('/users/:id')

// Next.js App Router
// app/api/users/route.ts
export async function GET(request) {}
export async function POST(request) {}
```

### Python
```python
# Flask
@app.route('/api/users', methods=['GET', 'POST'])

# FastAPI
@app.get('/api/users')
@app.post('/api/users')
```

### Go
```go
// Gin
r.GET("/api/users", handler)
r.POST("/api/users", handler)
```

### Java
```java
// Spring Boot
@GetMapping("/api/users")
@PostMapping("/api/users")
```

## 🎨 Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+A` / `Cmd+Shift+A` | Open API Tester |
| `Ctrl+Shift+T` / `Cmd+Shift+T` | Test API at Cursor |
| `Enter` (in URL field) | Send Request |

## 📝 Changelog

### v1.0.0
- Initial release
- Endpoint discovery for 10+ frameworks
- Full HTTP client functionality
- Environment variables support
- Request history and collections
- CodeLens integration

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by Postman, Insomnia, and Thunder Client
- Built with ❤️ for the developer community

---

**Enjoy testing your APIs without leaving VS Code!** ⚡

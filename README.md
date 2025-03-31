# Advanced Proxy Server

An enhanced proxy server with authentication, caching, custom headers, and monitoring dashboard.

## Features

- 🔒 **Authentication** - Dashboard and configuration protected with Basic Auth
- 🔄 **Request Proxying** - Forward API requests to any target service
- 📊 **Monitoring Dashboard** - Real-time request logs and statistics
- 📝 **Custom Headers** - Add custom headers to proxied requests
- 💾 **Response Caching** - Cache responses to improve performance
- 🔐 **HTTPS Support** - Optional secure connections
- ⚡ **Rate Limiting** - Protect against API abuse
- 🚪 **Multiple Instances** - Run multiple proxy servers simultaneously

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/proxy-server.git
   cd proxy-server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on the provided example:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file to configure your proxy:
   ```
   # Proxy Configuration
   PORT=3333
   HOST=localhost
   API_SERVICE_URL=https://api.example.com

   # Security
   USE_HTTPS=false
   ADMIN_USER=admin
   ADMIN_PASSWORD=your-secure-password

   # Performance
   ENABLE_CACHE=true
   CACHE_DURATION=5 minutes

   # Custom Headers (JSON format)
   CUSTOM_HEADERS={"X-Proxy-Version":"1.0.0"}
   ```

5. For HTTPS support (optional):
   - Set `USE_HTTPS=true` in your `.env` file
   - Create an `ssl` directory in the project root
   - Add your `key.pem` and `cert.pem` files to the `ssl` directory

## Usage

### Starting the proxy server

```
npm start
```

For development with auto-restart:
```
npm run dev
```

### Accessing the dashboard

Open your browser and navigate to:
```
http://localhost:3333
```

Default login credentials:
- Username: admin
- Password: admin123 (should be changed in .env for production)

### Proxying requests

Send requests through your proxy:
```
http://localhost:3333/api/your-endpoint
```

These will be forwarded to:
```
https://your-configured-api.com/your-endpoint
```

## Testing

### Automated tests

Run the test suite:
```
npm test
```

### Manual testing

1. Start the proxy server:
   ```
   npm start
   ```

2. Test the proxy status endpoint:
   ```
   curl http://localhost:3333/info
   ```

3. Make a proxied request:
   ```
   curl http://localhost:3333/api/your-endpoint
   ```

4. Test request with authentication (for protected endpoints):
   ```
   curl -u admin:admin123 http://localhost:3333/update-target -X POST \
        -H "Content-Type: application/json" \
        -d '{"target": "https://newapi.example.com"}'
   ```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| PORT | Port to run the proxy server on | 3333 |
| HOST | Host to bind to | localhost |
| API_SERVICE_URL | Target API to proxy requests to | https://api.uat.aks1.io |
| USE_HTTPS | Enable HTTPS for the proxy server | false |
| ADMIN_USER | Username for dashboard login | admin |
| ADMIN_PASSWORD | Password for dashboard login | admin123 |
| ENABLE_CACHE | Enable response caching | true |
| CACHE_DURATION | How long to cache responses for | 5 minutes |
| CUSTOM_HEADERS | JSON object with headers to add to proxied requests | {} |

## Troubleshooting

- **Authentication issues**: Ensure the correct username/password is used from .env
- **HTTPS errors**: Check that key.pem and cert.pem are valid and in the ssl directory
- **Connection refused**: Verify your PORT isn't already in use by another service

## License

MIT 
# Proxy Server User Manual

## Quick Start

### Starting the Proxy Server

1. Double-click the `start-proxy.command` file on your desktop
   - This will automatically:
     - Navigate to the proxy server directory
     - Start the proxy server on port 3333

2. The proxy server will be available at:
   - Dashboard: `http://0.0.0.0:3333`
   - API Endpoint: `http://0.0.0.0:3333/api`

### Client Configuration

For mobile app development (especially Android emulator):
- Set your app's base URL to: `http://10.0.2.2:3333`
  - `10.0.2.2` is the special IP address that points to your host machine from the Android emulator
  - Port `3333` is the default proxy server port

## Dashboard Features

### 1. Server Configuration
- **Target URL**: Set the API service you want to proxy
- **Port**: Default is 3333
- **Start Time**: Shows when the proxy server started

### 2. API Mocks
- Create mock responses for specific endpoints
- Configure HTTP methods, paths, and response bodies
- Enable/disable mocks as needed

### 3. Request Interception
- Intercept and modify requests before they reach the target
- View and edit request details
- Forward or drop intercepted requests

### 4. Request Logs
- View all proxied requests in real-time
- Search through request logs
- Clear logs when needed

## Usage Guide

### Basic Usage
1. Start the proxy server using `start-proxy.command`
2. Configure your target API URL in the dashboard
3. Point your app to `http://10.0.2.2:3333`
4. All requests will be proxied to your target API

### Creating Mocks
1. Click "Add Mock" in the dashboard
2. Configure:
   - HTTP Method (GET, POST, PUT, etc.)
   - Path (e.g., `/api/users`)
   - Response Status Code
   - Response Body (JSON)
3. Enable the mock to start using it

### Intercepting Requests
1. Enable interception in the dashboard
2. Send requests from your app
3. View and modify intercepted requests
4. Forward or drop requests as needed

## Troubleshooting

### Common Issues
1. **Proxy not starting**
   - Check if port 3333 is already in use
   - Ensure you have Node.js installed
   - Verify the `start-proxy.command` has execute permissions

2. **Requests not reaching proxy**
   - Verify your app is using the correct URL (`http://10.0.2.2:3333`)
   - Check if the proxy server is running
   - Ensure your emulator/device can reach the host machine

3. **Mocks not working**
   - Verify the mock is enabled
   - Check if the path and method match your request
   - Ensure the mock configuration is correct

## Security

- The dashboard is protected with basic authentication
- Default credentials:
  - Username: admin
  - Password: admin123
- Change these credentials in the `.env` file for production use

## Support

For issues or questions:
1. Check the dashboard logs for error messages
2. Verify your configuration in the `.env` file
3. Ensure all required dependencies are installed 
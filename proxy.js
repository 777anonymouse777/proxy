const express = require('express');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const https = require('https');
const dotenv = require('dotenv');
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const apicache = require('apicache');
const cookie = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios'); // For testing
const InterceptQueue = require('./interceptQueue'); // Import InterceptQueue

// Load environment variables from .env file
dotenv.config();

// Create app and server
const app = express();
const useHttps = process.env.USE_HTTPS === 'true';
let server;

// Create instance of InterceptQueue for request interception
const interceptQueue = new InterceptQueue();

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('Created data directory for persistent storage');
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Store mock configurations
const MOCKS_FILE_PATH = path.join(dataDir, 'mocks.json');
let mocks = [];

// Load mocks from file if it exists
function loadMocksFromDisk() {
    try {
        console.log(`Checking for mocks file at: ${MOCKS_FILE_PATH}`);
        if (fs.existsSync(MOCKS_FILE_PATH)) {
            console.log('Mocks file found, loading...');
            const data = fs.readFileSync(MOCKS_FILE_PATH, 'utf8');
            console.log('Mocks file content:', data.substring(0, 100) + (data.length > 100 ? '...' : ''));
            if (data.trim() === '') {
                console.log('Mocks file is empty, starting with empty mocks');
                mocks = [];
                return;
            }
            
            try {
                mocks = JSON.parse(data);
                console.log(`Loaded ${mocks.length} mocks from disk`);
            } catch (parseError) {
                console.error('Error parsing mocks JSON:', parseError);
                // Create a backup of the corrupted file
                const backupPath = `${MOCKS_FILE_PATH}.backup-${Date.now()}`;
                fs.copyFileSync(MOCKS_FILE_PATH, backupPath);
                console.log(`Created backup of corrupted mocks file at ${backupPath}`);
                mocks = [];
            }
        } else {
            console.log('No mocks file found, starting with empty mocks');
            // Create an empty mocks file
            saveMocksToDisk();
            mocks = [];
        }
    } catch (error) {
        console.error('Error loading mocks from disk:', error);
        mocks = [];
    }
}

// Save mocks to disk
function saveMocksToDisk() {
    try {
        console.log(`Saving ${mocks.length} mocks to disk at ${MOCKS_FILE_PATH}`);
        fs.writeFileSync(MOCKS_FILE_PATH, JSON.stringify(mocks, null, 2));
        console.log(`Saved ${mocks.length} mocks to disk`);
    } catch (error) {
        console.error('Error saving mocks to disk:', error);
    }
}

// Load mocks on startup
loadMocksFromDisk();

// Setup HTTPS if enabled
if (useHttps && fs.existsSync('./ssl/key.pem') && fs.existsSync('./ssl/cert.pem')) {
    const options = {
        key: fs.readFileSync('./ssl/key.pem'),
        cert: fs.readFileSync('./ssl/cert.pem')
    };
    server = https.createServer(options, app);
    console.log('HTTPS enabled');
} else {
    server = require('http').createServer(app);
    if (useHttps) {
        console.warn('HTTPS was enabled but certificates not found. Falling back to HTTP.');
    }
}

// WebSocket server
const wss = new WebSocket.Server({ server });

// Track connected WebSocket clients
wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    // Send an initial welcome message
    ws.send(JSON.stringify({
        timestamp: new Date(),
        method: 'SYSTEM',
        url: 'WebSocket connection established',
        status: 200
    }));
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

// Configuration
const PORT = 3333;
const HOST = process.env.HOST || "localhost";
let API_SERVICE_URL = process.env.API_SERVICE_URL || "https://api.uat.aks1.io";

// Remove trailing slash if present
if (API_SERVICE_URL.endsWith('/')) {
    API_SERVICE_URL = API_SERVICE_URL.slice(0, -1);
}

// Custom headers for proxied requests
let CUSTOM_HEADERS = JSON.parse(process.env.CUSTOM_HEADERS || '{}');

// Request cache
const cache = apicache.middleware;
const cacheTime = process.env.CACHE_DURATION || '5 minutes';

// Authentication for dashboard
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "'unsafe-inline'"]
        }
    }
}));
app.use(cookie());

// Replace auth middleware with a pass-through version (no security)
const authMiddleware = (req, res, next) => {
    // Skip authentication and just continue to the next middleware
    next();
};

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

// Middleware for parsing JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// API analytics
const requestStats = {
    total: 0,
    methods: {},
    statusCodes: {},
    errors: 0
};

// Track active sessions
const sessions = new Map();

// Session middleware
const sessionMiddleware = (req, res, next) => {
    let sessionId = req.cookies?.sessionId;
    
    if (!sessionId || !sessions.has(sessionId)) {
        sessionId = uuidv4();
        sessions.set(sessionId, {
            createdAt: new Date(),
            lastActive: new Date()
        });
        res.cookie('sessionId', sessionId, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    } else {
        // Update last active time
        const session = sessions.get(sessionId);
        session.lastActive = new Date();
        sessions.set(sessionId, session);
    }
    
    next();
};

// API Routes - These must come BEFORE static file middleware
app.get('/info', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
        status: 'active',
        target: API_SERVICE_URL,
        port: PORT,
        proxyStartTime: new Date().toISOString(),
        httpsEnabled: useHttps,
        customHeaders: CUSTOM_HEADERS
    });
});

// Add a direct test endpoint
app.get('/test-proxy', async (req, res) => {
    try {
        console.log('Testing target API directly...');
        const testUrl = API_SERVICE_URL + '/posts/1';
        console.log('Testing connection to:', testUrl);
        
        const response = await axios.get(testUrl, {
            timeout: 5000,
            validateStatus: false // Allow any status code to come back
        });
        
        console.log('Direct test response:', response.status);
        
        res.json({
            success: response.status >= 200 && response.status < 300,
            targetUrl: API_SERVICE_URL,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data || { message: "Raw response received (not JSON)" }
        });
    } catch (error) {
        console.error('Direct test failed:', error.message);
        res.status(500).json({
            success: false,
            targetUrl: API_SERVICE_URL,
            error: error.message,
            details: error.code || 'Unknown error'
        });
    }
});

// Dashboard routes should be authenticated
app.use('/dashboard', authMiddleware, sessionMiddleware, (req, res, next) => {
    next();
});

// Update target URL
app.post('/update-target', authMiddleware, (req, res) => {
    console.log('Received target URL update request:', req.body);
    
    const { target } = req.body;
    if (!target) {
        console.log('Error: No target URL provided');
        return res.status(400).json({ success: false, error: 'Target URL is required' });
    }

    try {
        const url = new URL(target);
        console.log('Valid URL received:', url.toString());
        
        // Update the proxy configuration
        API_SERVICE_URL = url.toString();
        
        // Remove trailing slash if present
        if (API_SERVICE_URL.endsWith('/')) {
            API_SERVICE_URL = API_SERVICE_URL.slice(0, -1);
        }
        
        // Update the proxy middleware by recreating it
        setupProxyMiddleware();

        console.log('Proxy configuration updated successfully');
        res.setHeader('Content-Type', 'application/json');
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating target URL:', error);
        res.setHeader('Content-Type', 'application/json');
        res.status(400).json({ 
            success: false, 
            error: 'Invalid URL format: ' + error.message 
        });
    }
});

// Update custom headers
app.post('/update-headers', authMiddleware, (req, res) => {
    const { headers } = req.body;
    if (!headers || typeof headers !== 'object') {
        return res.status(400).json({ 
            success: false, 
            error: 'Headers must be provided as an object' 
        });
    }

    try {
        CUSTOM_HEADERS = headers;
        setupProxyMiddleware();
        
        res.json({ 
            success: true, 
            message: 'Custom headers updated',
            headers: CUSTOM_HEADERS
        });
    } catch (error) {
        console.error('Error updating headers:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Update cache settings
app.post('/update-cache', authMiddleware, (req, res) => {
    const { enabled, duration } = req.body;
    
    if (enabled === undefined) {
        return res.status(400).json({ 
            success: false, 
            error: 'Cache enabled flag must be provided'
        });
    }

    try {
        // Update the environment variable
        process.env.ENABLE_CACHE = enabled.toString();
        
        if (duration) {
            process.env.CACHE_DURATION = duration;
        }
        
        res.json({ 
            success: true, 
            message: 'Cache settings updated',
            cacheEnabled: enabled,
            cacheDuration: process.env.CACHE_DURATION
        });
    } catch (error) {
        console.error('Error updating cache settings:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Reset stats
app.post('/reset-stats', authMiddleware, (req, res) => {
    requestStats.total = 0;
    requestStats.methods = {};
    requestStats.statusCodes = {};
    requestStats.errors = 0;
    
    res.json({ 
        success: true, 
        message: 'Stats reset successfully'
    });
});

// Clear cache
app.post('/clear-cache', authMiddleware, (req, res) => {
    apicache.clear();
    res.json({ 
        success: true, 
        message: 'Cache cleared successfully'
    });
});

// Mocks management routes
app.get('/mocks', (req, res) => {
    res.json({ 
        success: true, 
        mocks: mocks 
    });
});

app.post('/mocks', (req, res) => {
    const { path, method, responseBody, statusCode, enabled, queryParams, bodyMatch } = req.body;
    
    if (!path) {
        return res.status(400).json({ 
            success: false, 
            error: 'Path is required' 
        });
    }
    
    // Create new mock with unique ID
    const newMock = {
        id: uuidv4(),
        path,
        method: method || 'GET',
        responseBody: responseBody || {},
        statusCode: statusCode || 200,
        enabled: enabled !== undefined ? enabled : true,
        queryParams: queryParams || [],
        bodyMatch: bodyMatch || null,
        createdAt: new Date().toISOString()
    };
    
    mocks.push(newMock);
    
    // Save updated mocks to disk
    saveMocksToDisk();
    
    res.json({ 
        success: true, 
        mock: newMock 
    });
});

app.put('/mocks/:id', (req, res) => {
    const { id } = req.params;
    const { path, method, responseBody, statusCode, enabled, queryParams, bodyMatch } = req.body;
    
    const mockIndex = mocks.findIndex(mock => mock.id === id);
    
    if (mockIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Mock not found' 
        });
    }
    
    // Update mock with new data
    if (path !== undefined) mocks[mockIndex].path = path;
    if (method !== undefined) mocks[mockIndex].method = method;
    if (responseBody !== undefined) mocks[mockIndex].responseBody = responseBody;
    if (statusCode !== undefined) mocks[mockIndex].statusCode = statusCode;
    if (enabled !== undefined) mocks[mockIndex].enabled = enabled;
    if (queryParams !== undefined) mocks[mockIndex].queryParams = queryParams;
    if (bodyMatch !== undefined) mocks[mockIndex].bodyMatch = bodyMatch;
    
    // Save updated mocks to disk
    saveMocksToDisk();
    
    res.json({ 
        success: true, 
        mock: mocks[mockIndex] 
    });
});

app.delete('/mocks/:id', (req, res) => {
    const { id } = req.params;
    
    const mockIndex = mocks.findIndex(mock => mock.id === id);
    
    if (mockIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Mock not found' 
        });
    }
    
    // Remove mock from array
    const removedMock = mocks.splice(mockIndex, 1)[0];
    
    // Save updated mocks to disk
    saveMocksToDisk();
    
    res.json({ 
        success: true, 
        mock: removedMock 
    });
});

// Add this route to your proxy.js file - deprecated but kept for backward compatibility
app.post('/mocks/deactivate-all', (req, res) => {
    // This route is now deprecated and is a no-op to maintain API compatibility
    // Mocks remain enabled even during intercept mode
    console.log('mocks/deactivate-all endpoint called (deprecated, no-op)');
    
    res.json({ 
        success: true, 
        message: 'Mocks remain enabled during intercept mode'
    });
});

// Error handling middleware - Add this before the static file middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
        success: false, 
        error: err.message || 'Internal server error' 
    });
});

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)){
    fs.mkdirSync(publicDir);
}

// Create SSL directory if HTTPS is enabled
if (useHttps && !fs.existsSync('./ssl')) {
    fs.mkdirSync('./ssl');
    console.log('Created SSL directory. Please add key.pem and cert.pem files.');
}

// Serve static files BEFORE API routes
app.use(express.static(path.join(__dirname, 'public')));

// Main dashboard page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store logs in memory (limited to recent logs to avoid memory issues)
const MAX_LOGS = 1000;
let requestLogs = [];

// Add a dedicated endpoint for fetching log details without logging 
app.get('/log-details', (req, res) => {
    const { url, method } = req.query;
    
    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'URL parameter is required'
        });
    }
    
    console.log(`[Details View] Fetching details for ${method || 'GET'} ${url} (not logged)`);
    
    // Normalize the URL path
    let targetUrl = url;
    if (!targetUrl.startsWith('/')) {
        targetUrl = '/' + targetUrl;
    }
    
    // Create the full target URL
    const fullTargetUrl = `${API_SERVICE_URL}${targetUrl}`;
    console.log(`[Details View] Proxying to: ${fullTargetUrl}`);
    
    // Make a direct request to the target API using axios
    axios({
        method: method || 'GET',
        url: fullTargetUrl,
        headers: {
            ...CUSTOM_HEADERS,
            'X-Detail-View': 'true'
        },
        validateStatus: () => true, // Accept any status code
        timeout: 10000 // 10 second timeout
    })
    .then(response => {
        console.log(`[Details View] Response received: ${response.status}`);
        res.status(response.status).send(response.data);
    })
    .catch(error => {
        console.error('[Details View] Error:', error.message);
        
        // Handle different error types
        if (error.response) {
            // The server responded with a status code outside of 2xx
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            // The request was made but no response was received
            res.status(502).json({
                error: 'Bad Gateway',
                message: 'No response received from target API'
            });
        } else {
            // Something happened in setting up the request
            res.status(500).json({
                error: 'Internal Server Error',
                message: error.message
            });
        }
    });
});

// Add this at the top of your proxy.js file
app.use((req, res, next) => {
    console.log(`[DEBUG] Received request: ${req.method} ${req.url}`);
    next();
});

// Add endpoint for updating intercept mode
app.post('/update-intercept', (req, res) => {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
        return res.status(400).json({ 
            success: false, 
            error: 'Enabled flag must be provided'
        });
    }

    try {
        // Update intercept mode without affecting mocks
        interceptQueue.setInterceptionEnabled(enabled);
        
        console.log(`Intercept mode ${enabled ? 'enabled' : 'disabled'}`);
        
        res.json({ 
            success: true, 
            message: `Intercept mode ${enabled ? 'enabled (mocks disabled)' : 'disabled (mocks enabled)'}`,
            mocksActive: !enabled  // Add flag to indicate mocks status
        });
    } catch (error) {
        console.error('Error updating intercept mode:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add endpoint to get intercepted requests
app.get('/intercepted-requests', (req, res) => {
    try {
        const requests = interceptQueue.getPendingRequests();
        res.json({ 
            success: true, 
            requests 
        });
    } catch (error) {
        console.error('Error getting intercepted requests:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add endpoint to forward intercepted request
app.post('/forward-request/:id', (req, res) => {
    const { id } = req.params;
    
    try {
        // Get the modified request data if provided
        const modifiedData = req.body;
        
        // Get the request from queue
        const originalRequest = interceptQueue.getRequest(id);
        
        if (!originalRequest) {
            return res.status(404).json({
                success: false,
                error: `Request with ID ${id} not found`
            });
        }
        
        // Apply any modifications if provided
        if (modifiedData) {
            if (modifiedData.url) originalRequest.url = modifiedData.url;
            if (modifiedData.status) originalRequest.status = modifiedData.status;
            if (modifiedData.headers) {
                // Only update non-internal headers
                Object.entries(modifiedData.headers).forEach(([key, value]) => {
                    if (!key.startsWith('_')) {
                        originalRequest.headers[key] = value;
                    }
                });
            }
            if (modifiedData.body) originalRequest.body = modifiedData.body;
        }
        
        // Forward the request
        interceptQueue.forwardRequest(id);
        
        res.json({ 
            success: true, 
            message: `Request ${id} forwarded` 
        });
    } catch (error) {
        console.error('Error forwarding request:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Setup proxy middleware function
function setupProxyMiddleware() {
    // Remove existing proxy middleware
    app._router.stack = app._router.stack.filter(layer => {
        return layer.name !== 'proxyMiddleware';
    });

    console.log('Setting up proxy middleware to target:', API_SERVICE_URL);

    // Add middleware to check for mocks before proxying
    app.use((req, res, next) => {
        // Skip checking for mocks for the dashboard and API routes we added
        if (req.path.startsWith('/mocks') || 
            req.path === '/' || 
            req.path === '/info' || 
            req.path === '/update-target' ||
            req.path === '/update-headers' ||
            req.path === '/update-cache' ||
            req.path === '/reset-stats' ||
            req.path === '/clear-cache' ||
            req.path === '/update-intercept' ||
            req.path === '/intercepted-requests' ||
            req.path.startsWith('/forward-request/') ||
            req.path.startsWith('/dashboard') ||
            req.path.startsWith('/test-proxy')) {
            return next();
        }

        // Skip logging for detail view requests
        if (req.query._viewDetails === 'true' || req.headers['x-log-details-view'] === 'true') {
            console.log('Skipping log for details view:', req.method, req.url);
            return next();
        }

        // Check if intercept mode is enabled
        if (interceptQueue.isInterceptionEnabled()) {
            console.log(`Intercepting request: ${req.method} ${req.url}`);
            
            // Intercept the request and broadcast the interception
            return interceptQueue.intercept(req, res, next, (interceptId) => {
                // Prepare intercepted request data to send to clients
                const interceptData = {
                    interceptionId: interceptId,
                    timestamp: new Date().toISOString(),
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: req.body
                };
                
                // Broadcast the intercepted request to WebSocket clients
                broadcastLog(interceptData);
            });
        }

        // Log the request regardless if it's mocked or actual
        const timestamp = new Date().toISOString();
        requestStats.total++;
        const method = req.method;
        requestStats.methods[method] = (requestStats.methods[method] || 0) + 1;
        
        // Prepare log data that will be updated with status later
        const logData = {
            timestamp,
            method: req.method,
            url: req.url,
            userAgent: req.headers['user-agent']
        };

        // Check if we have a mock for this path and method
        // Only check for mocks if intercept mode is disabled
        const matchingMock = mocks.find(mock => {
            // Skip disabled mocks
            if (!mock.enabled) return false;
            
            // Check if method matches (default to GET if not specified)
            if (mock.method && mock.method !== req.method) return false;
            
            // Match exact path or with wildcard support
            const pathMatches = mock.path === req.path || 
                (mock.path.endsWith('*') && req.path.startsWith(mock.path.slice(0, -1)));
            
            if (!pathMatches) return false;
            
            // Check query parameters if defined
            if (mock.queryParams && mock.queryParams.length > 0) {
                // Get query parameters from the request
                const urlObj = new URL(req.url, `http://${req.headers.host}`);
                const queryParams = urlObj.searchParams;
                
                // Check if all required query parameters match
                for (const param of mock.queryParams) {
                    if (param.key) {
                        const paramValue = queryParams.get(param.key);
                        // If value is specified, it must match exactly
                        if (param.value && paramValue !== param.value) {
                            return false;
                        }
                        // If no value but key is required
                        if (!param.value && !paramValue) {
                            return false;
                        }
                    }
                }
            }
            
            // Check request body for POST/PUT/PATCH
            if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && 
                mock.bodyMatch && Object.keys(mock.bodyMatch).length > 0) {
                
                // Compare request body with expected body
                for (const [key, value] of Object.entries(mock.bodyMatch)) {
                    if (!req.body || req.body[key] !== value) {
                        return false;
                    }
                }
            }
            
            return true;
        });

        if (matchingMock) {
            console.log(`Mocking response for: ${req.method} ${req.path}`);
            
            // Update status code stats
            const statusCode = matchingMock.statusCode.toString();
            requestStats.statusCodes[statusCode] = (requestStats.statusCodes[statusCode] || 0) + 1;
            
            // Pretty format the JSON response
            let formattedResponse;
            try {
                formattedResponse = JSON.stringify(matchingMock.responseBody, null, 2);
            } catch (e) {
                formattedResponse = '[Error formatting response]';
            }
            
            // Update log data with status, mocked flag, and formatted response body
            logData.status = matchingMock.statusCode;
            logData.mocked = true;
            logData.responseBody = formattedResponse; // Include the formatted response body
            
            // Broadcast the log
            broadcastLog(logData);
            
            // Return the mock response
            return res.status(matchingMock.statusCode).json(matchingMock.responseBody);
        }
        
        // Store the original end method to intercept it
        const originalEnd = res.end;
        
        // Override the end method to capture the response status
        res.end = function(chunk, encoding) {
            // Update the log data with actual response status
            logData.status = res.statusCode;
            logData.mocked = false;
            
            // Broadcast the complete log
            broadcastLog(logData);
            
            // Call the original end method
            return originalEnd.call(this, chunk, encoding);
        };
        
        // No mock found, continue to proxy
        next();
    });

    // Setup proxy middleware
    const options = {
        target: API_SERVICE_URL,
        changeOrigin: true,
        logLevel: 'debug',
        onProxyReq: (proxyReq, req, res) => {
            console.log('Proxying request to:', API_SERVICE_URL + proxyReq.path);
            
            // Add custom headers to the proxied request
            Object.keys(CUSTOM_HEADERS).forEach(key => {
                proxyReq.setHeader(key, CUSTOM_HEADERS[key]);
            });

            // Update request stats
            requestStats.total++;
            const method = req.method;
            requestStats.methods[method] = (requestStats.methods[method] || 0) + 1;

            const timestamp = new Date().toISOString();
            const logData = {
                timestamp,
                method: req.method,
                url: req.url,
                userAgent: req.headers['user-agent']
            };
            broadcastLog(logData);
        },
        onProxyRes: (proxyRes, req, res) => {
            console.log('Response received:', proxyRes.statusCode, req.url);
            
            // Create a buffer to collect response data
            let responseBody = [];
            
            // Listen for data chunks
            proxyRes.on('data', (chunk) => {
                responseBody.push(chunk);
            });
            
            // When response is complete
            proxyRes.on('end', () => {
                // Update status code stats
                const statusCode = proxyRes.statusCode.toString();
                requestStats.statusCodes[statusCode] = (requestStats.statusCodes[statusCode] || 0) + 1;
                
                // Process the response body
                let parsedBody = '';
                try {
                    // Combine chunks into a buffer and convert to string
                    const bodyBuffer = Buffer.concat(responseBody);
                    const bodyString = bodyBuffer.toString('utf8');
                    
                    // Try to parse as JSON if possible
                    try {
                        const contentType = proxyRes.headers['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            // For JSON, parse then stringify with formatting
                            const jsonObj = JSON.parse(bodyString);
                            parsedBody = JSON.stringify(jsonObj, null, 2);
                        } else {
                            // For non-JSON, just use the string
                            parsedBody = bodyString;
                        }
                    } catch (e) {
                        // If JSON parsing fails, use the raw string
                        parsedBody = bodyString;
                    }
                    
                    // If the body is too large, truncate it
                    if (parsedBody.length > 10000) {
                        parsedBody = parsedBody.substring(0, 10000) + '... [truncated]';
                    }
                } catch (error) {
                    console.error('Error processing response body:', error);
                    parsedBody = '[Error processing response body]';
                }
                
                // Create log data with response body included
                const logData = {
                    timestamp: new Date().toISOString(),
                    method: req.method,
                    url: req.url,
                    status: proxyRes.statusCode,
                    responseBody: parsedBody // Include the parsed response body
                };
                
                // Broadcast the log with response body
                broadcastLog(logData);
            });
        },
        onError: (err, req, res) => {
            console.error('Proxy error:', err);
            requestStats.errors++;
            
            const logData = {
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.url,
                status: 500,
                error: err.message
            };
            broadcastLog(logData);
            
            // Send error response
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: 'Proxy error',
                    message: err.message 
                });
            }
        }
    };

    // Define API routes that already exist and should NOT be redefined
    // Mount the proxy middleware to handle ALL other routes
    const proxy = createProxyMiddleware(options);
    app.use('/', proxy);
    
    // Test the proxy endpoints directly
    if (API_SERVICE_URL.includes('jsonplaceholder')) {
        app.get('/direct-test-posts', async (req, res) => {
            try {
                const url = `${API_SERVICE_URL}/posts`;
                console.log('Directly testing:', url);
                const response = await axios.get(url);
                console.log('Direct posts test successful:', response.status);
                res.json(response.data.slice(0, 5)); // Just the first 5 posts
            } catch (error) {
                console.error('Direct test failed:', error.message);
                res.status(500).json({ error: error.message });
            }
        });
    }
}

// Update broadcastLog function to store logs in memory
function broadcastLog(logData) {
    if (!logData || typeof logData !== 'object') {
        console.error('Invalid log data:', logData);
        return;
    }
    
    // Ensure timestamp exists
    if (!logData.timestamp) {
        logData.timestamp = new Date();
    }
    
    // Sanitize log data to avoid circular references and non-serializable values
    const sanitizedLogData = JSON.parse(JSON.stringify(logData));
    
    // Store log in memory (up to MAX_LOGS)
    requestLogs.unshift(sanitizedLogData); // Add to the beginning
    if (requestLogs.length > MAX_LOGS) {
        requestLogs.pop(); // Remove oldest log
    }
    
    // Convert to string if needed
    const logMessage = JSON.stringify(sanitizedLogData);
    
    let activeClients = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(logMessage);
                activeClients++;
            } catch (error) {
                console.error('Error sending log to WebSocket client:', error);
            }
        }
    });
    
    // Log to console if no clients are connected
    if (activeClients === 0) {
        const mockedStatus = sanitizedLogData.mocked ? ' [MOCKED]' : '';
        console.log('Log (no WebSocket clients):', 
            `${new Date(sanitizedLogData.timestamp).toLocaleTimeString()} ${sanitizedLogData.method} ${sanitizedLogData.url} ${sanitizedLogData.status}${mockedStatus}`);
    }
}

// Add endpoint to save logs
app.post('/save-logs', (req, res) => {
    try {
        // Check if there are logs to save
        if (requestLogs.length === 0) {
            return res.json({
                success: false,
                message: 'No logs to save',
                error: 'No logs have been captured yet'
            });
        }
        
        // Generate a filename with current date and time
        const now = new Date();
        const timestamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const filename = `logs_${timestamp}.json`;
        const filePath = path.join(dataDir, filename);
        
        console.log(`Saving ${requestLogs.length} logs to ${filePath}`);
        
        // Create a log object with metadata
        const logExport = {
            metadata: {
                exportedAt: now.toISOString(),
                count: requestLogs.length,
                target: API_SERVICE_URL
            },
            logs: requestLogs
        };
        
        // Write logs to file
        fs.writeFileSync(filePath, JSON.stringify(logExport, null, 2));
        console.log(`Logs saved successfully to ${filename}`);
        
        res.json({
            success: true,
            message: `Saved ${requestLogs.length} logs to ${filename}`,
            filename: filename
        });
    } catch (error) {
        console.error('Error saving logs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add endpoint to get saved logs files
app.get('/log-files', (req, res) => {
    try {
        const logFiles = fs.readdirSync(dataDir)
            .filter(file => file.startsWith('logs_') && file.endsWith('.json'))
            .map(file => {
                const filePath = path.join(dataDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    timestamp: file.replace('logs_', '').replace('.json', ''),
                    size: stats.size,
                    createdAt: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json({
            success: true,
            logFiles: logFiles
        });
    } catch (error) {
        console.error('Error getting log files:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add endpoint to download a specific log file
app.get('/download-logs/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(dataDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Log file not found'
            });
        }
        
        res.download(filePath);
    } catch (error) {
        console.error('Error downloading log file:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Initial proxy middleware setup
setupProxyMiddleware();

// Clean up old sessions every hour
setInterval(() => {
    const now = new Date();
    const hour = 60 * 60 * 1000;
    
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActive > hour) {
            sessions.delete(sessionId);
        }
    }
}, 60 * 60 * 1000);

// Start the Proxy
server.listen(PORT, HOST, () => {
    console.log(`Starting Proxy at ${HOST}:${PORT}`);
    console.log(`Proxy Target: ${API_SERVICE_URL}`);
    
    // Open browser automatically
    const protocol = useHttps ? 'https' : 'http';
    const url = `${protocol}://${HOST}:${PORT}`;
    console.log(`Opening browser at: ${url}`);
    
    // Use platform-specific commands to open the browser
    const { exec } = require('child_process');
    const command = process.platform === 'darwin' ? `open "${url}"` : 
                  process.platform === 'win32' ? `start "${url}"` : 
                  `xdg-open "${url}"`;
    
    exec(command, (error) => {
        if (error) {
            console.error('Failed to open browser:', error);
        }
    });
});

// Export for testing
module.exports = { app, server };

// Setup Instructions:
// 1. Create proxy-server directory and cd into it
// 2. Run npm init -y
// 3. Install dependencies: npm install express morgan http-proxy-middleware ws
// 4. Create directory structure:
//    proxy-server/
//    ├── proxy.js
//    └── public/
//        ├── index.html
//        ├── styles.css
//        └── script.js
// 5. Create public/index.html with basic dashboard UI
// 6. Add CSS styling in public/styles.css
// 7. Start proxy: node proxy.js
// 8. Access at http://localhost:3333
// 
// Usage:
// - Dashboard: http://localhost:3333
// - Status endpoint: http://localhost:3333/info  
// - API requests: http://localhost:3333/api/* -> proxied to https://api.uat.aks1.io/*

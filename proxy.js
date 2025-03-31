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

// Load environment variables from .env file
dotenv.config();

// Create app and server
const app = express();
const useHttps = process.env.USE_HTTPS === 'true';
let server;

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

// Configuration
let PORT = parseInt(process.env.PORT) || 3333;
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
        customHeaders: CUSTOM_HEADERS,
        stats: requestStats
    });
});

// Add a direct test endpoint
app.get('/test-proxy', async (req, res) => {
    try {
        console.log('Testing JSONPlaceholder directly...');
        const response = await axios.get(API_SERVICE_URL + '/posts/1');
        console.log('Direct test successful:', response.status);
        res.json({
            success: true,
            status: response.status,
            data: response.data
        });
    } catch (error) {
        console.error('Direct test failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
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

// Update port
app.post('/update-port', authMiddleware, (req, res) => {
    const { port, isNewInstance } = req.body;
    if (!port || port < 1 || port > 65535) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(400).json({ success: false, error: 'Invalid port number' });
    }

    const newPort = parseInt(port);
    if (newPort === PORT && !isNewInstance) {
        res.setHeader('Content-Type', 'application/json');
        return res.json({ success: true });
    }

    // Send response before closing the server
    res.setHeader('Content-Type', 'application/json');
    res.json({ 
        success: true, 
        message: isNewInstance ? `New instance will start on port ${newPort}` : `Server will restart on port ${newPort}`,
        newPort: newPort
    });

    if (!isNewInstance) {
        // Close existing server after sending response
        setTimeout(() => {
            server.close(() => {
                PORT = newPort;
                // Start server on new port
                server.listen(PORT, HOST, () => {
                    console.log(`Server restarted on port ${PORT}`);
                });
            });
        }, 100);
    } else {
        // Start a new instance
        const { spawn } = require('child_process');
        const scriptPath = path.resolve(__dirname, 'proxy.js');
        
        // Create a new process with the specified port
        const newServer = spawn('node', [scriptPath], {
            env: { ...process.env, PORT: newPort.toString() },
            stdio: 'inherit', // This will show logs in the parent process
            detached: true, // Run in the background
            cwd: __dirname // Ensure working directory is correct
        });

        // Unref the child process so parent can exit independently
        newServer.unref();

        console.log(`Started new instance on port ${newPort}`);
        
        // Wait a bit to ensure the new instance has started
        setTimeout(() => {
            // Open the new instance URL
            const { exec } = require('child_process');
            const protocol = useHttps ? 'https' : 'http';
            const url = `${protocol}://${HOST}:${newPort}`;
            const command = process.platform === 'darwin' ? `open "${url}"` : 
                          process.platform === 'win32' ? `start "${url}"` : 
                          `xdg-open "${url}"`;
            
            exec(command, (error) => {
                if (error) {
                    console.error('Error opening browser:', error);
                }
            });
        }, 1000);
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

// Setup proxy middleware function
function setupProxyMiddleware() {
    // Remove existing proxy middleware
    app._router.stack = app._router.stack.filter(layer => {
        return layer.name !== 'proxyMiddleware';
    });

    console.log('Setting up proxy middleware to target:', API_SERVICE_URL);

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
            
            // Update status code stats
            const statusCode = proxyRes.statusCode.toString();
            requestStats.statusCodes[statusCode] = (requestStats.statusCodes[statusCode] || 0) + 1;
            
            const logData = {
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.url,
                status: proxyRes.statusCode
            };
            broadcastLog(logData);
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

// Broadcast log to all connected WebSocket clients
function broadcastLog(logData) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(logData));
        }
    });
}

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

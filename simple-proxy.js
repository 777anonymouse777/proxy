const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Simple endpoint to check if server is running
app.get('/test', (req, res) => {
  res.send('Proxy server is running');
});

// Configure the proxy middleware
const apiProxy = createProxyMiddleware({
  target: 'https://jsonplaceholder.typicode.com',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '',  // remove /api prefix
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('Proxying request:', req.method, req.url, '→', proxyReq.path);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('Received response:', proxyRes.statusCode, req.url);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy Error: ' + err.message);
  }
});

// Use the proxy middleware for all routes with /api prefix
app.use('/api', apiProxy);

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Simple proxy server running on http://localhost:${PORT}`);
  console.log(`Test the proxy with: http://localhost:${PORT}/api/posts`);
}); 
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 5000; // Different port to avoid conflicts

// Simple test endpoint
app.get('/hello', (req, res) => {
  res.send('Server is running');
});

// Configure proxy
const jsonProxy = createProxyMiddleware({
  target: 'https://jsonplaceholder.typicode.com',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Request: ${req.method} ${req.url} -> ${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Response: ${proxyRes.statusCode} for ${req.url}`);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// Mount proxy - NO PATH REWRITE
app.use('/api', jsonProxy);

// Start server
app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/api/posts`);
  console.log(`Or: http://localhost:${PORT}/hello to test server`);
}); 
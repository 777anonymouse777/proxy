const request = require('supertest');
const { app } = require('../proxy');
const fs = require('fs');
const path = require('path');

// Ensure test directory exists for .env.test
const testEnvPath = path.join(__dirname, '../.env.test');
if (!fs.existsSync(testEnvPath)) {
  fs.writeFileSync(testEnvPath, `
PORT=3334
HOST=localhost
API_SERVICE_URL=https://mockapi.example.com
USE_HTTPS=false
ADMIN_USER=testadmin
ADMIN_PASSWORD=testpass
ENABLE_CACHE=true
CACHE_DURATION=1 minute
CUSTOM_HEADERS={"X-Test-Header":"test-value"}
`);
}

describe('Proxy Server', () => {
  test('GET /info returns proxy information', async () => {
    const response = await request(app).get('/info');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('target');
    expect(response.body).toHaveProperty('port');
  });

  test('POST /update-target works without authentication', async () => {
    const response = await request(app)
      .post('/update-target')
      .send({ target: 'https://newapi.example.com' });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });

  test('POST /update-headers works without authentication', async () => {
    const response = await request(app)
      .post('/update-headers')
      .send({ headers: { 'X-Custom-Header': 'test-value' } });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });
}); 
const request = require('supertest');
const Server = require('../src/server');
const database = require('../src/config/database');
// AI Service is not directly used by /health or /health/live, but server initializes it.
// If its direct mock is an issue, we can make it more generic.
const aiService = require('../src/services/ai.service');
const logger = require('../src/utils/logger');

// Mock the logger to prevent console output during tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
}));

// Mock database module - /health and /health/live don't directly use DB,
// but server init might.
jest.mock('../src/config/database', () => ({
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
  isHealthy: jest.fn().mockResolvedValue(true), // Default to healthy for server init
  getConnectionState: jest.fn().mockReturnValue('connected'), // Default to connected
}));

// Mock AI Service - /health and /health/live don't directly use AI,
// but server init might.
jest.mock('../src/services/ai.service', () => ({
  healthCheck: jest.fn().mockResolvedValue({ healthy: true, provider: 'mockAI' }),
}));

describe('Basic Health Check Endpoints', () => {
  let app;

  beforeAll(() => {
    // Set necessary environment variables for server initialization
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-for-basic-health-tests';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost/test/callback';
    process.env.AI_PROVIDER = 'groq'; // Or any default that ai.config.js expects
    process.env.GROQ_API_KEY = 'test-groq-api-key'; // Corresponding key

    const server = new Server();
    app = server.app;
  });

  afterAll(async () => {
    // If there's a global server instance started by `server.start()` that listens, close it.
    // For now, assuming `app` doesn't need explicit server closing for these tests.
    // await database.disconnect(); // Mocked, but good practice if it were real
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- GET /api/v1/health ---
  describe('GET /api/v1/health', () => {
    it('should return 200 OK with basic health information', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('OK');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('version');
      expect(response.body.data).toHaveProperty('nodeVersion');
      expect(response.body.data).toHaveProperty('environment');
      expect(response.body.message).toBe('Service is healthy and operational.');
    });
  });

  // --- GET /api/v1/health/live ---
  describe('GET /api/v1/health/live (Liveness Probe)', () => {
    it('should return 200 OK indicating the service is alive', async () => {
      const response = await request(app).get('/api/v1/health/live');
      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      // Based on the controller's actual response for livenessProbe
      expect(response.body.message).toBe('Service is alive');
      expect(response.body).toHaveProperty('timestamp');
      // The controller's livenessProbe returns: { success: true, message: 'Service is alive', timestamp: new Date().toISOString() }
      // It does not have a 'status: ALIVE' field in the body directly, but in the message.
      // If a 'status' field is desired, the controller would need to be updated.
      // For now, testing against actual current output.
    });
  });
});

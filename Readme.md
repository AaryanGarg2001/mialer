# Email Summarizer Backend

A Node.js backend service for persona-driven email summarization using AI. This service integrates with Gmail API to fetch emails, processes them using AI models, and generates personalized daily summaries based on user personas.

## Features

- **Gmail Integration**: OAuth2 authentication and Gmail API integration
- **AI-Powered Summarization**: Support for OpenAI GPT and Anthropic Claude
- **Persona-Driven Filtering**: Personalized email prioritization and summarization
- **Daily Scheduling**: Automated daily summary generation
- **Health Monitoring**: Comprehensive health checks and monitoring
- **Secure & Scalable**: Built with security best practices and scalability in mind

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Google OAuth2, JWT
- **AI Services**: OpenAI GPT / Anthropic Claude
- **Logging**: Winston
- **Security**: Helmet, CORS, Rate Limiting

## Project Structure

```
src/
├── controllers/     # Request handlers
├── middleware/      # Custom middleware
├── models/         # Database models
├── routes/         # API routes
├── services/       # Business logic services
├── config/         # Configuration files
├── utils/          # Utility functions
├── jobs/           # Scheduled jobs
└── server.js       # Application entry point
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- MongoDB instance
- Google OAuth2 credentials
- OpenAI or Anthropic API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd email-summarizer-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Verify the installation**
   ```bash
   curl http://localhost:3000/api/v1/health
   # Note: Default port is 3000, API_PREFIX is /api/v1 by default. Adjust if you changed them.
   ```

## Environment Configuration

### Required Environment Variables

```bash
# Server
NODE_ENV=development
PORT=3000
HOST=localhost # Optional: defaults to localhost
API_PREFIX=/api/v1 # Optional: defaults to /api/v1

# Database
MONGODB_URI=mongodb://localhost:27017/email_summarizer
MONGODB_TEST_URI=mongodb://localhost:27017/email_summarizer_test # For running tests

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Google OAuth2
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# AI Service (choose one)
OPENAI_API_KEY=your-openai-api-key
# OR
ANTHROPIC_API_KEY=your-anthropic-api-key
# AI_PROVIDER can be 'groq', 'openai', 'anthropic', 'huggingface'. Defaults to 'groq'.
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key # Required if AI_PROVIDER is 'groq'
```

### Optional Configuration

```bash
# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Email Processing
DAILY_SUMMARY_TIME=08:00
MAX_EMAILS_PER_SUMMARY=10

# CORS
ALLOWED_ORIGINS=http://localhost:3000
```

## API Endpoints

All API endpoints are prefixed with `/api/v1` (or your `API_PREFIX` environment variable).

- **Root**: `GET /api/v1/` - Provides basic API information and links.
- **API Documentation**: `GET /api/v1/api-docs` - Offers a list of available modules and their base paths. This should be consulted for detailed endpoint information.
- **Health Checks**: `GET /api/v1/health/*` - Includes various health check endpoints like:
    - `GET /api/v1/health` (basic)
    - `GET /api/v1/health/detailed` (dependencies and system info)
    - `GET /api/v1/health/ready` (Kubernetes readiness)
    - `GET /api/v1/health/live` (Kubernetes liveness)
- **Authentication**: `GET /api/v1/auth/*` - Endpoints for user authentication, including Gmail OAuth.
- **AI Services**: `POST /api/v1/ai/*` - Endpoints for AI-driven tasks like summarization and Q&A.
- **Email Management**: `GET /api/v1/emails/*`, `POST /api/v1/emails/*` - Endpoints for email processing, retrieval, and summaries.
- **Persona Management**: `GET /api/v1/persona/*`, `POST /api/v1/persona/*` - Endpoints for managing user personas.

For a comprehensive and up-to-date list of all endpoints, please refer to the self-documenting endpoint at `/api/v1/api-docs` once the server is running.

## Development

### Scripts

```bash
npm run dev        # Start development server with nodemon
npm start          # Start production server
npm test           # Run tests
npm run lint       # Run ESLint
npm run lint:fix   # Fix ESLint issues
```

### Code Quality

The project follows these standards:

- **ESLint**: Airbnb JavaScript style guide
- **Logging**: Structured logging with Winston
- **Error Handling**: Centralized error handling
- **Security**: Helmet, CORS, rate limiting
- **Validation**: Joi schema validation (to be implemented)

### Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode for tests
```

## Docker Support

### Build and run with Docker

```bash
# Build the image
npm run docker:build

# Run the container
npm run docker:run
```

### Docker Compose

```bash
docker-compose up -d
```

## Monitoring and Health Checks

The service provides comprehensive health monitoring:

- **Basic Health**: Service status and uptime
- **Detailed Health**: Memory usage, database connectivity, service configuration
- **Database Health**: MongoDB connection status
- **Readiness Probe**: For Kubernetes deployments
- **Liveness Probe**: For container orchestration

## Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing configuration
- **Rate Limiting**: Prevents abuse
- **JWT Authentication**: Secure token-based auth
- **Input Validation**: Request validation middleware
- **Error Handling**: Secure error responses (no stack traces in production)

## Logging

The application uses Winston for structured logging:

- **Development**: Console output with colors
- **Production**: File logging with rotation
- **HTTP Requests**: Morgan integration
- **Error Tracking**: Comprehensive error logging

## Next Steps

This is the foundational setup. Next implementations will include:

1. **Authentication System**: Google OAuth2 integration
2. **Gmail Service**: Email fetching and processing
3. **AI Integration**: OpenAI/Anthropic API integration
4. **User Management**: User profiles and persona management
5. **Scheduling**: Daily summary job implementation
6. **Email Processing**: Filtering and summarization logic

## Contributing

1. Fork the repository
2. Create a feature branch
3. Follow the code style guidelines
4. Add tests for new features
5. Submit a pull request

## License

MIT License - see LICENSE file for details
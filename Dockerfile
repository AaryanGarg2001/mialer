# Multi-stage Dockerfile for Node.js application

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Create app user and group for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Create app user and group for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Copy node_modules from builder stage
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=appuser:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown -R appuser:nodejs logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "src/server.js"]
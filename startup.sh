#!/bin/bash

# Email Summarizer Service Startup Script

echo "🚀 Starting Email Summarizer Backend Service..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Check if MongoDB is running
echo "📊 Checking MongoDB connection..."
if ! mongosh --eval "db.adminCommand('ping')" --quiet > /dev/null 2>&1; then
    echo "❌ Error: MongoDB is not running or not accessible!"
    echo "Please start MongoDB service first."
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Check environment variables
echo "🔧 Validating environment configuration..."
node -e "
const requiredVars = [
    'JWT_SECRET', 
    'GOOGLE_CLIENT_ID', 
    'GOOGLE_CLIENT_SECRET',
    'MONGODB_URI'
];

const missing = requiredVars.filter(key => !process.env[key]);
if (missing.length > 0) {
    console.log('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
}

const aiProvider = process.env.AI_PROVIDER || 'groq';
const aiKeys = {
    groq: 'GROQ_API_KEY',
    openai: 'OPENAI_API_KEY', 
    anthropic: 'ANTHROPIC_API_KEY'
};

if (aiKeys[aiProvider] && !process.env[aiKeys[aiProvider]]) {
    console.log(\`❌ Missing AI API key: \${aiKeys[aiProvider]} for provider: \${aiProvider}\`);
    process.exit(1);
}

console.log('✅ Environment configuration valid');
"

# Start the service
echo "🌟 Starting development server..."
if [ "$1" == "prod" ]; then
    echo "🚀 Starting in production mode..."
    npm start
else
    echo "🔧 Starting in development mode..."
    npm run dev
fi
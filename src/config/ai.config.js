const axios = require('axios');
const logger = require('../utils/logger');

class AIConfig {
  constructor() {
    // Primary provider (Groq - Free and fast)
    this.primaryProvider = process.env.AI_PROVIDER || 'groq';
    
    // API configurations
    this.providers = {
      groq: {
        name: 'Groq',
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
        models: {
          fast: 'llama3-8b-8192',      // Fast responses, good for simple summaries
          balanced: 'llama3-70b-8192',  // Better quality, more detailed
          coding: 'llama3-8b-8192',     // Good for technical emails
        },
        defaultModel: 'llama3-8b-8192',
        maxTokens: 8192,
        temperature: 0.1, // Low temperature for consistent summaries
        rateLimit: {
          requestsPerMinute: 30,
          requestsPerDay: 14400, // Very generous free tier
        },
      },
      openai: {
        name: 'OpenAI',
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
        models: {
          fast: 'gpt-3.5-turbo',
          balanced: 'gpt-4',
          coding: 'gpt-3.5-turbo',
        },
        defaultModel: 'gpt-3.5-turbo',
        maxTokens: 4096,
        temperature: 0.1,
        rateLimit: {
          requestsPerMinute: 3, // OpenAI has stricter limits
          requestsPerDay: 200,
        },
      },
      huggingface: {
        name: 'Hugging Face',
        apiKey: process.env.HUGGINGFACE_API_KEY,
        baseURL: 'https://api-inference.huggingface.co/models',
        models: {
          fast: 'microsoft/DialoGPT-medium',
          balanced: 'facebook/blenderbot-400M-distill',
          summarization: 'facebook/bart-large-cnn', // Specialized for summarization
        },
        defaultModel: 'facebook/bart-large-cnn',
        maxTokens: 1024,
        temperature: 0.1,
        rateLimit: {
          requestsPerMinute: 10,
          requestsPerDay: 1000,
        },
      },
      anthropic: {
        name: 'Anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: 'https://api.anthropic.com/v1',
        models: {
          fast: 'claude-3-haiku-20240307',
          balanced: 'claude-3-sonnet-20240229',
          advanced: 'claude-3-opus-20240229',
        },
        defaultModel: 'claude-3-haiku-20240307',
        maxTokens: 4096,
        temperature: 0.1,
        rateLimit: {
          requestsPerMinute: 5,
          requestsPerDay: 1000,
        },
      },
    };

    // Validate configuration
    this.validateConfig();
  }

  validateConfig() {
    const provider = this.providers[this.primaryProvider];
    
    if (!provider) {
      logger.error(`Invalid AI provider: ${this.primaryProvider}`);
      throw new Error(`Unsupported AI provider: ${this.primaryProvider}`);
    }

    if (!provider.apiKey) {
      logger.error(`Missing API key for ${provider.name}`);
      throw new Error(`Missing API key for ${provider.name}. Set ${this.primaryProvider.toUpperCase()}_API_KEY environment variable.`);
    }

    logger.info(`AI provider configured successfully: ${provider.name}`);
  }

  getCurrentProvider() {
    return this.providers[this.primaryProvider];
  }

  /**
   * Create HTTP client for AI API calls
   */
  createHttpClient(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    const client = axios.create({
      baseURL: provider.baseURL,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EmailSummarizer/1.0.0',
      },
    });

    // Add authentication based on provider
    if (providerName === 'groq' || providerName === 'openai' || !providerName) {
      client.defaults.headers['Authorization'] = `Bearer ${provider.apiKey}`;
    } else if (providerName === 'huggingface') {
      client.defaults.headers['Authorization'] = `Bearer ${provider.apiKey}`;
    } else if (providerName === 'anthropic') {
      client.defaults.headers['x-api-key'] = provider.apiKey;
      client.defaults.headers['anthropic-version'] = '2023-06-01';
    }

    // Add request/response interceptors for logging
    client.interceptors.request.use(
      (config) => {
        logger.debug('AI API request', {
          provider: provider.name,
          url: config.url,
          method: config.method,
        });
        return config;
      },
      (error) => {
        logger.error('AI API request error:', error);
        return Promise.reject(error);
      }
    );

    client.interceptors.response.use(
      (response) => {
        logger.debug('AI API response received', {
          provider: provider.name,
          status: response.status,
          tokensUsed: response.data?.usage?.total_tokens || 'unknown',
        });
        return response;
      },
      (error) => {
        logger.error('AI API response error:', {
          provider: provider.name,
          status: error.response?.status,
          message: error.response?.data?.error?.message || error.message,
        });
        return Promise.reject(error);
      }
    );

    return client;
  }

  /**
   * Get model configuration for specific use case
   */
  getModelConfig(useCase = 'balanced', providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    const modelConfigs = {
      fast: {
        model: provider.models.fast || provider.defaultModel,
        maxTokens: Math.min(512, provider.maxTokens),
        temperature: 0.1,
      },
      balanced: {
        model: provider.models.balanced || provider.defaultModel,
        maxTokens: Math.min(1024, provider.maxTokens),
        temperature: 0.1,
      },
      detailed: {
        model: provider.models.balanced || provider.defaultModel,
        maxTokens: Math.min(2048, provider.maxTokens),
        temperature: 0.2,
      },
      creative: {
        model: provider.models.balanced || provider.defaultModel,
        maxTokens: Math.min(1024, provider.maxTokens),
        temperature: 0.7,
      },
    };

    return modelConfigs[useCase] || modelConfigs.balanced;
  }

  /**
   * Check if provider supports specific features
   */
  getProviderCapabilities(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    const capabilities = {
      groq: {
        streaming: true,
        functionCalling: false,
        imageAnalysis: false,
        codeGeneration: true,
        summarization: true,
        conversational: true,
        costEffective: true,
        fastResponse: true,
      },
      openai: {
        streaming: true,
        functionCalling: true,
        imageAnalysis: true,
        codeGeneration: true,
        summarization: true,
        conversational: true,
        costEffective: false,
        fastResponse: false,
      },
      huggingface: {
        streaming: false,
        functionCalling: false,
        imageAnalysis: false,
        codeGeneration: false,
        summarization: true,
        conversational: true,
        costEffective: true,
        fastResponse: false,
      },
      anthropic: {
        streaming: true,
        functionCalling: false,
        imageAnalysis: false,
        codeGeneration: true,
        summarization: true,
        conversational: true,
        costEffective: false,
        fastResponse: false,
      },
    };

    return capabilities[this.primaryProvider] || {};
  }

  /**
   * Get rate limit information
   */
  getRateLimit(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    return provider.rateLimit;
  }

  /**
   * Check if provider is available
   */
  async checkProviderHealth(providerName = null) {
    try {
      const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
      const client = this.createHttpClient(providerName);
      
      // Simple health check based on provider
      if (providerName === 'groq' || !providerName) {
        const response = await client.get('/models');
        return response.status === 200;
      } else if (providerName === 'openai') {
        const response = await client.get('/models');
        return response.status === 200;
      } else if (providerName === 'anthropic') {
        // Anthropic doesn't have a simple health endpoint, so we'll just check if API key is valid
        return !!provider.apiKey;
      } else if (providerName === 'huggingface') {
        // HuggingFace inference API doesn't have a health endpoint
        return !!provider.apiKey;
      }
      
      return false;
    } catch (error) {
      logger.error(`Provider health check failed for ${providerName || this.primaryProvider}:`, error.message);
      return false;
    }
  }

  /**
   * Get available models for current provider
   */
  async getAvailableModels(providerName = null) {
    try {
      const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
      
      if (providerName === 'groq' || (!providerName && this.primaryProvider === 'groq')) {
        const client = this.createHttpClient(providerName);
        const response = await client.get('/models');
        return response.data.data.map(model => ({
          id: model.id,
          name: model.id,
          contextWindow: model.context_window || 8192,
        }));
      } else {
        // Return configured models for other providers
        return Object.entries(provider.models).map(([key, value]) => ({
          id: value,
          name: key,
          contextWindow: provider.maxTokens,
        }));
      }
    } catch (error) {
      logger.error('Failed to get available models:', error);
      return Object.entries(this.getCurrentProvider().models).map(([key, value]) => ({
        id: value,
        name: key,
        contextWindow: this.getCurrentProvider().maxTokens,
      }));
    }
  }

  /**
   * Estimate token count (rough estimation)
   */
  estimateTokenCount(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if text exceeds token limit
   */
  isWithinTokenLimit(text, useCase = 'balanced', providerName = null) {
    const config = this.getModelConfig(useCase, providerName);
    const estimatedTokens = this.estimateTokenCount(text);
    
    // Leave some room for the response
    const maxInputTokens = config.maxTokens * 0.8;
    
    return estimatedTokens <= maxInputTokens;
  }

  /**
   * Truncate text to fit within token limit
   */
  truncateToTokenLimit(text, useCase = 'balanced', providerName = null) {
    const config = this.getModelConfig(useCase, providerName);
    const maxInputTokens = config.maxTokens * 0.8;
    
    if (this.isWithinTokenLimit(text, useCase, providerName)) {
      return text;
    }

    // Rough truncation based on character count
    const maxChars = maxInputTokens * 4;
    return text.substring(0, maxChars) + '...';
  }
}

module.exports = new AIConfig();
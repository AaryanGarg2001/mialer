const axios = require('axios');
const logger = require('../utils/logger');

/**
 * @file AI Provider Configuration
 * @module config/ai
 * @requires axios
 * @requires ../utils/logger
 */

/**
 * Manages AI provider configurations, API clients, and model settings.
 * Supports multiple AI providers like Groq, OpenAI, Hugging Face, and Anthropic.
 * Reads API keys and provider preferences from environment variables.
 * @class AIConfig
 */
class AIConfig {
  /**
   * Initializes the AIConfig instance.
   * Sets up available providers and validates the current configuration.
   * @constructor
   */
  constructor() {
    // Primary provider (e.g., 'groq', 'openai'). Defaults to 'groq'.
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

  /**
   * Validates the configuration for the selected primary AI provider.
   * Checks if the provider is supported and if its API key is set.
   * Throws an error if the configuration is invalid.
   * @private
   */
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

  /**
   * Gets the configuration object for the currently selected primary AI provider.
   * @returns {object} The configuration object for the primary provider.
   */
  getCurrentProvider() {
    return this.providers[this.primaryProvider];
  }

  /**
   * Creates an Axios HTTP client instance for a specific AI provider.
   * Configures base URL, timeout, and authentication headers based on the provider.
   * Includes request and response interceptors for logging.
   * @param {string} [providerName=null] - The name of the provider (e.g., 'groq', 'openai').
   *                                       Defaults to the primary provider if null.
   * @returns {import('axios').AxiosInstance} Configured Axios instance.
   */
  createHttpClient(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    const client = axios.create({
      baseURL: provider?.baseURL,
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
   * Retrieves model configuration settings for a specific use case and provider.
   * Use cases define presets for model name, max tokens, and temperature.
   * @param {('fast'|'balanced'|'detailed'|'creative')} [useCase='balanced'] - The desired use case.
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {object} Model configuration object containing `model`, `maxTokens`, and `temperature`.
   * @example
   * const config = aiConfig.getModelConfig('fast', 'openai');
   * // Returns { model: 'gpt-3.5-turbo', maxTokens: 512, temperature: 0.1 }
   */
  getModelConfig(useCase = 'balanced', providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    // Defines different configurations for various use cases.
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

    return modelConfigs[useCase] || modelConfigs.balanced; // Default to 'balanced' if useCase is invalid
  }

  /**
   * Gets the capabilities matrix for a specific AI provider.
   * This matrix indicates features like streaming, function calling, etc.
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {object} An object detailing the provider's capabilities.
   */
  getProviderCapabilities(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    
    // Static capabilities definition for each provider.
    // This could be dynamic or fetched from an API in a more complex system.
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

    return capabilities[this.primaryProvider] || {}; // Default to empty object if provider unknown
  }

  /**
   * Retrieves the rate limit information for a specific AI provider.
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {object} Rate limit details (e.g., `requestsPerMinute`, `requestsPerDay`).
   */
  getRateLimit(providerName = null) {
    const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
    return provider.rateLimit;
  }

  /**
   * Performs a health check for the specified AI provider.
   * For providers like Groq and OpenAI, it attempts to list models.
   * For others, it might just check if an API key is configured.
   * @async
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {Promise<boolean>} True if the provider is considered healthy, false otherwise.
   */
  async checkProviderHealth(providerName = null) {
    try {
      const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
      const client = this.createHttpClient(provider.name); // Pass the actual provider name
      
      // Health check logic varies by provider
      if (provider.name === 'Groq' || provider.name === 'OpenAI') {
        const response = await client.get('/models'); // A common endpoint that requires authentication
        return response.status === 200;
      } else if (provider.name === 'Anthropic') {
        // Anthropic doesn't have a simple public health/models list endpoint without specific headers/payloads.
        // A basic check is if the API key is present, as API calls would fail otherwise.
        // A more robust check might involve a lightweight API call if available.
        return !!provider.apiKey;
      } else if (provider.name === 'Hugging Face') {
        // Similar to Anthropic, a basic check for API key presence.
        // Specific model endpoints could be pinged if a default/test model is defined.
        return !!provider.apiKey;
      }
      
      logger.warn(`Health check not implemented for provider: ${provider.name}`);
      return false; // Default to false if no specific health check is implemented
    } catch (error) {
      logger.error(`Provider health check failed for ${providerName || this.primaryProvider}:`, { message: error.message });
      return false;
    }
  }

  /**
   * Retrieves a list of available models for the specified AI provider.
   * For Groq, it fetches models from the API. For others, it returns models defined in the config.
   * @async
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {Promise<Array<{id: string, name: string, contextWindow: number}>>} A list of available models.
   */
  async getAvailableModels(providerName = null) {
    try {
      const provider = providerName ? this.providers[providerName] : this.getCurrentProvider();
      
      // Groq provides an API to list models
      if (provider.name === 'Groq') {
        const client = this.createHttpClient(provider.name);
        const response = await client.get('/models');
        return response.data.data.map(model => ({
          id: model.id,
          name: model.id, // Or a more user-friendly name if available
          contextWindow: model.context_window || provider.maxTokens, // Fallback to provider's maxTokens
        }));
      } else {
        // For other providers, return the statically defined models in the configuration
        return Object.entries(provider.models).map(([key, value]) => ({
          id: value, // Model ID
          name: `${provider.name} - ${key}`, // User-friendly name (e.g., "OpenAI - fast")
          contextWindow: provider.maxTokens,
        }));
      }
    } catch (error) {
      logger.error(`Failed to get available models for ${providerName || this.primaryProvider}:`, { message: error.message });
      // Fallback to statically defined models of the current provider on error
      const currentProvider = this.getCurrentProvider();
      return Object.entries(currentProvider.models).map(([key, value]) => ({
        id: value,
        name: `${currentProvider.name} - ${key}`,
        contextWindow: currentProvider.maxTokens,
      }));
    }
  }

  /**
   * Estimates the number of tokens in a given text.
   * Uses a rough estimation of ~4 characters per token.
   * @param {string} text - The input text.
   * @returns {number} The estimated token count.
   */
  estimateTokenCount(text) {
    if (!text) return 0;
    // A common rough estimation: average token length is around 4 characters.
    return Math.ceil(text.length / 4);
  }

  /**
   * Checks if the estimated token count of a text is within the limits for a given use case and provider.
   * Reserves 20% of maxTokens for the response.
   * @param {string} text - The input text.
   * @param {('fast'|'balanced'|'detailed'|'creative')} [useCase='balanced'] - The use case.
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {boolean} True if the text is within the token limit, false otherwise.
   */
  isWithinTokenLimit(text, useCase = 'balanced', providerName = null) {
    const modelConfig = this.getModelConfig(useCase, providerName);
    const estimatedTokens = this.estimateTokenCount(text);
    
    // Reserve a portion of the token limit for the model's response (e.g., 20%)
    const maxInputTokens = modelConfig.maxTokens * 0.8;
    
    return estimatedTokens <= maxInputTokens;
  }

  /**
   * Truncates text to fit within the estimated token limit for a given use case and provider.
   * If the text is already within limits, it's returned unchanged.
   * @param {string} text - The input text.
   * @param {('fast'|'balanced'|'detailed'|'creative')} [useCase='balanced'] - The use case.
   * @param {string} [providerName=null] - The name of the provider. Defaults to the primary provider.
   * @returns {string} The (potentially truncated) text.
   */
  truncateToTokenLimit(text, useCase = 'balanced', providerName = null) {
    if (!text) return '';
    const modelConfig = this.getModelConfig(useCase, providerName);
    // Calculate max characters based on 80% of model's token limit (assuming 4 chars/token)
    const maxInputTokens = modelConfig.maxTokens * 0.8;
    
    if (this.estimateTokenCount(text) <= maxInputTokens) {
      return text;
    }

    // Truncate based on estimated character count
    const maxChars = maxInputTokens * 4; // Max characters allowed for input
    return text.substring(0, maxChars) + '... [truncated]'; // Indicate truncation
  }
}

module.exports = new AIConfig();
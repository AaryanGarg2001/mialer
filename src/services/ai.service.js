const aiConfig = require('../config/ai.config');
const logger = require('../utils/logger');

/**
 * @file AI Service
 * @module services/ai
 * @requires ../config/ai.config
 * @requires ../utils/logger
 */

/**
 * Service class for interacting with AI providers.
 * Handles prompt construction, API calls, response parsing, and health checks for AI services.
 * @class AIService
 */
class AIService {
  /**
   * Initializes the AIService with the configured AI provider and HTTP client.
   * @constructor
   */
  constructor() {
    /** @member {object} provider - The configuration for the current AI provider. */
    this.provider = aiConfig.getCurrentProvider();
    /** @member {import('axios').AxiosInstance} httpClient - Axios client configured for the AI provider. */
    this.httpClient = aiConfig.createHttpClient(this.provider.name); // Pass provider name for specific client config
  }

  /**
   * Generates a summary for a single email using the configured AI provider.
   * @async
   * @param {object} emailData - Email content and metadata.
   * @param {string} emailData.subject - Subject of the email.
   * @param {string} emailData.body - Body content of the email.
   * @param {string} [emailData.sender] - Sender of the email.
   * @param {Date} [emailData.receivedAt] - Date when the email was received.
   * @param {string} [emailData.snippet] - A short snippet of the email.
   * @param {object} [persona=null] - User's persona preferences to tailor the summary.
   * @param {string} [summaryType='individual'] - Type of summary (e.g., 'individual', 'daily').
   * @returns {Promise<object>} The generated summary object, typically including `content`, `actionItems`, `priority`, `category`, `sentiment`.
   * @throws {Error} If summary generation fails.
   */
  async generateEmailSummary(emailData, persona = null, summaryType = 'individual') {
    try {
      logger.info('Initiating email summary generation.', {
        summaryType,
        emailSubjectPreview: emailData.subject?.substring(0, 50),
        personaProvided: !!persona,
      });

      // 1. Build the prompt
      const prompt = this.buildSummaryPrompt(emailData, persona, summaryType);
      
      // 2. Get model configuration
      const useCase = summaryType === 'daily' ? 'detailed' : 'balanced'; // 'detailed' for daily, 'balanced' for individual
      const modelConfig = aiConfig.getModelConfig(useCase, this.provider.name);
      
      // 3. Check token limits and truncate if necessary
      let finalPrompt = prompt;
      if (!aiConfig.isWithinTokenLimit(prompt, useCase, this.provider.name)) {
        logger.warn('Prompt exceeds token limit. Attempting to truncate email body.', {
          provider: this.provider.name,
          model: modelConfig.model,
          originalLength: prompt.length, // Could be character length or token estimate
          limit: modelConfig.maxTokens,
        });
        // Truncate the email body within emailData and rebuild the prompt
        const truncatedBody = this.truncateEmailContent(emailData.body, useCase, this.provider.name);
        finalPrompt = this.buildSummaryPrompt({ ...emailData, body: truncatedBody }, persona, summaryType);
        
        // Second check after truncation (optional, but good practice)
        if (!aiConfig.isWithinTokenLimit(finalPrompt, useCase, this.provider.name)) {
            logger.error('Prompt still exceeds token limit after truncation. Cannot proceed.', { provider: this.provider.name });
            throw new Error('Prompt too long for AI model even after truncation.');
        }
      }

      // 4. Make API call
      const rawSummaryResponse = await this.callAIProvider(finalPrompt, modelConfig);
      
      // 5. Parse and structure the response
      const structuredSummary = this.parseAIResponse(rawSummaryResponse, summaryType);
      
      logger.info('Email summary generated successfully.', {
        summaryType,
        provider: this.provider.name,
        modelUsed: modelConfig.model,
      });

      return structuredSummary;

    } catch (error) {
      logger.error('Email summary generation failed in AIService:', { message: error.message, summaryType, provider: this.provider?.name });
      // Re-throw a more generic error or the original error if it's already informative
      throw new Error(`AI summary generation failed: ${error.message}`);
    }
  }

  /**
   * Generates a daily summary from a collection of individual email summaries or details.
   * @async
   * @param {Array<object>} individualSummaries - Array of individual email summaries or full email data.
   * @param {object} [persona=null] - User's persona preferences.
   * @returns {Promise<object>} The generated daily summary object.
   * @throws {Error} If daily summary generation fails.
   */
  async generateDailySummary(individualSummaries, persona = null) {
    try {
      logger.info('Initiating daily summary generation.', {
        emailCount: individualSummaries.length,
        personaProvided: !!persona,
      });

      if (!Array.isArray(individualSummaries) || individualSummaries.length === 0) {
        logger.info('No individual summaries provided for daily summary generation.');
        return { // Return a default empty state
          content: "No emails were processed for today's summary.",
          actionItems: [],
          highlights: [],
          categories: {},
          metadata: { emailCount: 0, generatedAt: new Date().toISOString(), summaryType: 'daily' },
        };
      }

      const prompt = this.buildDailySummaryPrompt(individualSummaries, persona);
      const modelConfig = aiConfig.getModelConfig('detailed', this.provider.name); // Use a model suited for detailed, longer summaries
      
      // Check token limit for daily summary prompt (can be very long)
      if (!aiConfig.isWithinTokenLimit(prompt, 'detailed', this.provider.name)) {
        // Handle overly long daily summary prompts - e.g., summarize fewer emails, or use summaries of summaries
        logger.warn('Daily summary prompt exceeds token limit. This might lead to truncation or errors by the AI provider.', {
            promptLength: prompt.length, // Or token count
            limit: modelConfig.maxTokens,
        });
        // Consider a strategy like summarizing a subset, or summarizing the summaries themselves if this happens often.
        // For now, we'll let the AI provider handle truncation if it occurs.
      }

      const rawDailySummary = await this.callAIProvider(prompt, modelConfig);
      const structuredDailySummary = this.parseAIResponse(rawDailySummary, 'daily');
      
      // Enhance with metadata
      structuredDailySummary.metadata = {
        ...structuredDailySummary.metadata, // Preserve any metadata from parseAIResponse
        emailCount: individualSummaries.length,
        generatedAt: new Date().toISOString(),
        summaryType: 'daily',
        // Potentially add more sophisticated categorization based on the content of summaries
        categoriesAggregated: this.categorizeEmails(individualSummaries.map(s => s.summary || s)), // Use summary part if available
      };

      logger.info('Daily summary generated successfully.', {
        provider: this.provider.name,
        modelUsed: modelConfig.model,
        emailCount: individualSummaries.length,
      });
      return structuredDailySummary;

    } catch (error) {
      logger.error('Daily summary generation failed in AIService:', { message: error.message, provider: this.provider?.name });
      throw new Error(`Daily summary generation failed: ${error.message}`);
    }
  }

  /**
   * Answers a user's question based on provided email context using AI.
   * @async
   * @param {string} question - The user's question.
   * @param {Array<object>} emailContext - An array of email objects (or summaries) providing context.
   * @param {object} [persona=null] - User's persona preferences.
   * @returns {Promise<string>} The AI-generated answer as a string.
   * @throws {Error} If question answering fails.
   */
  async answerEmailQuestion(question, emailContext, persona = null) {
    try {
      logger.info('Answering email question with AI.', {
        questionPreview: question.substring(0, 100),
        contextItemCount: emailContext.length,
        personaProvided: !!persona,
      });

      const prompt = this.buildQuestionPrompt(question, emailContext, persona);
      const modelConfig = aiConfig.getModelConfig('balanced', this.provider.name); // 'balanced' for Q&A

      // Check token limits for Q&A prompt
      if (!aiConfig.isWithinTokenLimit(prompt, 'balanced', this.provider.name)) {
          logger.warn('Q&A prompt exceeds token limit. Context might be truncated by AI.', {
              promptLength: prompt.length,
              limit: modelConfig.maxTokens,
          });
          // Potentially truncate emailContext here if needed
      }
      
      const answer = await this.callAIProvider(prompt, modelConfig);
      
      logger.info('Email question answered successfully by AI.');
      return answer.trim(); // Return the text answer

    } catch (error) {
      logger.error('AI question answering failed in AIService:', { message: error.message, provider: this.provider?.name });
      throw new Error(`AI question answering failed: ${error.message}`);
    }
  }

  /**
   * Builds the prompt for generating an individual email summary.
   * @private
   * @param {object} emailData - Email data.
   * @param {object} [persona] - User persona.
   * @param {string} summaryType - Type of summary.
   * @returns {string} The constructed prompt.
   */
  buildSummaryPrompt(emailData, persona, summaryType) {
    let prompt = '';
    // System instruction: Define the AI's role and goal.
    prompt += `As an AI Email Assistant, your task is to generate a concise and actionable summary of the following email.`;
    
    // Persona integration: Tailor prompt based on persona if available.
    if (persona) {
      prompt += `\nThe recipient is a ${persona.role || 'professional'}. `;
      if (persona.interests && persona.interests.length > 0) {
        prompt += `They are particularly interested in: ${persona.interests.join(', ')}. `;
      }
      prompt += `Their preferred summary style is '${persona.summaryStyle || 'balanced'}'. `;
      if (persona.focusAreas && persona.focusAreas.length > 0) {
         prompt += `Key focus areas for them include: ${persona.focusAreas.join(', ')}. `;
      }
    }

    // Task-specific instructions
    if (summaryType === 'individual') {
      prompt += `\nPlease provide a summary of about 2-3 sentences, highlighting:
1. Main purpose/topic
2. Key information or requests
3. Any actions needed from the recipient

1. The main purpose or topic.
2. Key information or requests.
3. Any actions required from the recipient.

Format your response as a JSON object with the following fields:
- "content": (string) The main summary, 2-3 sentences.
- "actionItems": (array of strings) Specific actions needed, if any.
- "priority": (string) "high", "medium", or "low".
- "category": (string) e.g., "work", "personal", "newsletter", "invoice", "update".
- "sentiment": (string) "positive", "neutral", or "negative".`;
    }
    // Add more instructions for other summaryTypes if needed

    // Email content placeholder
    prompt += `\n\n--- Email Details ---
Subject: ${emailData.subject || '(No Subject)'}
From: ${emailData.sender || 'Unknown Sender'}
Date: ${emailData.receivedAt ? new Date(emailData.receivedAt).toUTCString() : 'Unknown Date'}

Email Content:
${emailData.body || emailData.snippet || '(No Content Available)'}
--- End of Email ---`;

    return prompt;
  }

  /**
   * Builds the prompt for generating a daily summary from multiple individual summaries.
   * @private
   * @param {Array<object>} summaries - Array of individual email summary objects.
   * @param {object} [persona] - User persona.
   * @returns {string} The constructed prompt for daily summary.
   */
  buildDailySummaryPrompt(summaries, persona) {
    let prompt = `As an AI Email Assistant, create a comprehensive daily summary from the following list of individual email summaries.`;
    
    if (persona) {
      prompt += `\nThe user is a ${persona.role || 'professional'}. Key interests: ${(persona.interests || ['general updates']).join(', ')}. `;
      prompt += `Preferred summary style: '${persona.summaryStyle || 'balanced'}'. Focus on: ${(persona.focusAreas || ['key information', 'action items']).join(', ')}.`;
    }

    prompt += `\n\nOrganize the daily summary into sections like:
1. Critical & Urgent: Items needing immediate attention.
2. Key Updates & Information: Important information digests.
3. Action Items: A consolidated list of all action items, with priorities and deadlines if available.
4. FYI / Low Priority: Brief mentions for awareness.

Format your response as a JSON object with these fields:
- "content": (string) The comprehensive daily summary, well-organized.
- "actionItems": (array of objects) Each object: { "text": string, "priority": string, "dueDate": string|null, "sourceEmailSubject": string }.
- "highlights": (array of strings) Most important points or themes from the day.
- "categoriesOverview": (object) Counts of emails by category (e.g., {"work": 5, "personal": 2}).

--- Individual Email Summaries for Today ---`;

    summaries.forEach((s, index) => {
      const summaryContent = typeof s.summary === 'object' ? s.summary.content : s.content; // Adapt based on input structure
      const priority = typeof s.summary === 'object' ? s.summary.priority : s.priority;
      const actionItems = typeof s.summary === 'object' ? s.summary.actionItems : s.actionItems;

      prompt += `\n\n${index + 1}. Subject: ${s.subject || '(No Subject)'}`;
      prompt += `\n   Sender: ${s.sender || 'Unknown'}`;
      prompt += `\n   Summary: ${summaryContent || '(Not summarized)'}`;
      prompt += `\n   Priority: ${priority || 'medium'}`;
      if (actionItems && actionItems.length > 0) {
        prompt += `\n   Action Items: ${actionItems.join('; ')}`;
      }
    });
    prompt += `\n--- End of Individual Summaries ---`;
    return prompt;
  }

  /**
   * Builds the prompt for answering a question based on email context.
   * @private
   * @param {string} question - User's question.
   * @param {Array<object>} emailContext - Array of email objects for context.
   * @param {object} [persona] - User persona.
   * @returns {string} The constructed prompt for question answering.
   */
  buildQuestionPrompt(question, emailContext, persona) {
    let prompt = `You are an AI assistant. Based *only* on the provided email context below, answer the user's question.`;
    if (persona) {
      prompt += ` The user is a ${persona.role || 'professional'}.`;
    }
    prompt += ` If the answer is not found in the context, state that clearly. Be concise.`;

    prompt += `\n\nUser's Question: "${question}"`;

    prompt += `\n\n--- Email Context ---`;
    emailContext.forEach((email, index) => {
      prompt += `\n\nEmail ${index + 1}:`;
      prompt += `\nSubject: ${email.subject || '(No Subject)'}`;
      prompt += `\nFrom: ${email.sender || 'Unknown Sender'}`;
      prompt += `\nDate: ${email.receivedAt ? new Date(email.receivedAt).toUTCString() : 'Unknown Date'}`;
      prompt += `\nContent Snippet: ${email.snippet || email.body?.substring(0, 200) || '(No Content)'}...`; // Use snippet or beginning of body
    });
    prompt += `\n--- End of Email Context ---`;
    prompt += `\n\nAnswer:`;
    return prompt;
  }

  /**
   * Makes an API call to the configured AI provider.
   * @async
   * @private
   * @param {string} prompt - The prompt to send to the AI.
   * @param {object} modelConfig - Configuration for the AI model (name, maxTokens, temperature).
   * @returns {Promise<string>} The raw text response from the AI provider.
   * @throws {Error} If the API call fails or the provider is unsupported.
   */
  async callAIProvider(prompt, modelConfig) {
    try {
      const baseRequestData = {
        model: modelConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature || 0.1, // Default to low temperature for factual summaries
        stream: false, // Assuming non-streaming for now
      };

      let responseContent = '';

      logger.debug('Calling AI Provider', { provider: this.provider.name, model: modelConfig.model });

      // Provider-specific request formatting
      if (this.provider.name === 'Groq' || this.provider.name === 'OpenAI') {
        const response = await this.httpClient.post('/chat/completions', baseRequestData);
        responseContent = response.data.choices[0]?.message?.content || '';
      } else if (this.provider.name === 'Anthropic') {
        // Anthropic's API structure might differ slightly (e.g., `prompt` vs `messages`)
        const anthropicPayload = {
            model: modelConfig.model,
            max_tokens: modelConfig.maxTokens,
            temperature: baseRequestData.temperature,
            messages: baseRequestData.messages, // Ensure this matches Anthropic's expected format
        };
        const response = await this.httpClient.post('/messages', anthropicPayload); // Ensure correct endpoint
        responseContent = response.data.content[0]?.text || '';
      } else if (this.provider.name === 'Hugging Face') {
         // Hugging Face Inference API payload structure varies by model type
        const hfPayload = { inputs: prompt, parameters: { max_length: modelConfig.maxTokens, temperature: baseRequestData.temperature } };
        const response = await this.httpClient.post(`/${modelConfig.model}`, hfPayload); // Endpoint is often model-specific
        responseContent = response.data[0]?.summary_text || response.data[0]?.generated_text || '';
      } else {
        throw new Error(`Unsupported AI provider: ${this.provider.name}`);
      }

      if (!responseContent.trim()) {
        logger.warn('AI provider returned an empty response.', { provider: this.provider.name, model: modelConfig.model });
      }
      return responseContent;

    } catch (error) {
      const errorDetails = {
        provider: this.provider?.name,
        model: modelConfig?.model,
        message: error.message,
        statusCode: error.response?.status,
        responseData: error.response?.data,
      };
      logger.error('AI API call failed:', errorDetails);
      
      if (error.response?.status === 429) {
        throw new Error('AI service rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error('AI service authentication failed. Please check your API key and permissions.');
      } else if (error.response?.status >= 500) {
        throw new Error('AI service is temporarily unavailable. Please try again later.');
      }
      // Re-throw with more context or a generic message
      throw new Error(`Failed to communicate with AI provider ${this.provider?.name}: ${error.message}`);
    }
  }

  /**
   * Parses the AI's raw response, attempting to extract JSON or fallback to text parsing.
   * @private
   * @param {string} rawResponse - The raw string response from the AI.
   * @param {string} summaryType - The type of summary requested (e.g., 'individual', 'daily').
   * @returns {object} A structured summary object.
   */
  parseAIResponse(rawResponse, summaryType) {
    if (!rawResponse || typeof rawResponse !== 'string') {
        logger.warn('Received empty or invalid AI response for parsing.', { summaryType });
        return this.createFallbackResponse(rawResponse || '', summaryType);
    }
    try {
      // Attempt to find and parse a JSON object within the response string
      // This regex looks for a string that starts with { and ends with }, is tolerant to markdown code blocks
      const jsonRegex = /```json\s*([\s\S]*?)\s*```|({[\s\S]*})/;
      const match = rawResponse.match(jsonRegex);

      if (match && (match[1] || match[2])) {
        const jsonString = match[1] || match[2]; // Prefer content within ```json ... ```
        try {
          const parsedJson = JSON.parse(jsonString);
          logger.debug('Successfully parsed JSON from AI response.', { summaryType });
          return this.validateAndStructureResponse(parsedJson, summaryType);
        } catch (jsonError) {
          logger.warn('Failed to parse extracted JSON from AI response, falling back to text parsing.', { summaryType, jsonStringPreview: jsonString.substring(0,100), error: jsonError.message });
          // Fall through to text parsing if JSON is malformed
        }
      }

      // Fallback to text-based parsing if no valid JSON is found
      logger.debug('No valid JSON found in AI response, using text parsing.', { summaryType });
      return this.parseTextResponse(rawResponse, summaryType);

    } catch (error) {
      logger.error('Error parsing AI response:', { message: error.message, summaryType, rawResponsePreview: rawResponse.substring(0, 200) });
      return this.createFallbackResponse(rawResponse, summaryType); // Return raw content on parsing error
    }
  }

  /**
   * Creates a fallback response object if parsing fails.
   * @private
   */
  createFallbackResponse(rawContent, summaryType) {
    const baseResponse = {
      content: rawContent.trim() || "Summary could not be generated.",
      actionItems: [],
      priority: 'medium',
      category: 'general',
      sentiment: 'neutral',
    };
    if (summaryType === 'daily') {
      baseResponse.highlights = [];
      baseResponse.categoriesOverview = {};
    }
    return baseResponse;
  }


  /**
   * Parses a non-JSON text response from the AI into a structured format.
   * This is a fallback if structured JSON output fails.
   * @private
   * @param {string} textResponse - The plain text response from the AI.
   * @param {string} summaryType - The type of summary.
   * @returns {object} A structured summary object.
   */
  parseTextResponse(textResponse, summaryType) {
    const lines = textResponse.split('\n').map(line => line.trim()).filter(Boolean);
    const structured = this.createFallbackResponse('', summaryType); // Initialize with defaults

    if (lines.length === 0) {
      structured.content = "No meaningful content received from AI.";
      return structured;
    }

    // Basic heuristic: first few lines as content
    structured.content = lines.slice(0, Math.min(lines.length, 3)).join(' ').trim();

    // Simple keyword-based extraction for action items (example)
    const actionKeywords = ['action:', 'todo:', 'task:', 'follow up:'];
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (actionKeywords.some(keyword => lowerLine.startsWith(keyword))) {
        structured.actionItems.push(line.substring(line.indexOf(':') + 1).trim());
      }
    });
    
    // Simple keyword-based priority/sentiment (very basic)
    const lcText = textResponse.toLowerCase();
    if (lcText.includes('urgent') || lcText.includes('critical')) structured.priority = 'high';
    else if (lcText.includes('fyi') || lcText.includes('low priority')) structured.priority = 'low';

    if (lcText.includes('positive') || lcText.includes('good news')) structured.sentiment = 'positive';
    else if (lcText.includes('negative') || lcText.includes('bad news') || lcText.includes('issue')) structured.sentiment = 'negative';

    logger.debug('Parsed AI response using text-based fallback.', { summaryType, extractedContentLength: structured.content.length });
    return structured;
  }

  /**
   * Validates and standardizes the structure of a parsed JSON response from the AI.
   * @private
   * @param {object} parsedJson - The parsed JSON object from the AI response.
   * @param {string} summaryType - The type of summary.
   * @returns {object} A validated and structured summary object.
   */
  validateAndStructureResponse(parsedJson, summaryType) {
    const content = parsedJson.content || parsedJson.summary || '';
    const actionItems = Array.isArray(parsedJson.actionItems)
      ? parsedJson.actionItems.filter(item => typeof item === 'string' || (typeof item === 'object' && item.text))
      : [];

    const priority = ['high', 'medium', 'low'].includes(parsedJson.priority?.toLowerCase())
      ? parsedJson.priority.toLowerCase()
      : 'medium';

    const category = typeof parsedJson.category === 'string' ? parsedJson.category : 'general';
    const sentiment = ['positive', 'neutral', 'negative'].includes(parsedJson.sentiment?.toLowerCase())
      ? parsedJson.sentiment.toLowerCase()
      : 'neutral';

    const structured = { content, actionItems, priority, category, sentiment };

    if (summaryType === 'daily') {
      structured.highlights = Array.isArray(parsedJson.highlights)
        ? parsedJson.highlights.filter(h => typeof h === 'string')
        : [];
      structured.categoriesOverview = typeof parsedJson.categoriesOverview === 'object' && !Array.isArray(parsedJson.categoriesOverview)
        ? parsedJson.categoriesOverview
        : {};
      // If actionItems are objects for daily, ensure they have 'text'
      if (actionItems.length > 0 && typeof actionItems[0] === 'object') {
        structured.actionItems = actionItems.map(item => ({
            text: item.text || 'No description',
            priority: ['high', 'medium', 'low'].includes(item.priority?.toLowerCase()) ? item.priority.toLowerCase() : 'medium',
            dueDate: item.dueDate || null, // Assuming dueDate might be present
            sourceEmailSubject: item.sourceEmailSubject || null,
        }));
      }
    }
    logger.debug('Validated and structured JSON response from AI.', { summaryType });
    return structured;
  }

  /**
   * Aggregates email categories from a list of individual summaries.
   * Used for metadata in daily summaries.
   * @private
   * @param {Array<object>} summaries - Array of individual email summary objects.
   * @returns {object} An object mapping category names to their counts.
   */
  categorizeEmails(summaries) { // Renamed to categoriesAggregated for clarity in daily summary
    const categoriesCount = {};
    summaries.forEach(summary => {
      // Ensure we are looking at the category from the summary object itself
      const category = summary?.category || 'general';
      categoriesCount[category] = (categoriesCount[category] || 0) + 1;
    });
    return categoriesCount;
  }

  /**
   * Truncates email content to fit within AI model token limits.
   * A simple implementation that keeps the beginning and end of the content.
   * @private
   * @param {string} content - The email body content.
   * @param {string} useCase - The AI use case (e.g., 'balanced', 'detailed').
   * @param {string} providerName - The name of the AI provider.
   * @returns {string} The potentially truncated content.
   */
  truncateEmailContent(content, useCase, providerName) {
    if (!content) return '';
    
    const modelConfig = aiConfig.getModelConfig(useCase, providerName);
    // Estimate max characters: (maxTokens * 0.8 for input) * (average chars per token, e.g., 3-4)
    // This is a rough heuristic. A proper tokenizer would be more accurate.
    const maxCharsForInput = modelConfig.maxTokens * 0.8 * 3.5;
    
    if (content.length <= maxCharsForInput) {
      return content;
    }

    // Keep a portion from the beginning and a portion from the end
    const keepLength = Math.floor(maxCharsForInput * 0.45); // Keep 45% from start, 45% from end
    const beginning = content.substring(0, keepLength);
    const end = content.substring(content.length - keepLength);
    
    const truncatedMsg = "\n\n[... content truncated due to length ...]\n\n";
    logger.info('Email content truncated for AI prompt.', { originalLength: content.length, truncatedLength: beginning.length + end.length + truncatedMsg.length});
    return beginning + truncatedMsg + end;
  }

  /**
   * Performs a health check on the configured AI service provider.
   * @async
   * @returns {Promise<object>} An object indicating the provider's health status, name, capabilities, etc.
   */
  async healthCheck() {
    try {
      // Uses aiConfig's method to check the actual provider's health
      const isHealthy = await aiConfig.checkProviderHealth(this.provider.name);
      const capabilities = aiConfig.getProviderCapabilities(this.provider.name);
      const rateLimitInfo = aiConfig.getRateLimit(this.provider.name);

      return {
        provider: this.provider.name,
        healthy: isHealthy,
        message: isHealthy ? 'AI service is operational.' : 'AI service may be experiencing issues or is misconfigured.',
        capabilities,
        rateLimitInfo,
        defaultModel: this.provider.defaultModel,
      };
    } catch (error) {
      logger.error('AI service health check execution failed:', { message: error.message, provider: this.provider?.name });
      return {
        provider: this.provider?.name || 'Unknown',
        healthy: false,
        message: `Health check failed with error: ${error.message}`,
        error: error.message,
      };
    }
  }
}

module.exports = new AIService();
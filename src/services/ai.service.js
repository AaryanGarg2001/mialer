const aiConfig = require('../config/ai.config');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.provider = aiConfig.getCurrentProvider();
    this.httpClient = aiConfig.createHttpClient();
  }

  /**
   * Generate email summary using AI
   * @param {Object} emailData - Email content and metadata
   * @param {Object} persona - User's persona preferences
   * @param {string} summaryType - Type of summary (individual, daily, weekly)
   * @returns {Object} Generated summary
   */
  async generateEmailSummary(emailData, persona = null, summaryType = 'individual') {
    try {
      logger.info('Generating email summary', {
        summaryType,
        emailSubject: emailData.subject?.substring(0, 50),
        hasPersona: !!persona,
      });

      // Build the prompt based on summary type
      const prompt = this.buildSummaryPrompt(emailData, persona, summaryType);
      
      // Get model configuration based on summary type
      const useCase = summaryType === 'daily' ? 'detailed' : 'balanced';
      const modelConfig = aiConfig.getModelConfig(useCase);
      
      // Check token limits
      if (!aiConfig.isWithinTokenLimit(prompt, useCase)) {
        logger.warn('Prompt exceeds token limit, truncating', {
          originalLength: prompt.length,
          estimatedTokens: aiConfig.estimateTokenCount(prompt),
        });
        
        // For long emails, truncate the content but keep important parts
        emailData.body = this.truncateEmailContent(emailData.body, useCase);
      }

      // Make API call to generate summary
      const summary = await this.callAIProvider(prompt, modelConfig);
      
      // Parse and structure the response
      const structuredSummary = this.parseAIResponse(summary, summaryType);
      
      logger.info('Email summary generated successfully', {
        summaryType,
        summaryLength: structuredSummary.content?.length || 0,
        actionItemsCount: structuredSummary.actionItems?.length || 0,
      });

      return structuredSummary;

    } catch (error) {
      logger.error('Failed to generate email summary:', error);
      throw new Error(`AI summary generation failed: ${error.message}`);
    }
  }

  /**
   * Generate daily summary from multiple individual summaries
   * @param {Array} individualSummaries - Array of individual email summaries
   * @param {Object} persona - User's persona preferences
   * @returns {Object} Daily summary
   */
  async generateDailySummary(individualSummaries, persona = null) {
    try {
      logger.info('Generating daily summary', {
        emailCount: individualSummaries.length,
        hasPersona: !!persona,
      });

      if (individualSummaries.length === 0) {
        return {
          content: "No emails processed today.",
          actionItems: [],
          categories: {},
          metadata: {
            emailCount: 0,
            generatedAt: new Date(),
            summaryType: 'daily',
          },
        };
      }

      // Build comprehensive prompt for daily summary
      const prompt = this.buildDailySummaryPrompt(individualSummaries, persona);
      
      // Use detailed model for daily summaries
      const modelConfig = aiConfig.getModelConfig('detailed');
      
      // Generate daily summary
      const summary = await this.callAIProvider(prompt, modelConfig);
      
      // Parse and structure the daily summary
      const structuredSummary = this.parseAIResponse(summary, 'daily');
      
      // Add metadata
      structuredSummary.metadata = {
        emailCount: individualSummaries.length,
        generatedAt: new Date(),
        summaryType: 'daily',
        categories: this.categorizeEmails(individualSummaries),
      };

      logger.info('Daily summary generated successfully', {
        emailCount: individualSummaries.length,
        summaryLength: structuredSummary.content?.length || 0,
        actionItemsCount: structuredSummary.actionItems?.length || 0,
      });

      return structuredSummary;

    } catch (error) {
      logger.error('Failed to generate daily summary:', error);
      throw new Error(`Daily summary generation failed: ${error.message}`);
    }
  }

  /**
   * Answer user questions about their emails using AI
   * @param {string} question - User's question
   * @param {Array} emailContext - Relevant emails or summaries
   * @param {Object} persona - User's persona preferences
   * @returns {string} AI-generated answer
   */
  async answerEmailQuestion(question, emailContext, persona = null) {
    try {
      logger.info('Answering email question', {
        question: question.substring(0, 100),
        contextCount: emailContext.length,
        hasPersona: !!persona,
      });

      const prompt = this.buildQuestionPrompt(question, emailContext, persona);
      const modelConfig = aiConfig.getModelConfig('balanced');
      
      const answer = await this.callAIProvider(prompt, modelConfig);
      
      logger.info('Email question answered successfully');
      return answer.trim();

    } catch (error) {
      logger.error('Failed to answer email question:', error);
      throw new Error(`Question answering failed: ${error.message}`);
    }
  }

  /**
   * Build prompt for individual email summary
   */
  buildSummaryPrompt(emailData, persona, summaryType) {
    let prompt = '';

    // System context
    prompt += `You are an AI email assistant that creates concise, actionable summaries. `;
    
    // Add persona context if available
    if (persona) {
      prompt += `The user is a ${persona.role || 'professional'} who cares about: ${(persona.interests || []).join(', ')}. `;
      prompt += `Their summary style preference is: ${persona.summaryStyle || 'balanced'}. `;
    }

    // Instructions based on summary type
    if (summaryType === 'individual') {
      prompt += `\n\nSummarize this email in 2-3 sentences. Focus on:
1. Main purpose/topic
2. Key information or requests
3. Any actions needed from the recipient

Format your response as JSON with these fields:
- "content": The main summary (2-3 sentences)
- "actionItems": Array of specific actions needed (if any)
- "priority": "high", "medium", or "low"
- "category": Email category (work, personal, newsletters, etc.)
- "sentiment": "positive", "neutral", or "negative"`;
    }

    // Add email content
    prompt += `\n\nEmail Details:
Subject: ${emailData.subject || 'No subject'}
From: ${emailData.sender || 'Unknown sender'}
Date: ${emailData.receivedAt || 'Unknown date'}

Email Content:
${emailData.body || emailData.snippet || 'No content available'}`;

    return prompt;
  }

  /**
   * Build prompt for daily summary
   */
  buildDailySummaryPrompt(summaries, persona) {
    let prompt = `You are an AI email assistant creating a comprehensive daily email summary. `;
    
    if (persona) {
      prompt += `The user is a ${persona.role || 'professional'} who focuses on: ${(persona.interests || []).join(', ')}. `;
    }

    prompt += `\n\nCreate a daily summary from these individual email summaries. Organize by:
1. High priority items that need immediate attention
2. Important updates and information
3. Lower priority items for awareness
4. Action items with deadlines or follow-ups needed

Format as JSON with:
- "content": Comprehensive daily summary organized by priority
- "actionItems": Array of all action items with priorities and deadlines
- "highlights": Array of most important points
- "categories": Object with counts by email category

Individual Email Summaries:
${summaries.map((summary, index) => `
${index + 1}. Subject: ${summary.subject || 'Unknown'}
   Summary: ${summary.content}
   Priority: ${summary.priority || 'medium'}
   Action Items: ${(summary.actionItems || []).join('; ')}
   Category: ${summary.category || 'general'}
`).join('\n')}`;

    return prompt;
  }

  /**
   * Build prompt for question answering
   */
  buildQuestionPrompt(question, emailContext, persona) {
    let prompt = `You are an AI assistant helping a user understand their emails. `;
    
    if (persona) {
      prompt += `The user is a ${persona.role || 'professional'}. `;
    }

    prompt += `\n\nBased on the email information below, answer this question: "${question}"

Provide a direct, helpful answer. If you can't find the specific information, say so clearly.

Email Context:
${emailContext.map((item, index) => `
${index + 1}. ${item.subject || 'No subject'} (from ${item.sender || 'unknown'})
   Summary: ${item.content || item.summary || 'No summary available'}
`).join('\n')}`;

    return prompt;
  }

  /**
   * Make API call to AI provider
   */
  async callAIProvider(prompt, modelConfig) {
    try {
      const requestData = {
        model: modelConfig.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
        stream: false,
      };

      // Adjust request format based on provider
      if (this.provider.name === 'Groq' || this.provider.name === 'OpenAI') {
        // OpenAI-compatible format
        const response = await this.httpClient.post('/chat/completions', requestData);
        return response.data.choices[0].message.content;
      } else if (this.provider.name === 'Anthropic') {
        // Anthropic format
        const anthropicData = {
          model: modelConfig.model,
          max_tokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
          messages: requestData.messages,
        };
        const response = await this.httpClient.post('/messages', anthropicData);
        return response.data.content[0].text;
      } else if (this.provider.name === 'Hugging Face') {
        // Hugging Face format (for summarization models)
        const hfData = {
          inputs: prompt,
          parameters: {
            max_length: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
          },
        };
        const response = await this.httpClient.post(`/${modelConfig.model}`, hfData);
        return response.data[0].summary_text || response.data[0].generated_text;
      }

      throw new Error(`Unsupported provider: ${this.provider.name}`);

    } catch (error) {
      logger.error('AI API call failed:', {
        provider: this.provider.name,
        model: modelConfig.model,
        error: error.response?.data || error.message,
      });
      
      if (error.response?.status === 429) {
        throw new Error('AI service rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 401) {
        throw new Error('AI service authentication failed. Please check API key.');
      } else if (error.response?.status >= 500) {
        throw new Error('AI service is temporarily unavailable. Please try again later.');
      }
      
      throw error;
    }
  }

  /**
   * Parse AI response and structure it
   */
  parseAIResponse(response, summaryType) {
    try {
      // Try to parse as JSON first
      if (response.includes('{') && response.includes('}')) {
        const jsonStart = response.indexOf('{');
        const jsonEnd = response.lastIndexOf('}') + 1;
        const jsonStr = response.substring(jsonStart, jsonEnd);
        
        try {
          const parsed = JSON.parse(jsonStr);
          return this.validateAndStructureResponse(parsed, summaryType);
        } catch (jsonError) {
          logger.warn('Failed to parse JSON response, using text parsing', jsonError.message);
        }
      }

      // Fallback to text parsing
      return this.parseTextResponse(response, summaryType);

    } catch (error) {
      logger.error('Failed to parse AI response:', error);
      
      // Return basic structure with raw content
      return {
        content: response.trim(),
        actionItems: [],
        priority: 'medium',
        category: 'general',
        sentiment: 'neutral',
      };
    }
  }

  /**
   * Parse non-JSON text response
   */
  parseTextResponse(response, summaryType) {
    const lines = response.split('\n').map(line => line.trim()).filter(line => line);
    
    const structured = {
      content: '',
      actionItems: [],
      priority: 'medium',
      category: 'general',
      sentiment: 'neutral',
    };

    // Extract main content (first few lines)
    structured.content = lines.slice(0, 3).join(' ').trim();

    // Look for action items
    const actionKeywords = ['action', 'todo', 'task', 'follow up', 'respond', 'reply', 'call', 'meeting'];
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (actionKeywords.some(keyword => lowerLine.includes(keyword))) {
        structured.actionItems.push(line);
      }
    });

    // Determine priority based on keywords
    const highPriorityKeywords = ['urgent', 'asap', 'immediately', 'deadline', 'critical'];
    const lowPriorityKeywords = ['fyi', 'information', 'newsletter', 'update'];
    
    const lowerContent = response.toLowerCase();
    if (highPriorityKeywords.some(keyword => lowerContent.includes(keyword))) {
      structured.priority = 'high';
    } else if (lowPriorityKeywords.some(keyword => lowerContent.includes(keyword))) {
      structured.priority = 'low';
    }

    return structured;
  }

  /**
   * Validate and structure JSON response
   */
  validateAndStructureResponse(parsed, summaryType) {
    const structured = {
      content: parsed.content || parsed.summary || '',
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      priority: ['high', 'medium', 'low'].includes(parsed.priority) ? parsed.priority : 'medium',
      category: parsed.category || 'general',
      sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
    };

    // Add daily summary specific fields
    if (summaryType === 'daily') {
      structured.highlights = Array.isArray(parsed.highlights) ? parsed.highlights : [];
      structured.categories = parsed.categories || {};
    }

    return structured;
  }

  /**
   * Categorize emails for daily summary metadata
   */
  categorizeEmails(summaries) {
    const categories = {};
    
    summaries.forEach(summary => {
      const category = summary.category || 'general';
      categories[category] = (categories[category] || 0) + 1;
    });

    return categories;
  }

  /**
   * Truncate email content to fit token limits
   */
  truncateEmailContent(content, useCase) {
    if (!content) return '';
    
    // Keep beginning and end of email, remove middle if too long
    const maxLength = aiConfig.getModelConfig(useCase).maxTokens * 3; // Rough estimate
    
    if (content.length <= maxLength) {
      return content;
    }

    const keepLength = Math.floor(maxLength * 0.4);
    const beginning = content.substring(0, keepLength);
    const end = content.substring(content.length - keepLength);
    
    return beginning + '\n\n[... content truncated ...]\n\n' + end;
  }

  /**
   * Health check for AI service
   */
  async healthCheck() {
    try {
      const isHealthy = await aiConfig.checkProviderHealth();
      const capabilities = aiConfig.getProviderCapabilities();
      const rateLimit = aiConfig.getRateLimit();

      return {
        provider: this.provider.name,
        healthy: isHealthy,
        capabilities,
        rateLimit,
        model: this.provider.defaultModel,
      };
    } catch (error) {
      logger.error('AI service health check failed:', error);
      return {
        provider: this.provider.name,
        healthy: false,
        error: error.message,
      };
    }
  }
}

module.exports = new AIService();
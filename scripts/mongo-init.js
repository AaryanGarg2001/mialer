// MongoDB initialization script for development environment

// Switch to the application database
db = db.getSiblingDB('email_summarizer');

// Create application user with read/write permissions
db.createUser({
  user: 'appuser',
  pwd: 'apppassword123',
  roles: [
    {
      role: 'readWrite',
      db: 'email_summarizer'
    }
  ]
});

// Create collections with validation schemas
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'googleId', 'createdAt'],
      properties: {
        email: {
          bsonType: 'string',
          description: 'User email address - required'
        },
        googleId: {
          bsonType: 'string',
          description: 'Google OAuth ID - required'
        },
        name: {
          bsonType: 'string',
          description: 'User display name'
        },
        avatar: {
          bsonType: 'string',
          description: 'User avatar URL'
        },
        isActive: {
          bsonType: 'bool',
          description: 'User active status'
        },
        createdAt: {
          bsonType: 'date',
          description: 'User creation timestamp - required'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'User last update timestamp'
        }
      }
    }
  }
});

db.createCollection('personas', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'createdAt'],
      properties: {
        userId: {
          bsonType: 'objectId',
          description: 'Reference to user - required'
        },
        role: {
          bsonType: 'string',
          description: 'User role/profession'
        },
        interests: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          },
          description: 'Array of user interests'
        },
        importantContacts: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          },
          description: 'Array of important email contacts'
        },
        keywords: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          },
          description: 'Array of important keywords'
        },
        summaryStyle: {
          bsonType: 'string',
          enum: ['brief', 'detailed', 'action-focused'],
          description: 'Preferred summary style'
        },
        dailySummaryTime: {
          bsonType: 'string',
          description: 'Preferred time for daily summary (HH:MM format)'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Persona creation timestamp - required'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Persona last update timestamp'
        }
      }
    }
  }
});

db.createCollection('emails', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'messageId', 'subject', 'sender', 'receivedAt'],
      properties: {
        userId: {
          bsonType: 'objectId',
          description: 'Reference to user - required'
        },
        messageId: {
          bsonType: 'string',
          description: 'Gmail message ID - required'
        },
        threadId: {
          bsonType: 'string',
          description: 'Gmail thread ID'
        },
        subject: {
          bsonType: 'string',
          description: 'Email subject - required'
        },
        sender: {
          bsonType: 'string',
          description: 'Email sender - required'
        },
        recipients: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          },
          description: 'Email recipients'
        },
        body: {
          bsonType: 'string',
          description: 'Email body content'
        },
        snippet: {
          bsonType: 'string',
          description: 'Email snippet/preview'
        },
        labels: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          },
          description: 'Gmail labels'
        },
        isImportant: {
          bsonType: 'bool',
          description: 'Gmail importance marker'
        },
        isRead: {
          bsonType: 'bool',
          description: 'Read status'
        },
        receivedAt: {
          bsonType: 'date',
          description: 'Email received timestamp - required'
        },
        processedAt: {
          bsonType: 'date',
          description: 'Processing timestamp'
        }
      }
    }
  }
});

db.createCollection('summaries', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'type', 'content', 'createdAt'],
      properties: {
        userId: {
          bsonType: 'objectId',
          description: 'Reference to user - required'
        },
        type: {
          bsonType: 'string',
          enum: ['daily', 'weekly', 'on-demand'],
          description: 'Summary type - required'
        },
        content: {
          bsonType: 'string',
          description: 'Summary content - required'
        },
        emailIds: {
          bsonType: 'array',
          items: {
            bsonType: 'objectId'
          },
          description: 'References to summarized emails'
        },
        actionItems: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              description: {
                bsonType: 'string'
              },
              priority: {
                bsonType: 'string',
                enum: ['low', 'medium', 'high']
              },
              dueDate: {
                bsonType: 'date'
              }
            }
          },
          description: 'Extracted action items'
        },
        metadata: {
          bsonType: 'object',
          description: 'Additional summary metadata'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Summary creation timestamp - required'
        }
      }
    }
  }
});

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ googleId: 1 }, { unique: true });
db.personas.createIndex({ userId: 1 }, { unique: true });
db.emails.createIndex({ userId: 1, receivedAt: -1 });
db.emails.createIndex({ messageId: 1 }, { unique: true });
db.emails.createIndex({ userId: 1, isRead: 1 });
db.summaries.createIndex({ userId: 1, createdAt: -1 });
db.summaries.createIndex({ userId: 1, type: 1 });

print('✅ Database initialization completed successfully!');
print('📊 Created collections: users, personas, emails, summaries');
print('🔐 Created application user: appuser');
print('📈 Created performance indexes');
print('🎯 Database ready for email summarizer application');
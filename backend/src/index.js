import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mqtt from 'mqtt';
import winston from 'winston';

import pool from './db/index.js';
import authRoutes from './routes/auth.js';
import farmRoutes from './routes/farms.js';
import { handleTelemetry, handleCommandResponse } from './services/telemetryService.js';

dotenv.config();

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        mqtt: mqttClient ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/farms', farmRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Aquaculture IoT Platform API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      farms: '/api/farms'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// MQTT Client Setup
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
let mqttClient = null;

const connectMQTT = () => {
  mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    clientId: `backend_${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000
  });

  mqttClient.on('connect', () => {
    logger.info('Connected to MQTT broker');
    
    // Subscribe to device telemetry topics
    mqttClient.subscribe('aquaculture/+/telemetry', (err) => {
      if (err) {
        logger.error('Failed to subscribe to telemetry topic:', err);
      } else {
        logger.info('Subscribed to telemetry topic');
      }
    });
    
    // Subscribe to command response topics
    mqttClient.subscribe('aquaculture/+/command/response', (err) => {
      if (err) {
        logger.error('Failed to subscribe to command response topic:', err);
      } else {
        logger.info('Subscribed to command response topic');
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      
      if (topic.includes('telemetry')) {
        await handleTelemetry(payload);
      } else if (topic.includes('command/response')) {
        await handleCommandResponse(payload);
      }
    } catch (error) {
      logger.error('Error processing MQTT message:', error);
    }
  });

  mqttClient.on('error', (error) => {
    logger.error('MQTT client error:', error);
  });

  mqttClient.on('reconnect', () => {
    logger.info('Reconnecting to MQTT broker...');
  });

  mqttClient.on('close', () => {
    logger.warn('MQTT connection closed');
  });
};

// Start server
const startServer = async () => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    logger.info('Database connection established');
    
    // Connect to MQTT broker
    connectMQTT();
    
    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  
  if (mqttClient) {
    mqttClient.end();
  }
  
  pool.end(() => {
    logger.info('Database connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  
  if (mqttClient) {
    mqttClient.end();
  }
  
  pool.end(() => {
    logger.info('Database connection closed');
    process.exit(0);
  });
});

startServer();

export default app;

import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { handleTelemetry } from '../services/telemetry.service.js';
import { handleCommandResponse } from '../services/command.service.js';

dotenv.config();

const MQTT_OPTIONS = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
};

class MQTTClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  connect() {
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    
    this.client = mqtt.connect(brokerUrl, MQTT_OPTIONS);

    this.client.on('connect', () => {
      console.log('Connected to MQTT broker');
      this.isConnected = true;
      this.subscribeToTopics();
    });

    this.client.on('error', (err) => {
      console.error('MQTT connection error:', err);
      this.isConnected = false;
    });

    this.client.on('reconnect', () => {
      console.log('Reconnecting to MQTT broker...');
    });

    this.client.on('message', async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        await this.handleMessage(topic, payload);
      } catch (err) {
        console.error('Error processing MQTT message:', err);
      }
    });
  }

  subscribeToTopics() {
    // Subscribe to telemetry from all devices
    this.client.subscribe('aquaculture/+/telemetry', (err) => {
      if (!err) {
        console.log('Subscribed to telemetry topic');
      }
    });

    // Subscribe to command responses
    this.client.subscribe('aquaculture/+/command/response', (err) => {
      if (!err) {
        console.log('Subscribed to command response topic');
      }
    });

    // Subscribe to device status updates
    this.client.subscribe('aquaculture/+/status', (err) => {
      if (!err) {
        console.log('Subscribed to status topic');
      }
    });
  }

  async handleMessage(topic, payload) {
    const parts = topic.split('/');
    const deviceId = parts[1];
    const messageType = parts[2];

    switch (messageType) {
      case 'telemetry':
        await handleTelemetry(deviceId, payload);
        break;
      case 'command':
        if (parts[3] === 'response') {
          await handleCommandResponse(deviceId, payload);
        }
        break;
      case 'status':
        console.log(`Device ${deviceId} status update:`, payload);
        // Update device last_seen and status in database
        break;
      default:
        console.log(`Unknown message type: ${messageType}`);
    }
  }

  publish(topic, message) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      this.client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async sendCommand(deviceId, command, params = {}) {
    const topic = `aquaculture/${deviceId}/command`;
    const message = {
      command,
      params,
      timestamp: new Date().toISOString(),
    };
    
    console.log(`Sending command to ${deviceId}:`, command);
    await this.publish(topic, message);
  }
}

export const mqttClient = new MQTTClient();

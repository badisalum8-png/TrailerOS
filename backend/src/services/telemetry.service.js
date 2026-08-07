import pool from '../db/index.js';
import { mqttClient } from '../mqtt/client.js';

/**
 * Process incoming telemetry data from IoT devices
 * @param {string} deviceId - The device ID sending the telemetry
 * @param {object} payload - Telemetry data payload
 */
export async function handleTelemetry(deviceId, payload) {
  const { readings, battery, signal, timestamp } = payload;

  console.log(`Processing telemetry from device ${deviceId}`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update device last_seen and status
    await client.query(
      `UPDATE devices 
       SET last_seen_at = $1, 
           battery_level = $2, 
           signal_strength = $3,
           status = 'ACTIVE'
       WHERE serial_number = $4`,
      [timestamp || new Date(), battery, signal, deviceId]
    );

    // Insert sensor readings
    if (readings && Array.isArray(readings)) {
      const values = [];
      const queryParams = [];
      let paramIndex = 1;

      for (const reading of readings) {
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        queryParams.push(
          reading.timestamp || timestamp,
          deviceId,
          reading.type,
          reading.value,
          reading.unit || getUnitForType(reading.type)
        );
      }

      if (values.length > 0) {
        await client.query(
          `INSERT INTO sensor_readings (time, device_id, sensor_type, value, unit)
           VALUES ${values.join(', ')}`,
          queryParams
        );
      }
    }

    // Check for alert conditions
    await checkAlertConditions(client, deviceId, readings);

    await client.query('COMMIT');
    console.log(`Telemetry processed successfully for device ${deviceId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error processing telemetry:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get standard unit for sensor type
 */
function getUnitForType(sensorType) {
  const units = {
    temperature: '°C',
    ph: 'pH',
    turbidity: 'NTU',
    water_level: 'cm',
    dissolved_oxygen: 'mg/L',
    conductivity: 'µS/cm',
    salinity: 'ppt',
    ammonia: 'mg/L',
    nitrate: 'mg/L',
  };
  return units[sensorType] || 'unknown';
}

/**
 * Check if any readings trigger alert conditions
 */
async function checkAlertConditions(client, deviceId, readings) {
  if (!readings) return;

  // Get device's pond information
  const pondResult = await client.query(
    `SELECT p.id as pond_id, p.farm_id, o.id as organization_id
     FROM devices d
     JOIN ponds p ON d.pond_id = p.id
     JOIN farms f ON p.farm_id = f.id
     JOIN organizations o ON f.organization_id = o.id
     WHERE d.serial_number = $1`,
    [deviceId]
  );

  if (pondResult.rows.length === 0) {
    console.warn(`Device ${deviceId} not assigned to any pond`);
    return;
  }

  const { pond_id, organization_id } = pondResult.rows[0];

  // Get active automation rules for this pond
  const rulesResult = await client.query(
    `SELECT id, name, trigger_sensor, condition_operator, threshold_value, action_type
     FROM automation_rules
     WHERE pond_id = $1 AND is_active = true`,
    [pond_id]
  );

  for (const reading of readings) {
    for (const rule of rulesResult.rows) {
      if (reading.type !== rule.trigger_sensor) continue;

      let triggered = false;
      switch (rule.condition_operator) {
        case '>':
          triggered = reading.value > parseFloat(rule.threshold_value);
          break;
        case '<':
          triggered = reading.value < parseFloat(rule.threshold_value);
          break;
        case '>=':
          triggered = reading.value >= parseFloat(rule.threshold_value);
          break;
        case '<=':
          triggered = reading.value <= parseFloat(rule.threshold_value);
          break;
        case '=':
          triggered = reading.value === parseFloat(rule.threshold_value);
          break;
      }

      if (triggered) {
        await createAlert(
          client,
          organization_id,
          deviceId,
          pond_id,
          rule.name,
          `${rule.trigger_sensor} ${rule.condition_operator} ${rule.threshold_value} (current: ${reading.value})`,
          reading.value > parseFloat(rule.threshold_value) * 1.5 ? 'CRITICAL' : 'WARNING',
          rule.action_type
        );

        // Execute automated action if configured
        if (rule.action_type !== 'ALERT_ONLY') {
          await executeAutomationAction(deviceId, rule.action_type);
        }
      }
    }
  }
}

/**
 * Create an alert record in the database
 */
async function createAlert(client, organizationId, deviceId, pondId, ruleName, message, severity, actionType) {
  const result = await client.query(
    `INSERT INTO alerts (organization_id, device_id, pond_id, rule_name, message, severity)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organizationId, deviceId, pondId, ruleName, message, severity]
  );

  console.log(`Alert created: ${ruleName} - ${severity}`);

  // TODO: Send notifications via email, SMS, push notification
  // This would integrate with a notification service
}

/**
 * Execute automation action (e.g., start/stop equipment)
 */
async function executeAutomationAction(deviceId, actionType) {
  let command = null;
  let params = {};

  switch (actionType) {
    case 'START_PUMP':
      command = 'START_PUMP';
      break;
    case 'STOP_PUMP':
      command = 'STOP_PUMP';
      break;
    case 'START_AERATOR':
      command = 'START_AERATOR';
      break;
    case 'STOP_AERATOR':
      command = 'STOP_AERATOR';
      break;
    case 'OPEN_VALVE':
      command = 'OPEN_VALVE';
      break;
    case 'CLOSE_VALVE':
      command = 'CLOSE_VALVE';
      break;
    default:
      console.log(`Unknown action type: ${actionType}`);
      return;
  }

  try {
    await mqttClient.sendCommand(deviceId, command, params);
    console.log(`Automation action executed: ${actionType} on device ${deviceId}`);
  } catch (err) {
    console.error(`Failed to execute automation action: ${actionType}`, err);
  }
}

import { query } from '../db/index.js';
import { createAlert, checkDuplicateActiveAlert } from './alertService.js';
import { getAutomationRulesByPond } from './automationService.js';

/**
 * Process incoming telemetry data from IoT devices
 */
export const handleTelemetry = async (payload) => {
  try {
    const { 
      deviceId, 
      serialNumber, 
      timestamp, 
      readings, 
      deviceStatus, 
      batteryVoltage, 
      signalStrength 
    } = payload;
    
    // Find device by serial number or device ID
    let device;
    if (serialNumber) {
      device = await getDeviceBySerialNumber(serialNumber);
    } else if (deviceId) {
      device = await getDeviceById(deviceId);
    }
    
    if (!device) {
      console.warn('Unknown device sent telemetry:', serialNumber || deviceId);
      return;
    }
    
    // Update device last seen time and status
    await updateDeviceStatus(device.id, 'online', new Date());
    
    // Store sensor readings
    const readingValues = [];
    for (const [sensorType, reading] of Object.entries(readings)) {
      if (reading.value !== null && reading.value !== undefined) {
        readingValues.push({
          deviceId: device.id,
          sensorType,
          value: reading.value,
          unit: reading.unit || getDefaultUnit(sensorType),
          timestamp: timestamp || new Date().toISOString()
        });
        
        // Check for alert conditions
        await checkAlertConditions(device, sensorType, reading.value);
      }
    }
    
    // Bulk insert readings
    if (readingValues.length > 0) {
      await bulkInsertReadings(readingValues);
    }
    
    // Store device health metrics
    if (batteryVoltage !== null || signalStrength !== null) {
      await storeDeviceHealth(device.id, batteryVoltage, signalStrength);
    }
    
    console.log(`Processed ${readingValues.length} readings from device ${device.id}`);
  } catch (error) {
    console.error('Error handling telemetry:', error);
    throw error;
  }
};

/**
 * Handle command response from devices
 */
export const handleCommandResponse = async (payload) => {
  try {
    const { deviceId, commandId, status, message, executedAt } = payload;
    
    await query(
      `UPDATE equipment_commands 
       SET status = $1, response_message = $2, executed_at = $3
       WHERE id = $4`,
      [status, message, executedAt, commandId]
    );
    
    console.log(`Command ${commandId} completed with status: ${status}`);
  } catch (error) {
    console.error('Error handling command response:', error);
  }
};

/**
 * Check if a reading triggers an alert
 */
const checkAlertConditions = async (device, sensorType, value) => {
  try {
    // Get pond and farm information
    const pondInfo = await query(
      `SELECT p.id as pond_id, p.farm_id, p.organization_id, 
              COALESCE(p.threshold_min, -999) as threshold_min,
              COALESCE(p.threshold_max, 999) as threshold_max
       FROM ponds p
       JOIN devices d ON p.id = d.pond_id
       WHERE d.id = $1`,
      [device.id]
    );
    
    if (pondInfo.rows.length === 0) return;
    
    const { pond_id, farm_id, organization_id, threshold_min, threshold_max } = pondInfo.rows[0];
    
    // Check if value is outside acceptable range
    let alertType = null;
    let severity = 'warning';
    let message = '';
    
    if (value < threshold_min) {
      alertType = `${sensorType}_low`;
      severity = value < (threshold_min * 0.8) ? 'critical' : 'warning';
      message = `${sensorType} reading (${value}) is below minimum threshold (${threshold_min})`;
    } else if (value > threshold_max) {
      alertType = `${sensorType}_high`;
      severity = value > (threshold_max * 1.2) ? 'critical' : 'warning';
      message = `${sensorType} reading (${value}) is above maximum threshold (${threshold_max})`;
    }
    
    if (alertType) {
      // Check for duplicate active alerts to avoid spam
      const isDuplicate = await checkDuplicateActiveAlert(device.id, sensorType, alertType);
      
      if (!isDuplicate) {
        await createAlert({
          organizationId: organization_id,
          farmId: farm_id,
          pondId: pond_id,
          deviceId: device.id,
          sensorType,
          alertType,
          severity,
          currentValue: value,
          thresholdMin: threshold_min,
          thresholdMax: threshold_max,
          message
        });
        
        console.log(`Alert created: ${message}`);
      }
    }
  } catch (error) {
    console.error('Error checking alert conditions:', error);
  }
};

/**
 * Bulk insert sensor readings into TimescaleDB
 */
const bulkInsertReadings = async (readings) => {
  const values = readings.map((r, index) => {
    const i = index * 4 + 1;
    return `($${i}, $${i+1}, $${i+2}, $${i+3})`;
  }).join(', ');
  
  const queryParams = readings.flatMap(r => [r.deviceId, r.sensorType, r.value, r.timestamp]);
  
  await query(
    `INSERT INTO sensor_readings (device_id, sensor_type, value, time) VALUES ${values}`,
    queryParams
  );
};

/**
 * Store device health metrics
 */
const storeDeviceHealth = async (deviceId, batteryVoltage, signalStrength) => {
  await query(
    `INSERT INTO device_health (device_id, battery_voltage, signal_strength)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id) DO UPDATE SET
       battery_voltage = EXCLUDED.battery_voltage,
       signal_strength = EXCLUDED.signal_strength,
       updated_at = NOW()`,
    [deviceId, batteryVoltage, signalStrength]
  );
};

/**
 * Get default unit for sensor type
 */
const getDefaultUnit = (sensorType) => {
  const units = {
    temperature: '°C',
    ph: 'pH',
    turbidity: 'NTU',
    dissolved_oxygen: 'mg/L',
    water_level: 'cm',
    conductivity: 'µS/cm',
    salinity: 'ppt',
    ammonia: 'mg/L',
    nitrate: 'mg/L'
  };
  return units[sensorType] || 'unknown';
};

// Helper functions imported from deviceService
const getDeviceBySerialNumber = async (serialNumber) => {
  const result = await query('SELECT * FROM devices WHERE serial_number = $1', [serialNumber]);
  return result.rows[0] || null;
};

const getDeviceById = async (deviceId) => {
  const result = await query('SELECT * FROM devices WHERE id = $1', [deviceId]);
  return result.rows[0] || null;
};

const updateDeviceStatus = async (deviceId, status, lastSeenAt) => {
  await query(
    `UPDATE devices SET status = $1, last_seen_at = $2, updated_at = NOW() WHERE id = $3`,
    [status, lastSeenAt, deviceId]
  );
};

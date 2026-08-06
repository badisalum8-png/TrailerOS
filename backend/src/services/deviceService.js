import { query } from '../db/index.js';

export const createDevice = async (deviceData) => {
  const { 
    serialNumber, 
    organizationId, 
    pondId, 
    deviceModel, 
    firmwareVersion 
  } = deviceData;
  
  const result = await query(
    `INSERT INTO devices (serial_number, organization_id, pond_id, device_model, firmware_version, status)
     VALUES ($1, $2, $3, $4, $5, 'inactive')
     RETURNING *`,
    [serialNumber, organizationId, pondId, deviceModel, firmwareVersion]
  );
  
  return result.rows[0];
};

export const getDeviceBySerialNumber = async (serialNumber) => {
  const result = await query(
    'SELECT * FROM devices WHERE serial_number = $1',
    [serialNumber]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const getDeviceById = async (deviceId) => {
  const result = await query(
    'SELECT * FROM devices WHERE id = $1',
    [deviceId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const getDevicesByPond = async (pondId) => {
  const result = await query(
    'SELECT * FROM devices WHERE pond_id = $1 ORDER BY created_at DESC',
    [pondId]
  );
  
  return result.rows;
};

export const getDevicesByOrganization = async (organizationId) => {
  const result = await query(
    'SELECT * FROM devices WHERE organization_id = $1 ORDER BY created_at DESC',
    [organizationId]
  );
  
  return result.rows;
};

export const updateDeviceStatus = async (deviceId, status, lastSeenAt = null) => {
  const updates = ['status = $1'];
  const values = [status];
  let paramIndex = 2;
  
  if (lastSeenAt) {
    updates.push(`last_seen_at = $${paramIndex}`);
    values.push(lastSeenAt);
    paramIndex++;
  }
  
  values.push(deviceId);
  
  const result = await query(
    `UPDATE devices SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const activateDevice = async (deviceId, activationData) => {
  const { firmwareVersion, ipAddress, macAddress } = activationData;
  
  const result = await query(
    `UPDATE devices 
     SET status = 'active', 
         firmware_version = COALESCE($1, firmware_version),
         ip_address = $2,
         mac_address = $3,
         activated_at = NOW(),
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [firmwareVersion, ipAddress, macAddress, deviceId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Device not found');
  }
  
  return result.rows[0];
};

export const assignDeviceToPond = async (deviceId, pondId) => {
  // Verify pond belongs to same organization
  const pondCheck = await query(
    `SELECT p.organization_id FROM ponds p
     JOIN devices d ON d.organization_id = p.organization_id
     WHERE p.id = $1 AND d.id = $2`,
    [pondId, deviceId]
  );
  
  if (pondCheck.rows.length === 0) {
    throw new Error('Pond and device must belong to the same organization');
  }
  
  const result = await query(
    `UPDATE devices SET pond_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [pondId, deviceId]
  );
  
  return result.rows[0];
};

export const getDeviceTelemetrySummary = async (deviceId, hours = 24) => {
  const result = await query(
    `SELECT 
      sensor_type,
      AVG(value) as avg_value,
      MIN(value) as min_value,
      MAX(value) as max_value,
      LAST(value, time) as latest_value,
      COUNT(*) as reading_count
     FROM sensor_readings
     WHERE device_id = $1
     AND time >= NOW() - INTERVAL '${hours} hours'
     GROUP BY sensor_type`,
    [deviceId]
  );
  
  return result.rows;
};

export const getDeviceHealth = async (deviceId) => {
  const result = await query(
    `SELECT 
      d.id,
      d.serial_number,
      d.status,
      d.last_seen_at,
      d.firmware_version,
      EXTRACT(EPOCH FROM (NOW() - d.last_seen_at))/60 as minutes_since_last_seen,
      CASE 
        WHEN d.last_seen_at > NOW() - INTERVAL '5 minutes' THEN 'online'
        WHEN d.last_seen_at > NOW() - INTERVAL '30 minutes' THEN 'delayed'
        ELSE 'offline'
      END as connectivity_status
     FROM devices d
     WHERE d.id = $1`,
    [deviceId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

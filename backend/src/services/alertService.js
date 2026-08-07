import { query } from '../db/index.js';

export const createAlert = async (alertData) => {
  const { 
    organizationId, 
    farmId, 
    pondId, 
    deviceId, 
    sensorType, 
    alertType, 
    severity, 
    currentValue, 
    thresholdMin, 
    thresholdMax, 
    message 
  } = alertData;
  
  const result = await query(
    `INSERT INTO alerts (
      organization_id, farm_id, pond_id, device_id, sensor_type, alert_type, 
      severity, current_value, threshold_min, threshold_max, message, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
     RETURNING *`,
    [organizationId, farmId, pondId, deviceId, sensorType, alertType, severity, currentValue, thresholdMin, thresholdMax, message]
  );
  
  return result.rows[0];
};

export const getActiveAlertsByOrganization = async (organizationId, limit = 50) => {
  const result = await query(
    `SELECT a.*, f.name as farm_name, p.name as pond_name, d.serial_number
     FROM alerts a
     JOIN farms f ON a.farm_id = f.id
     JOIN ponds p ON a.pond_id = p.id
     LEFT JOIN devices d ON a.device_id = d.id
     WHERE a.organization_id = $1 AND a.status = 'active'
     ORDER BY a.severity DESC, a.created_at DESC
     LIMIT $2`,
    [organizationId, limit]
  );
  
  return result.rows;
};

export const getActiveAlertsByFarm = async (farmId, limit = 50) => {
  const result = await query(
    `SELECT a.*, p.name as pond_name, d.serial_number
     FROM alerts a
     JOIN ponds p ON a.pond_id = p.id
     LEFT JOIN devices d ON a.device_id = d.id
     WHERE a.farm_id = $1 AND a.status = 'active'
     ORDER BY a.severity DESC, a.created_at DESC
     LIMIT $2`,
    [farmId, limit]
  );
  
  return result.rows;
};

export const acknowledgeAlert = async (alertId, userId, notes = null) => {
  const result = await query(
    `UPDATE alerts 
     SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = NOW(), resolution_notes = $2
     WHERE id = $3 AND status = 'active'
     RETURNING *`,
    [userId, notes, alertId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Alert not found or already acknowledged');
  }
  
  return result.rows[0];
};

export const resolveAlert = async (alertId, userId, resolutionNotes = null) => {
  const result = await query(
    `UPDATE alerts 
     SET status = 'resolved', resolved_by = $1, resolved_at = NOW(), resolution_notes = COALESCE($2, resolution_notes)
     WHERE id = $3 AND status IN ('active', 'acknowledged')
     RETURNING *`,
    [userId, resolutionNotes, alertId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Alert not found or already resolved');
  }
  
  return result.rows[0];
};

export const getAlertHistory = async (pondId, days = 30, limit = 100) => {
  const result = await query(
    `SELECT * FROM alerts
     WHERE pond_id = $1
     AND created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC
     LIMIT $2`,
    [pondId, limit]
  );
  
  return result.rows;
};

export const getAlertStatistics = async (organizationId, days = 30) => {
  const result = await query(
    `SELECT 
      COUNT(*) FILTER (WHERE status = 'active') as active_count,
      COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged_count,
      COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
      COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'active') as critical_active,
      COUNT(*) FILTER (WHERE severity = 'warning' AND status = 'active') as warning_active,
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h_count
     FROM alerts
     WHERE organization_id = $1
     AND created_at >= NOW() - INTERVAL '${days} days'`,
    [organizationId]
  );
  
  return result.rows[0];
};

export const checkDuplicateActiveAlert = async (deviceId, sensorType, alertType) => {
  const result = await query(
    `SELECT id FROM alerts
     WHERE device_id = $1 
     AND sensor_type = $2 
     AND alert_type = $3 
     AND status = 'active'
     AND created_at >= NOW() - INTERVAL '1 hour'`,
    [deviceId, sensorType, alertType]
  );
  
  return result.rows.length > 0;
};

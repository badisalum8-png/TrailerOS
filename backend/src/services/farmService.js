import { query } from '../db/index.js';

export const createFarm = async (farmData) => {
  const { organizationId, name, code, address, gpsLocation, managerName, managerPhone, farmType, emergencyContact } = farmData;
  
  const result = await query(
    `INSERT INTO farms (organization_id, name, code, address, gps_location, manager_name, manager_phone, farm_type, emergency_contact)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [organizationId, name, code, address, gpsLocation, managerName, managerPhone, farmType, emergencyContact]
  );
  
  return result.rows[0];
};

export const getFarmById = async (farmId) => {
  const result = await query(
    'SELECT * FROM farms WHERE id = $1',
    [farmId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const getFarmsByOrganization = async (organizationId) => {
  const result = await query(
    'SELECT * FROM farms WHERE organization_id = $1 ORDER BY created_at DESC',
    [organizationId]
  );
  
  return result.rows;
};

export const updateFarm = async (farmId, updates) => {
  const allowedFields = ['name', 'code', 'address', 'gps_location', 'manager_name', 'manager_phone', 'farm_type', 'emergency_contact'];
  const fields = [];
  const values = [];
  let index = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }
  }
  
  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }
  
  values.push(farmId);
  
  const result = await query(
    `UPDATE farms SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${index}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const deleteFarm = async (farmId) => {
  await query(
    'UPDATE farms SET is_archived = true, archived_at = NOW() WHERE id = $1',
    [farmId]
  );
  
  return { success: true };
};

export const getFarmSummary = async (farmId) => {
  const result = await query(
    `SELECT 
      f.id,
      f.name,
      f.code,
      COUNT(DISTINCT p.id) as pond_count,
      COUNT(DISTINCT d.id) as device_count,
      COUNT(DISTINCT CASE WHEN d.status = 'online' THEN d.id END) as online_devices,
      COUNT(DISTINCT CASE WHEN d.status = 'offline' THEN d.id END) as offline_devices,
      COUNT(DISTINCT CASE WHEN a.severity = 'critical' AND a.status = 'active' THEN a.id END) as critical_alerts
     FROM farms f
     LEFT JOIN ponds p ON f.id = p.farm_id
     LEFT JOIN devices d ON p.id = d.pond_id
     LEFT JOIN alerts a ON p.id = a.pond_id
     WHERE f.id = $1
     GROUP BY f.id, f.name, f.code`,
    [farmId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

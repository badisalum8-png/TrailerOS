import { query } from '../db/index.js';

/**
 * Pond Service - Handles pond CRUD operations
 */

/**
 * Create a new pond
 */
export const createPond = async (organizationId, farmId, pondData) => {
  const result = await query(
    `INSERT INTO ponds (
      organization_id, farm_id, name, code, pond_type, 
      water_source, volume_liters, area_sqm, fish_species, 
      stocking_date, target_harvest_date
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      organizationId,
      farmId,
      pondData.name,
      pondData.code || null,
      pondData.pondType || null,
      pondData.waterSource || null,
      pondData.volumeLiters || null,
      pondData.areaSqm || null,
      pondData.fishSpecies || null,
      pondData.stockingDate || null,
      pondData.targetHarvestDate || null
    ]
  );
  
  return result.rows[0];
};

/**
 * Get all ponds for a farm
 */
export const getPondsByFarm = async (farmId) => {
  const result = await query(
    `SELECT p.*, f.name as farm_name
     FROM ponds p
     JOIN farms f ON p.farm_id = f.id
     WHERE p.farm_id = $1
     ORDER BY p.created_at DESC`,
    [farmId]
  );
  
  return result.rows;
};

/**
 * Get a single pond by ID
 */
export const getPondById = async (pondId) => {
  const result = await query(
    `SELECT p.*, f.name as farm_name, f.code as farm_code
     FROM ponds p
     JOIN farms f ON p.farm_id = f.id
     WHERE p.id = $1`,
    [pondId]
  );
  
  return result.rows[0] || null;
};

/**
 * Update pond details
 */
export const updatePond = async (pondId, updates) => {
  const allowedFields = [
    'name', 'code', 'pond_type', 'water_source', 
    'volume_liters', 'area_sqm', 'fish_species', 
    'stocking_date', 'target_harvest_date', 'current_status'
  ];

  const fields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    const dbColumn = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(dbColumn)) {
      fields.push(`${dbColumn} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(pondId);
  
  const result = await query(
    `UPDATE ponds
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

/**
 * Delete a pond
 */
export const deletePond = async (pondId) => {
  const result = await query(
    `DELETE FROM ponds WHERE id = $1 RETURNING id`,
    [pondId]
  );
  
  return result.rowCount > 0;
};

/**
 * Get pond current status with latest sensor readings
 */
export const getPondStatus = async (pondId) => {
  const result = await query(
    `SELECT 
      p.*,
      d.id as device_id,
      d.status as device_status,
      d.battery_level,
      d.signal_strength,
      latest_readings.readings
    FROM ponds p
    LEFT JOIN devices d ON d.pond_id = p.id AND d.status = 'online'
    LEFT JOIN LATERAL (
      SELECT json_object_agg(sr.sensor_type, sr.value) as readings
      FROM (
        SELECT sensor_type, value
        FROM sensor_readings
        WHERE device_id = d.id
        AND time > NOW() - INTERVAL '1 hour'
        ORDER BY time DESC
        LIMIT 10
      ) sr
    ) latest_readings ON true
    WHERE p.id = $1`,
    [pondId]
  );
  
  return result.rows[0] || null;
};

/**
 * Get historical readings for a pond
 */
export const getPondHistory = async (pondId, sensorType, startTime, endTime) => {
  const result = await query(
    `SELECT 
      time_bucket('1 hour', sr.time) as time_period,
      sr.sensor_type,
      AVG(sr.value) as avg_value,
      MIN(sr.value) as min_value,
      MAX(sr.value) as max_value
    FROM sensor_readings sr
    JOIN devices d ON sr.device_id = d.id
    WHERE d.pond_id = $1
      AND sr.sensor_type = $2
      AND sr.time BETWEEN $3 AND $4
    GROUP BY time_period, sr.sensor_type
    ORDER BY time_period DESC`,
    [pondId, sensorType, startTime, endTime]
  );
  
  return result.rows;
};

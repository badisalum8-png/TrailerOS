import db from '../db/index.js';

/**
 * Pond Service - Handles pond CRUD operations
 */
class PondService {
  /**
   * Create a new pond
   */
  async createPond(organizationId, farmId, pondData) {
    const query = `
      INSERT INTO ponds (
        organization_id, farm_id, name, code, pond_type, 
        water_source, volume_liters, area_sqm, fish_species, 
        stocking_date, target_harvest_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    
    const values = [
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
    ];

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Get all ponds for a farm
   */
  async getPondsByFarm(organizationId, farmId) {
    const query = `
      SELECT p.*, f.name as farm_name
      FROM ponds p
      JOIN farms f ON p.farm_id = f.id
      WHERE p.organization_id = $1 AND p.farm_id = $2
      ORDER BY p.created_at DESC
    `;
    
    const result = await db.query(query, [organizationId, farmId]);
    return result.rows;
  }

  /**
   * Get all ponds by farm ID (alias for backward compatibility)
   */
  async getAllPondsByFarm(farmId) {
    const query = `
      SELECT p.*, f.name as farm_name
      FROM ponds p
      JOIN farms f ON p.farm_id = f.id
      WHERE p.farm_id = $1
      ORDER BY p.created_at DESC
    `;
    
    const result = await db.query(query, [farmId]);
    return result.rows;
  }

  /**
   * Get a single pond by ID
   */
  async getPondById(organizationId, pondId) {
    const query = `
      SELECT p.*, f.name as farm_name, f.code as farm_code
      FROM ponds p
      JOIN farms f ON p.farm_id = f.id
      WHERE p.organization_id = $1 AND p.id = $2
    `;
    
    const result = await db.query(query, [organizationId, pondId]);
    return result.rows[0] || null;
  }

  /**
   * Update pond details
   */
  async updatePond(organizationId, pondId, updates) {
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

    values.push(organizationId, pondId);
    
    const query = `
      UPDATE ponds
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE organization_id = $${paramIndex} AND id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await db.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete a pond
   */
  async deletePond(organizationId, pondId) {
    const query = `
      DELETE FROM ponds
      WHERE organization_id = $1 AND id = $2
      RETURNING id
    `;
    
    const result = await db.query(query, [organizationId, pondId]);
    return result.rowCount > 0;
  }

  /**
   * Get pond current status with latest sensor readings
   */
  async getPondStatus(organizationId, pondId) {
    const query = `
      SELECT 
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
      WHERE p.organization_id = $1 AND p.id = $2
    `;
    
    const result = await db.query(query, [organizationId, pondId]);
    return result.rows[0] || null;
  }

  /**
   * Get historical readings for a pond
   */
  async getPondHistory(organizationId, pondId, sensorType, startTime, endTime) {
    const query = `
      SELECT 
        time_bucket('1 hour', sr.time) as time_period,
        sr.sensor_type,
        AVG(sr.value) as avg_value,
        MIN(sr.value) as min_value,
        MAX(sr.value) as max_value
      FROM sensor_readings sr
      JOIN devices d ON sr.device_id = d.id
      WHERE d.organization_id = $1 
        AND d.pond_id = $2
        AND sr.sensor_type = $3
        AND sr.time BETWEEN $4 AND $5
      GROUP BY time_period, sr.sensor_type
      ORDER BY time_period DESC
    `;
    
    const result = await db.query(query, [organizationId, pondId, sensorType, startTime, endTime]);
    return result.rows;
  }
}

export default new PondService();

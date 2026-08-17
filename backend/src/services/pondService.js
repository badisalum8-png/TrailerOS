import db from '../db/index.js';

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

export default new PondService();

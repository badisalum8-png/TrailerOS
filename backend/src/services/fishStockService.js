/**
 * Fish Stock Management Service
 * Tracks fish batches, growth, mortality, and harvest
 */
const db = require('../db');

class FishStockService {
  /**
   * Create a new fish batch (stocking event)
   */
  static async createBatch(batchData) {
    const {
      pond_id,
      species,
      batch_number,
      quantity,
      average_initial_weight,
      supplier,
      stocking_date,
      notes
    } = batchData;

    const query = `
      INSERT INTO fish_batches 
      (pond_id, species, batch_number, quantity, initial_quantity, average_initial_weight, supplier, stocking_date, notes, status)
      VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'active')
      RETURNING *
    `;
    
    const values = [pond_id, species, batch_number, quantity, average_initial_weight, supplier, stocking_date || new Date(), notes];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Record mortality event
   */
  static async recordMortality(batchId, mortalityData) {
    const { quantity, average_weight, cause, recorded_by, notes } = mortalityData;

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Record mortality
      const mortalityQuery = `
        INSERT INTO fish_mortality 
        (batch_id, quantity, average_weight, cause, recorded_by, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      await client.query(mortalityQuery, [batchId, quantity, average_weight, cause, recorded_by, notes]);

      // Update batch quantity
      const updateQuery = `
        UPDATE fish_batches 
        SET quantity = quantity - $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      
      const batchResult = await client.query(updateQuery, [quantity, batchId]);

      await client.query('COMMIT');
      return batchResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record sampling event for growth tracking
   */
  static async recordSampling(batchId, samplingData) {
    const {
      sample_size,
      average_weight,
      min_weight,
      max_weight,
      sampled_by,
      notes
    } = samplingData;

    const query = `
      INSERT INTO fish_sampling 
      (batch_id, sample_size, average_weight, min_weight, max_weight, sampled_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [batchId, sample_size, average_weight, min_weight, max_weight, sampled_by, notes];
    const result = await db.query(query, values);
    
    // Update batch average weight
    await this.updateBatchWeight(batchId);
    
    return result.rows[0];
  }

  /**
   * Update batch average weight from latest sampling
   */
  static async updateBatchWeight(batchId) {
    const query = `
      UPDATE fish_batches fb
      SET average_current_weight = (
        SELECT AVG(average_weight) 
        FROM fish_sampling 
        WHERE batch_id = $1 
        ORDER BY sampling_date DESC 
        LIMIT 3
      ),
      updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, [batchId]);
    return result.rows[0];
  }

  /**
   * Calculate estimated biomass
   */
  static async calculateBiomass(batchId) {
    const query = `
      SELECT 
        quantity,
        average_current_weight,
        (quantity * COALESCE(average_current_weight, average_initial_weight)) as estimated_biomass
      FROM fish_batches
      WHERE id = $1
    `;
    
    const result = await db.query(query, [batchId]);
    return result.rows[0];
  }

  /**
   * Record harvest event
   */
  static async recordHarvest(batchId, harvestData) {
    const {
      quantity_harvested,
      average_weight,
      total_weight,
      harvest_method,
      buyer,
      price_per_kg,
      harvested_by,
      notes
    } = harvestData;

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Create harvest record
      const harvestQuery = `
        INSERT INTO fish_harvests 
        (batch_id, quantity_harvested, average_weight, total_weight, harvest_method, buyer, price_per_kg, total_value, harvested_by, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      
      const harvestResult = await client.query(harvestQuery, [
        batchId, 
        quantity_harvested, 
        average_weight, 
        total_weight, 
        harvest_method, 
        buyer, 
        price_per_kg, 
        total_weight * price_per_kg, 
        harvested_by, 
        notes
      ]);

      // Update batch
      const remainingQuantity = await client.query(
        'SELECT quantity FROM fish_batches WHERE id = $1',
        [batchId]
      );
      
      const newQuantity = remainingQuantity.rows[0].quantity - quantity_harvested;
      
      if (newQuantity <= 0) {
        // Close batch
        await client.query(`
          UPDATE fish_batches 
          SET status = 'harvested',
              harvest_date = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `, [batchId]);
      } else {
        await client.query(`
          UPDATE fish_batches 
          SET quantity = $1,
              updated_at = NOW()
          WHERE id = $2
        `, [newQuantity, batchId]);
      }

      await client.query('COMMIT');
      return harvestResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate Feed Conversion Ratio (FCR)
   */
  static async calculateFCR(batchId, startDate, endDate) {
    const query = `
      SELECT 
        SUM(fr.quantity) as total_feed_given,
        fb.initial_quantity * COALESCE(fb.average_current_weight, fb.average_initial_weight) as current_biomass,
        fb.initial_quantity * fb.average_initial_weight as initial_biomass,
        (COALESCE(SUM(fm.quantity), 0) * COALESCE(AVG(fm.average_weight), fb.average_initial_weight)) as mortality_weight_loss
      FROM fish_batches fb
      LEFT JOIN feeding_records fr ON fr.batch_id = fb.id AND fr.date BETWEEN $2 AND $3
      LEFT JOIN fish_mortality fm ON fm.batch_id = fb.id AND fm.recorded_date BETWEEN $2 AND $3
      WHERE fb.id = $1
      GROUP BY fb.id
    `;
    
    const result = await db.query(query, [batchId, startDate, endDate]);
    const data = result.rows[0];
    
    if (!data.total_feed_given || data.total_feed_given === 0) {
      return null;
    }
    
    const weightGain = (data.current_biomass + data.mortality_weight_loss) - data.initial_biomass;
    const fcr = weightGain > 0 ? data.total_feed_given / weightGain : null;
    
    return {
      totalFeedGiven: data.total_feed_given,
      weightGain: weightGain,
      fcr: fcr,
      period: { startDate, endDate }
    };
  }

  /**
   * Get batch growth history
   */
  static async getGrowthHistory(batchId) {
    const query = `
      SELECT 
        sampling_date,
        sample_size,
        average_weight,
        min_weight,
        max_weight,
        sampled_by,
        notes
      FROM fish_sampling
      WHERE batch_id = $1
      ORDER BY sampling_date ASC
    `;
    
    const result = await db.query(query, [batchId]);
    return result.rows;
  }

  /**
   * Get batches by pond
   */
  static async getPondBatches(pondId, includeHistorical = false) {
    let query = `
      SELECT 
        fb.*,
        p.name as pond_name,
        COUNT(DISTINCT fs.id) as sampling_count,
        COUNT(DISTINCT fm.id) as mortality_events
      FROM fish_batches fb
      JOIN ponds p ON fb.pond_id = p.id
      LEFT JOIN fish_sampling fs ON fb.id = fs.batch_id
      LEFT JOIN fish_mortality fm ON fb.id = fm.batch_id
      WHERE fb.pond_id = $1
    `;
    
    if (!includeHistorical) {
      query += " AND fb.status = 'active'";
    }
    
    query += ' GROUP BY fb.id, p.name ORDER BY fb.stocking_date DESC';
    
    const result = await db.query(query, [pondId]);
    return result.rows;
  }

  /**
   * Get stock statistics for organization
   */
  static async getOrganizationStats(organizationId) {
    const query = `
      SELECT 
        COUNT(DISTINCT fb.id) as active_batches,
        SUM(fb.quantity) as total_fish_count,
        AVG(fb.average_current_weight) as avg_fish_weight,
        SUM(fb.quantity * COALESCE(fb.average_current_weight, fb.average_initial_weight)) as total_biomass,
        COUNT(DISTINCT fb.species) as species_count,
        SUM(COALESCE(fm.total_mortality, 0)) as total_mortality
      FROM fish_batches fb
      JOIN ponds p ON fb.pond_id = p.id
      LEFT JOIN (
        SELECT batch_id, SUM(quantity) as total_mortality
        FROM fish_mortality
        GROUP BY batch_id
      ) fm ON fb.id = fm.batch_id
      WHERE p.organization_id = $1
        AND fb.status = 'active'
    `;
    
    const result = await db.query(query, [organizationId]);
    return result.rows[0];
  }

  /**
   * Predict harvest date based on growth rate
   */
  static async predictHarvestDate(batchId, targetWeight) {
    const growthHistory = await this.getGrowthHistory(batchId);
    
    if (growthHistory.length < 2) {
      return null; // Not enough data for prediction
    }
    
    // Simple linear growth prediction
    const firstSample = growthHistory[0];
    const lastSample = growthHistory[growthHistory.length - 1];
    
    const daysBetween = (new Date(lastSample.sampling_date) - new Date(firstSample.sampling_date)) / (1000 * 60 * 60 * 24);
    const weightGain = lastSample.average_weight - firstSample.average_weight;
    const dailyGrowthRate = weightGain / daysBetween;
    
    const remainingGrowth = targetWeight - lastSample.average_weight;
    const daysToTarget = remainingGrowth / dailyGrowthRate;
    
    const predictedDate = new Date(lastSample.sampling_date);
    predictedDate.setDate(predictedDate.getDate() + Math.round(daysToTarget));
    
    return {
      currentDate: lastSample.sampling_date,
      currentWeight: lastSample.average_weight,
      targetWeight,
      predictedHarvestDate: predictedDate,
      daysUntilHarvest: Math.round(daysToTarget),
      dailyGrowthRate
    };
  }
}

module.exports = FishStockService;

/**
 * Growth & Engagement Service
 * Gamification, farmer scoring, loyalty programs, and consultant portal
 * Drives user retention and platform stickiness
 */

const db = require('../db');
const { sendNotification } = require('./notificationService');

class GrowthService {
  /**
   * Calculate farmer score based on performance metrics
   */
  async calculateFarmerScore(organizationId) {
    const scoreComponents = {};
    
    // Water Quality Management (30%)
    const waterQualityScore = await this.getWaterQualityScore(organizationId);
    scoreComponents.waterQuality = waterQualityScore;
    
    // Mortality Rate Performance (25%)
    const mortalityScore = await this.getMortalityScore(organizationId);
    scoreComponents.mortality = mortalityScore;
    
    // Feed Efficiency (20%)
    const feedEfficiencyScore = await this.getFeedEfficiencyScore(organizationId);
    scoreComponents.feedEfficiency = feedEfficiencyScore;
    
    // Operational Consistency (15%)
    const operationalScore = await this.getOperationalScore(organizationId);
    scoreComponents.operational = operationalScore;
    
    // Sustainability Practices (10%)
    const sustainabilityScore = await this.getSustainabilityScore(organizationId);
    scoreComponents.sustainability = sustainabilityScore;
    
    // Calculate weighted total
    const totalScore = 
      (waterQualityScore * 0.30) +
      (mortalityScore * 0.25) +
      (feedEfficiencyScore * 0.20) +
      (operationalScore * 0.15) +
      (sustainabilityScore * 0.10);
    
    // Determine level/badge
    const level = this.getLevelFromScore(totalScore);
    
    // Update farmer profile
    await db.pool.query(
      `UPDATE farmer_profiles 
       SET total_score = $1, level = $2, score_components = $3, updated_at = NOW()
       WHERE organization_id = $4`,
      [Math.round(totalScore), level, JSON.stringify(scoreComponents), organizationId]
    );
    
    return {
      totalScore: Math.round(totalScore),
      level,
      components: scoreComponents,
      nextLevelThreshold: this.getNextLevelThreshold(level)
    };
  }
  
  /**
   * Water quality management score
   */
  async getWaterQualityScore(organizationId) {
    const result = await db.pool.query(
      `SELECT 
        ROUND(100.0 * SUM(CASE 
          WHEN sensor_type = 'dissolved_oxygen' AND value >= 5 THEN 1
          WHEN sensor_type = 'ph' AND value BETWEEN 6.5 AND 8.5 THEN 1
          WHEN sensor_type = 'ammonia' AND value <= 0.02 THEN 1
          ELSE 0
        END) / COUNT(*), 2) as compliance_rate
       FROM sensor_readings sr
       JOIN devices d ON sr.device_id = d.id
       JOIN ponds p ON d.pond_id = p.id
       WHERE p.organization_id = $1
         AND time > NOW() - INTERVAL '30 days'`,
      [organizationId]
    );
    
    return parseFloat(result.rows[0]?.compliance_rate || 0);
  }
  
  /**
   * Mortality rate performance score
   */
  async getMortalityScore(organizationId) {
    const result = await db.pool.query(
      `SELECT 
        ROUND(100.0 * SUM(mortality_count) / NULLIF(SUM(stock_quantity), 0), 2) as mortality_rate
       FROM fish_mortality_records fmr
       JOIN fish_batches fb ON fmr.batch_id = fb.id
       JOIN ponds p ON fb.pond_id = p.id
       WHERE p.organization_id = $1
         AND event_date > NOW() - INTERVAL '90 days'`,
      [organizationId]
    );
    
    const mortalityRate = parseFloat(result.rows[0]?.mortality_rate || 0);
    
    // Score inversely proportional to mortality rate
    // < 2% = 100, 2-5% = 80-100, 5-10% = 50-80, > 10% = < 50
    if (mortalityRate <= 2) return 100;
    if (mortalityRate <= 5) return 100 - ((mortalityRate - 2) * 6.67);
    if (mortalityRate <= 10) return 80 - ((mortalityRate - 5) * 6);
    return Math.max(0, 50 - ((mortalityRate - 10) * 5));
  }
  
  /**
   * Feed efficiency score (FCR optimization)
   */
  async getFeedEfficiencyScore(organizationId) {
    const result = await db.pool.query(
      `SELECT AVG(feed_conversion_ratio) as avg_fcr
       FROM fish_batches fb
       JOIN ponds p ON fb.pond_id = p.id
       WHERE p.organization_id = $1
         AND fb.status = 'active'
         AND fb.feed_conversion_ratio IS NOT NULL`,
      [organizationId]
    );
    
    const avgFcr = parseFloat(result.rows[0]?.avg_fcr || 2.0);
    
    // Score based on FCR (lower is better)
    // FCR < 1.2 = 100, 1.2-1.5 = 80-100, 1.5-2.0 = 50-80, > 2.0 = < 50
    if (avgFcr <= 1.2) return 100;
    if (avgFcr <= 1.5) return 100 - ((avgFcr - 1.2) * 66.67);
    if (avgFcr <= 2.0) return 80 - ((avgFcr - 1.5) * 60);
    return Math.max(0, 50 - ((avgFcr - 2.0) * 25));
  }
  
  /**
   * Operational consistency score
   */
  async getOperationalScore(organizationId) {
    // Check feeding schedule adherence
    const feedingAdherence = await db.pool.query(
      `SELECT 
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 2) as adherence_rate
       FROM feeding_records fr
       JOIN ponds p ON fr.pond_id = p.id
       WHERE p.organization_id = $1
         AND scheduled_time > NOW() - INTERVAL '30 days'`,
      [organizationId]
    );
    
    // Check maintenance task completion
    const maintenanceCompletion = await db.pool.query(
      `SELECT 
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 2) as completion_rate
       FROM maintenance_tasks mt
       JOIN ponds p ON mt.pond_id = p.id
       WHERE p.organization_id = $1
         AND due_date > NOW() - INTERVAL '30 days'`,
      [organizationId]
    );
    
    const feedingScore = parseFloat(feedingAdherence.rows[0]?.adherence_rate || 0);
    const maintenanceScore = parseFloat(maintenanceCompletion.rows[0]?.completion_rate || 0);
    
    return (feedingScore + maintenanceScore) / 2;
  }
  
  /**
   * Sustainability practices score
   */
  async getSustainabilityScore(organizationId) {
    let score = 50; // Base score
    
    // Bonus for renewable energy usage
    const energyData = await db.pool.query(
      `SELECT 
        SUM(energy_kwh) as total_energy,
        SUM(energy_kwh) FILTER (WHERE source = 'solar') as solar_energy
       FROM energy_consumption ec
       JOIN devices d ON ec.device_id = d.id
       JOIN ponds p ON d.pond_id = p.id
       WHERE p.organization_id = $1
         AND recorded_at > NOW() - INTERVAL '30 days'`,
      [organizationId]
    );
    
    const totalEnergy = parseFloat(energyData.rows[0]?.total_energy || 0);
    const solarEnergy = parseFloat(energyData.rows[0]?.solar_energy || 0);
    
    if (totalEnergy > 0) {
      const solarPercentage = (solarEnergy / totalEnergy) * 100;
      score += Math.min(solarPercentage * 0.3, 20); // Up to 20 points
    }
    
    // Bonus for water recycling
    const waterRecycling = await db.pool.query(
      `SELECT COUNT(*) as recycling_systems
       FROM farms f
       WHERE f.organization_id = $1
         AND f.farm_type IN ('ras', 'recirculating')`,
      [organizationId]
    );
    
    if (parseInt(waterRecycling.rows[0]?.recycling_systems || 0) > 0) {
      score += 15;
    }
    
    // Bonus for certifications
    const certifications = await db.pool.query(
      `SELECT COUNT(*) as active_certs
       FROM farm_certifications fc
       JOIN farms f ON fc.farm_id = f.id
       WHERE f.organization_id = $1
         AND fc.expiry_date > NOW()`,
      [organizationId]
    );
    
    const certCount = parseInt(certifications.rows[0]?.active_certs || 0);
    score += Math.min(certCount * 5, 15); // Up to 15 points
    
    return Math.min(score, 100);
  }
  
  /**
   * Get level from score
   */
  getLevelFromScore(score) {
    if (score >= 90) return 'Master Farmer';
    if (score >= 80) return 'Expert Farmer';
    if (score >= 70) return 'Advanced Farmer';
    if (score >= 60) return 'Intermediate Farmer';
    if (score >= 50) return 'Novice Farmer';
    return 'Beginner';
  }
  
  /**
   * Get next level threshold
   */
  getNextLevelThreshold(currentLevel) {
    const thresholds = {
      'Beginner': 50,
      'Novice Farmer': 60,
      'Intermediate Farmer': 70,
      'Advanced Farmer': 80,
      'Expert Farmer': 90,
      'Master Farmer': null
    };
    return thresholds[currentLevel];
  }
  
  /**
   * Award badges/achievements
   */
  async awardBadges(organizationId) {
    const badges = [];
    
    // Check various achievements
    const achievements = await this.checkAchievements(organizationId);
    
    for (const achievement of achievements) {
      // Check if already awarded
      const exists = await db.pool.query(
        `SELECT * FROM farmer_badges 
         WHERE organization_id = $1 AND badge_code = $2`,
        [organizationId, achievement.code]
      );
      
      if (exists.rows.length === 0) {
        // Award new badge
        const badge = await db.pool.query(
          `INSERT INTO farmer_badges (
            organization_id, badge_code, badge_name, description, awarded_at
          ) VALUES ($1, $2, $3, $4, NOW())
          RETURNING *`,
          [organizationId, achievement.code, achievement.name, achievement.description]
        );
        
        badges.push(badge.rows[0]);
        
        // Notify farmer
        await sendNotification(organizationId, {
          type: 'badge_awarded',
          title: 'New Badge Earned!',
          message: `Congratulations! You've earned the "${achievement.name}" badge`,
          data: { badge: badge.rows[0] }
        });
      }
    }
    
    return badges;
  }
  
  /**
   * Check achievements
   */
  async checkAchievements(organizationId) {
    const achievements = [];
    
    // Perfect Week (no alerts for 7 days)
    const alertCheck = await db.pool.query(
      `SELECT COUNT(*) as alert_count
       FROM alerts
       WHERE organization_id = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [organizationId]
    );
    
    if (parseInt(alertCheck.rows[0].alert_count) === 0) {
      achievements.push({
        code: 'PERFECT_WEEK',
        name: 'Perfect Week',
        description: 'No alerts for 7 consecutive days'
      });
    }
    
    // High Efficiency (FCR < 1.3)
    const fcrCheck = await db.pool.query(
      `SELECT AVG(feed_conversion_ratio) as avg_fcr
       FROM fish_batches fb
       JOIN ponds p ON fb.pond_id = p.id
       WHERE p.organization_id = $1`,
      [organizationId]
    );
    
    if (parseFloat(fcrCheck.rows[0].avg_fcr) < 1.3) {
      achievements.push({
        code: 'FEED_MASTER',
        name: 'Feed Master',
        description: 'Achieved FCR below 1.3'
      });
    }
    
    // Early Adopter (using platform > 1 year)
    const tenureCheck = await db.pool.query(
      `SELECT created_at FROM organizations WHERE id = $1`,
      [organizationId]
    );
    
    const daysSinceCreation = (Date.now() - new Date(tenureCheck.rows[0].created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation > 365) {
      achievements.push({
        code: 'EARLY_ADOPTER',
        name: 'Early Adopter',
        description: 'Using the platform for over 1 year'
      });
    }
    
    return achievements;
  }
  
  /**
   * Connect with consultant
   */
  async requestConsultation(organizationId, requestData) {
    const consultation = await db.pool.query(
      `INSERT INTO consultant_requests (
        organization_id, consultant_specialization, issue_description,
        preferred_date, urgency, status
      ) VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *`,
      [
        organizationId,
        requestData.specialization, // 'water_quality', 'disease', 'nutrition', 'operations'
        requestData.description,
        requestData.preferredDate,
        requestData.urgency // 'low', 'medium', 'high', 'critical'
      ]
    );
    
    // Notify available consultants
    await sendNotification(null, {
      type: 'consultant_request_available',
      title: 'New Consultation Request',
      message: `A farmer needs help with ${requestData.specialization}`,
      data: { requestId: consultation.rows[0].id },
      broadcast: true,
      recipientRole: 'consultant'
    });
    
    return consultation.rows[0];
  }
  
  /**
   * Get leaderboard ranking
   */
  async getLeaderboard(region, limit = 10) {
    const query = region 
      ? `SELECT 
           o.name as farm_name,
           fp.total_score,
           fp.level,
           o.location
         FROM farmer_profiles fp
         JOIN organizations o ON fp.organization_id = o.id
         WHERE ST_DWithin(
           o.location::geography,
           ST_MakePoint($1, $2)::geography,
           $3 * 1000
         )
         ORDER BY fp.total_score DESC
         LIMIT $4`
      : `SELECT 
           o.name as farm_name,
           fp.total_score,
           fp.level
         FROM farmer_profiles fp
         JOIN organizations o ON fp.organization_id = o.id
         ORDER BY fp.total_score DESC
         LIMIT $1`;
    
    const params = region ? [...region, limit] : [limit];
    
    const result = await db.pool.query(query, params);
    return result.rows;
  }
}

module.exports = new GrowthService();

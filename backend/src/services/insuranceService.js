/**
 * Insurance Service - Parametric Insurance for Aquaculture
 * Automatically triggers payouts based on IoT sensor data thresholds
 * Integrates with weather APIs, mortality rates, and water quality events
 */

const db = require('../db');
const { sendNotification } = require('./notificationService');

class InsuranceService {
  /**
   * Create an insurance policy for a farm/pond
   */
  async createPolicy(organizationId, policyData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Calculate premium based on risk factors
      const riskScore = await this.calculateRiskScore(organizationId, policyData);
      const premium = this.calculatePremium(policyData, riskScore);
      
      const policy = await client.query(
        `INSERT INTO insurance_policies (
          organization_id, farm_id, pond_id, policy_type, coverage_amount,
          deductible, premium_amount, currency, start_date, end_date,
          trigger_conditions, status, risk_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          organizationId,
          policyData.farmId,
          policyData.pondId || null,
          policyData.type, // 'mortality', 'water_quality', 'weather', 'comprehensive'
          policyData.coverageAmount,
          policyData.deductible || 0,
          premium,
          policyData.currency || 'USD',
          policyData.startDate,
          policyData.endDate,
          JSON.stringify(policyData.triggerConditions),
          'active',
          riskScore
        ]
      );
      
      // Create payment schedule
      await this.createPaymentSchedule(policy.rows[0].id, premium, policyData.paymentFrequency);
      
      await client.query('COMMIT');
      return policy.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Calculate risk score based on historical data
   */
  async calculateRiskScore(organizationId, policyData) {
    let riskScore = 50; // Base score (0-100, higher = riskier)
    
    // Get historical mortality data
    const mortalityData = await db.pool.query(
      `SELECT 
        COUNT(*) as total_mortality_events,
        AVG(mortality_count) as avg_daily_mortality,
        MAX(mortality_count) as max_daily_mortality
       FROM fish_mortality_records
       WHERE organization_id = $1
         AND event_date > NOW() - INTERVAL '1 year'`,
      [organizationId]
    );
    
    if (mortalityData.rows[0].total_mortality_events > 10) {
      riskScore += 15;
    } else if (mortalityData.rows[0].total_mortality_events > 5) {
      riskScore += 8;
    }
    
    // Get historical water quality alerts
    const alertData = await db.pool.query(
      `SELECT COUNT(*) as critical_alerts
       FROM alerts
       WHERE organization_id = $1
         AND severity = 'critical'
         AND created_at > NOW() - INTERVAL '1 year'`,
      [organizationId]
    );
    
    if (alertData.rows[0].critical_alerts > 20) {
      riskScore += 12;
    } else if (alertData.rows[0].critical_alerts > 10) {
      riskScore += 6;
    }
    
    // Adjust for location (weather patterns)
    if (policyData.location) {
      // Could integrate with weather history API here
      riskScore += 5; // Placeholder for weather risk
    }
    
    // Cap at 100
    return Math.min(riskScore, 100);
  }
  
  /**
   * Calculate premium based on coverage and risk
   */
  calculatePremium(policyData, riskScore) {
    const baseRate = 0.02; // 2% of coverage amount
    const riskMultiplier = 1 + (riskScore / 100);
    
    let premium = policyData.coverageAmount * baseRate * riskMultiplier;
    
    // Adjustments for policy type
    if (policyData.type === 'comprehensive') {
      premium *= 1.5;
    } else if (policyData.type === 'weather') {
      premium *= 0.8;
    }
    
    // Discount for good monitoring (IoT devices reduce risk)
    premium *= 0.9; // 10% discount for IoT-monitored farms
    
    return Math.round(premium * 100) / 100;
  }
  
  /**
   * Create payment schedule for policy premium
   */
  async createPaymentSchedule(policyId, totalPremium, frequency = 'monthly') {
    const payments = [];
    const numPayments = frequency === 'annual' ? 1 : frequency === 'quarterly' ? 4 : 12;
    const paymentAmount = totalPremium / numPayments;
    
    for (let i = 0; i < numPayments; i++) {
      payments.push({
        policy_id: policyId,
        due_date: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
        amount: paymentAmount,
        status: 'pending'
      });
    }
    
    const values = payments.map((p, idx) => 
      `($1, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`
    ).join(',');
    
    await db.pool.query(
      `INSERT INTO insurance_payments (policy_id, due_date, amount, status)
       VALUES ${values}`,
      [policyId, ...payments.flatMap(p => [p.due_date, p.amount, p.status])]
    );
  }
  
  /**
   * Check for automatic payout triggers (parametric insurance)
   * Called by automated job or when sensor data updates
   */
  async checkPayoutTriggers() {
    const activePolicies = await db.pool.query(
      `SELECT * FROM insurance_policies WHERE status = 'active' AND end_date > NOW()`
    );
    
    for (const policy of activePolicies.rows) {
      const triggers = policy.trigger_conditions;
      let payoutAmount = 0;
      let triggerEvent = null;
      
      // Check mortality-based triggers
      if (triggers.mortalityThreshold) {
        const recentMortality = await db.pool.query(
          `SELECT SUM(mortality_count) as total_deaths
           FROM fish_mortality_records
           WHERE pond_id = $1
             AND event_date > NOW() - INTERVAL '${triggers.mortalityPeriod || '7 days'}'`,
          [policy.pond_id]
        );
        
        const totalDeaths = parseInt(recentMortality.rows[0].total_deaths) || 0;
        if (totalDeaths >= triggers.mortalityThreshold) {
          payoutAmount = Math.min(
            policy.coverage_amount,
            totalDeaths * triggers.payoutPerDeath
          );
          triggerEvent = { type: 'mortality', count: totalDeaths };
        }
      }
      
      // Check water quality triggers (e.g., low DO for extended period)
      if (triggers.waterQuality && !payoutAmount) {
        const waterAlerts = await db.pool.query(
          `SELECT COUNT(*) as alert_count, MAX(created_at) as last_alert
           FROM alerts
           WHERE pond_id = $1
             AND alert_type IN ('low_dissolved_oxygen', 'high_ammonia', 'ph_out_of_range')
             AND created_at > NOW() - INTERVAL '${triggers.waterQuality.period || '24 hours'}'
             AND severity = 'critical'`,
          [policy.pond_id]
        );
        
        if (parseInt(waterAlerts.rows[0].alert_count) >= triggers.waterQuality.threshold) {
          payoutAmount = triggers.waterQuality.payoutAmount;
          triggerEvent = { type: 'water_quality', alerts: waterAlerts.rows[0].alert_count };
        }
      }
      
      // Check weather triggers (requires integration with weather API)
      if (triggers.weather && !payoutAmount) {
        // Placeholder for weather API integration
        // Would check for extreme temperatures, storms, etc.
      }
      
      // Process payout if triggered
      if (payoutAmount > 0) {
        await this.processAutomaticPayout(policy.id, payoutAmount, triggerEvent);
      }
    }
  }
  
  /**
   * Process automatic parametric payout
   */
  async processAutomaticPayout(policyId, amount, triggerEvent) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create payout record
      const payout = await client.query(
        `INSERT INTO insurance_payouts (
          policy_id, amount, currency, trigger_event, status, processed_at
        ) VALUES ($1, $2, $3, $4, 'pending', NOW())
        RETURNING *`,
        [policyId, amount, 'USD', JSON.stringify(triggerEvent)]
      );
      
      // Get policy details
      const policy = await client.query(
        `SELECT * FROM insurance_policies WHERE id = $1`,
        [policyId]
      );
      
      // Notify organization
      await sendNotification(policy.rows[0].organization_id, {
        type: 'insurance_payout_triggered',
        title: 'Automatic Insurance Payout Triggered',
        message: `A payout of ${amount} USD has been automatically triggered due to ${triggerEvent.type}`,
        data: { payoutId: payout.rows[0].id, amount, triggerEvent }
      });
      
      // Here you would integrate with payment gateway to transfer funds
      // Update payout status to 'completed' after transfer
      
      await client.query(
        `UPDATE insurance_payouts SET status = 'completed' WHERE id = $1`,
        [payout.rows[0].id]
      );
      
      await client.query('COMMIT');
      return payout.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * File a manual insurance claim
   */
  async fileClaim(policyId, organizationId, claimData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Verify policy ownership and status
      const policyCheck = await client.query(
        `SELECT * FROM insurance_policies 
         WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
        [policyId, organizationId]
      );
      
      if (policyCheck.rows.length === 0) {
        throw new Error('Valid policy not found');
      }
      
      const claim = await client.query(
        `INSERT INTO insurance_claims (
          policy_id, organization_id, claim_type, description,
          claimed_amount, supporting_documents, incident_date, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted')
        RETURNING *`,
        [
          policyId,
          organizationId,
          claimData.type,
          claimData.description,
          claimData.amount,
          JSON.stringify(claimData.documents),
          claimData.incidentDate
        ]
      );
      
      // Notify claims adjusters
      await sendNotification(organizationId, {
        type: 'insurance_claim_submitted',
        title: 'Claim Submitted',
        message: 'Your insurance claim has been submitted for review',
        data: { claimId: claim.rows[0].id }
      });
      
      await client.query('COMMIT');
      return claim.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new InsuranceService();

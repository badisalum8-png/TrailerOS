/**
 * Subscription Plan Service
 * Manages subscription tiers, limits, and billing cycles
 */
const db = require('../db');

class SubscriptionService {
  /**
   * Create a new subscription plan (System Owner only)
   */
  static async createPlan(planData) {
    const {
      name,
      monthly_price,
      annual_price,
      max_farms,
      max_ponds,
      max_users,
      max_devices,
      data_retention_days,
      features // JSON array of enabled features
    } = planData;

    const query = `
      INSERT INTO subscription_plans 
      (name, monthly_price, annual_price, max_farms, max_ponds, max_users, max_devices, data_retention_days, features)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    
    const values = [name, monthly_price, annual_price, max_farms, max_ponds, max_users, max_devices, data_retention_days, JSON.stringify(features)];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Subscribe an organization to a plan
   */
  static async subscribeOrganization(organizationId, planId, billingCycle = 'monthly') {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Get plan details
      const planResult = await client.query(
        'SELECT * FROM subscription_plans WHERE id = $1',
        [planId]
      );
      
      if (planResult.rows.length === 0) {
        throw new Error('Plan not found');
      }
      
      const plan = planResult.rows[0];
      const startDate = new Date();
      const endDate = billingCycle === 'annual' 
        ? new Date(startDate.setFullYear(startDate.getFullYear() + 1))
        : new Date(startDate.setMonth(startDate.getMonth() + 1));
      
      // Create or update subscription
      const subQuery = `
        INSERT INTO subscriptions 
        (organization_id, plan_id, billing_cycle, start_date, end_date, status, current_period_start, current_period_end)
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
        ON CONFLICT (organization_id) 
        DO UPDATE SET 
          plan_id = $2,
          billing_cycle = $3,
          end_date = $5,
          status = 'active',
          current_period_start = $6,
          current_period_end = $7,
          updated_at = NOW()
        RETURNING *
      `;
      
      const subResult = await client.query(subQuery, [
        organizationId, 
        planId, 
        billingCycle, 
        startDate, 
        endDate, 
        startDate, 
        endDate
      ]);
      
      // Create invoice
      const amount = billingCycle === 'annual' ? plan.annual_price : plan.monthly_price;
      const invoiceResult = await client.query(`
        INSERT INTO invoices 
        (organization_id, subscription_id, amount, currency, status, period_start, period_end, description)
        VALUES ($1, $2, $3, 'USD', 'pending', $4, $5, $6)
        RETURNING *
      `, [
        organizationId, 
        subResult.rows[0].id, 
        amount, 
        startDate, 
        endDate, 
        `${plan.name} - ${billingCycle} subscription`
      ]);
      
      await client.query('COMMIT');
      
      return {
        subscription: subResult.rows[0],
        invoice: invoiceResult.rows[0]
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check organization limits before creating resources
   */
  static async checkLimits(organizationId, resourceType) {
    const query = `
      SELECT 
        sp.max_farms,
        sp.max_ponds,
        sp.max_users,
        sp.max_devices,
        COUNT(DISTINCT f.id) as current_farms,
        COUNT(DISTINCT p.id) as current_ponds,
        COUNT(DISTINCT u.id) as current_users,
        COUNT(DISTINCT d.id) as current_devices
      FROM organizations o
      JOIN subscriptions s ON o.id = s.organization_id
      JOIN subscription_plans sp ON s.plan_id = sp.id
      LEFT JOIN farms f ON o.id = f.organization_id AND f.archived = false
      LEFT JOIN ponds p ON f.id = p.farm_id
      LEFT JOIN users u ON o.id = u.organization_id
      LEFT JOIN devices d ON o.id = d.organization_id
      WHERE o.id = $1
      GROUP BY sp.max_farms, sp.max_ponds, sp.max_users, sp.max_devices
    `;
    
    const result = await db.query(query, [organizationId]);
    
    if (result.rows.length === 0) {
      throw new Error('No active subscription found');
    }
    
    const limits = result.rows[0];
    
    switch (resourceType) {
      case 'farm':
        if (limits.current_farms >= limits.max_farms) {
          throw new Error(`Farm limit reached: ${limits.current_farms}/${limits.max_farms}`);
        }
        break;
      case 'pond':
        if (limits.current_ponds >= limits.max_ponds) {
          throw new Error(`Pond limit reached: ${limits.current_ponds}/${limits.max_ponds}`);
        }
        break;
      case 'user':
        if (limits.current_users >= limits.max_users) {
          throw new Error(`User limit reached: ${limits.current_users}/${limits.max_users}`);
        }
        break;
      case 'device':
        if (limits.current_devices >= limits.max_devices) {
          throw new Error(`Device limit reached: ${limits.current_devices}/${limits.max_devices}`);
        }
        break;
    }
    
    return true;
  }

  /**
   * Get current subscription status for an organization
   */
  static async getSubscriptionStatus(organizationId) {
    const query = `
      SELECT 
        s.*,
        sp.name as plan_name,
        sp.features,
        i.status as invoice_status,
        i.amount as last_invoice_amount,
        i.due_date as next_billing_date
      FROM subscriptions s
      JOIN subscription_plans sp ON s.plan_id = sp.id
      LEFT JOIN invoices i ON s.id = i.subscription_id
      WHERE s.organization_id = $1
      ORDER BY i.created_at DESC
      LIMIT 1
    `;
    
    const result = await db.query(query, [organizationId]);
    return result.rows[0] || null;
  }
}

module.exports = SubscriptionService;

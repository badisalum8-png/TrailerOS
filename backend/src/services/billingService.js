import { query } from '../db/index.js';

/**
 * Subscription & Billing Service
 * Manages subscription plans, invoices, payments, and dunning
 */

// Subscription Plans
export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Free Tier',
    price: 0,
    currency: 'USD',
    interval: 'month',
    features: {
      maxPonds: 5,
      maxDevices: 10,
      dataRetention: 7, // days
      alertsPerMonth: 50,
      apiCallsPerDay: 1000,
      supportLevel: 'community'
    }
  },
  STARTER: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    currency: 'USD',
    interval: 'month',
    features: {
      maxPonds: 20,
      maxDevices: 50,
      dataRetention: 30,
      alertsPerMonth: 500,
      apiCallsPerDay: 10000,
      supportLevel: 'email'
    }
  },
  PROFESSIONAL: {
    id: 'professional',
    name: 'Professional',
    price: 99,
    currency: 'USD',
    interval: 'month',
    features: {
      maxPonds: 100,
      maxDevices: 250,
      dataRetention: 365,
      alertsPerMonth: 5000,
      apiCallsPerDay: 100000,
      supportLevel: 'priority'
    }
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 499,
    currency: 'USD',
    interval: 'month',
    features: {
      maxPonds: -1, // unlimited
      maxDevices: -1,
      dataRetention: -1,
      alertsPerMonth: -1,
      apiCallsPerDay: -1,
      supportLevel: 'dedicated'
    }
  }
};

/**
 * Create a subscription for an organization
 */
export const createSubscription = async (organizationId, planId, paymentMethodId = null) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');
    
    const plan = PLANS[planId.toUpperCase()];
    if (!plan) {
      throw new Error(`Invalid plan: ${planId}`);
    }

    // Check if organization already has an active subscription
    const existingSub = await client.query(
      `SELECT * FROM subscriptions 
       WHERE organization_id = $1 AND status IN ('active', 'trialing')`,
      [organizationId]
    );

    if (existingSub.rows.length > 0) {
      throw new Error('Organization already has an active subscription');
    }

    // Create subscription
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial

    const result = await client.query(
      `INSERT INTO subscriptions (
        organization_id, plan_id, status, current_period_start, current_period_end, 
        trial_ends_at, cancel_at_period_end, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [
        organizationId,
        plan.id,
        plan.price === 0 ? 'active' : 'trialing',
        new Date(),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        plan.price > 0 ? trialEndsAt : null,
        false
      ]
    );

    // Create initial invoice if not free tier
    let invoice = null;
    if (plan.price > 0) {
      const invoiceResult = await client.query(
        `INSERT INTO invoices (
          organization_id, subscription_id, amount, currency, status, 
          due_date, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *`,
        [
          organizationId,
          result.rows[0].id,
          plan.price,
          plan.currency,
          'pending',
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        ]
      );
      invoice = invoiceResult.rows[0];
    }

    await client.query('COMMIT');

    return {
      subscription: result.rows[0],
      invoice
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get subscription by organization ID
 */
export const getSubscriptionByOrganization = async (organizationId) => {
  const result = await query(
    `SELECT s.*, p.name as plan_name, p.price, p.currency, p.interval
     FROM subscriptions s
     JOIN plans p ON s.plan_id = p.id
     WHERE s.organization_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [organizationId]
  );
  
  return result.rows[0] || null;
};

/**
 * Update subscription status
 */
export const updateSubscriptionStatus = async (subscriptionId, status) => {
  const validStatuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid subscription status: ${status}`);
  }

  const result = await query(
    `UPDATE subscriptions 
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, subscriptionId]
  );

  return result.rows[0];
};

/**
 * Create an invoice
 */
export const createInvoice = async (organizationId, subscriptionId, amount, currency = 'USD', description = null) => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30); // Net 30

  const result = await query(
    `INSERT INTO invoices (
      organization_id, subscription_id, amount, currency, status, 
      description, due_date, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING *`,
    [organizationId, subscriptionId, amount, currency, 'pending', description, dueDate]
  );

  return result.rows[0];
};

/**
 * Get all invoices for an organization
 */
export const getInvoicesByOrganization = async (organizationId, limit = 50, offset = 0) => {
  const result = await query(
    `SELECT i.*, s.plan_id
     FROM invoices i
     LEFT JOIN subscriptions s ON i.subscription_id = s.id
     WHERE i.organization_id = $1
     ORDER BY i.created_at DESC
     LIMIT $2 OFFSET $3`,
    [organizationId, limit, offset]
  );

  const totalResult = await query(
    `SELECT COUNT(*) as total FROM invoices WHERE organization_id = $1`,
    [organizationId]
  );

  return {
    invoices: result.rows,
    total: parseInt(totalResult.rows[0].total),
    limit,
    offset
  };
};

/**
 * Mark invoice as paid
 */
export const markInvoicePaid = async (invoiceId, paymentMethod = null) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');

    // Update invoice status
    const result = await client.query(
      `UPDATE invoices 
       SET status = 'paid', paid_at = NOW(), payment_method = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [paymentMethod, invoiceId]
    );

    // If invoice is associated with a subscription, update subscription status
    const invoice = result.rows[0];
    if (invoice.subscription_id) {
      await client.query(
        `UPDATE subscriptions 
         SET status = 'active', current_period_start = current_period_end,
             current_period_end = current_period_end + (interval '1 month' * 
               (SELECT interval_months FROM plans WHERE id = (
                 SELECT plan_id FROM subscriptions WHERE id = $1
               ))),
             updated_at = NOW()
         WHERE id = $2`,
        [invoice.subscription_id, invoice.subscription_id]
      );
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Handle failed payment (dunning)
 */
export const handlePaymentFailure = async (invoiceId, failureReason) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');

    // Update invoice
    await client.query(
      `UPDATE invoices 
       SET status = 'failed', failure_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [failureReason, invoiceId]
    );

    // Get subscription and increment failure count
    const subResult = await client.query(
      `SELECT s.* FROM invoices i
       JOIN subscriptions s ON i.subscription_id = s.id
       WHERE i.id = $1`,
      [invoiceId]
    );

    if (subResult.rows.length > 0) {
      const subscription = subResult.rows[0];
      const failureCount = (subscription.payment_failure_count || 0) + 1;

      // Determine new status based on failure count
      let newStatus = subscription.status;
      if (failureCount >= 3) {
        newStatus = 'canceled';
      } else if (failureCount >= 1) {
        newStatus = 'past_due';
      }

      await client.query(
        `UPDATE subscriptions 
         SET status = $1, payment_failure_count = $2, updated_at = NOW()
         WHERE id = $3`,
        [newStatus, failureCount, subscription.id]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Cancel subscription
 */
export const cancelSubscription = async (subscriptionId, cancelAtPeriodEnd = true) => {
  if (cancelAtPeriodEnd) {
    const result = await query(
      `UPDATE subscriptions 
       SET cancel_at_period_end = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [subscriptionId]
    );
    return result.rows[0];
  } else {
    // Immediate cancellation
    const result = await query(
      `UPDATE subscriptions 
       SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [subscriptionId]
    );
    return result.rows[0];
  }
};

/**
 * Check feature access based on subscription
 */
export const checkFeatureAccess = async (organizationId, feature, value = 1) => {
  const subResult = await query(
    `SELECT s.plan_id, s.status
     FROM subscriptions s
     WHERE s.organization_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [organizationId]
  );

  if (subResult.rows.length === 0) {
    // No subscription, use free tier
    const plan = PLANS.FREE;
    return checkFeatureLimit(plan.features, feature, value);
  }

  const subscription = subResult.rows[0];
  
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    return { allowed: false, reason: 'subscription_inactive' };
  }

  const plan = PLANS[subscription.plan_id.toUpperCase()];
  if (!plan) {
    return { allowed: false, reason: 'invalid_plan' };
  }

  return checkFeatureLimit(plan.features, feature, value);
};

const checkFeatureLimit = (features, feature, value) => {
  const limit = features[feature];
  
  if (limit === undefined) {
    return { allowed: false, reason: 'feature_not_available' };
  }

  if (limit === -1) {
    return { allowed: true, limit: 'unlimited' };
  }

  const allowed = value <= limit;
  return {
    allowed,
    current: value,
    limit,
    remaining: allowed ? limit - value : 0
  };
};

/**
 * Get usage statistics for an organization
 */
export const getUsageStats = async (organizationId) => {
  const stats = {};

  // Count ponds
  const pondResult = await query(
    `SELECT COUNT(*) as count FROM ponds 
     WHERE organization_id = $1`,
    [organizationId]
  );
  stats.ponds = parseInt(pondResult.rows[0].count);

  // Count devices
  const deviceResult = await query(
    `SELECT COUNT(*) as count FROM devices 
     WHERE organization_id = $1`,
    [organizationId]
  );
  stats.devices = parseInt(deviceResult.rows[0].count);

  // Count API calls today
  const apiResult = await query(
    `SELECT COUNT(*) as count FROM api_logs 
     WHERE organization_id = $1 
     AND DATE(created_at) = CURRENT_DATE`,
    [organizationId]
  );
  stats.apiCallsToday = parseInt(apiResult.rows[0].count);

  // Count alerts this month
  const alertResult = await query(
    `SELECT COUNT(*) as count FROM alerts 
     WHERE organization_id = $1 
     AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
    [organizationId]
  );
  stats.alertsThisMonth = parseInt(alertResult.rows[0].count);

  // Get current plan limits
  const subResult = await query(
    `SELECT s.plan_id, s.status
     FROM subscriptions s
     WHERE s.organization_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [organizationId]
  );

  const planId = subResult.rows.length > 0 ? subResult.rows[0].plan_id : 'free';
  const plan = PLANS[planId.toUpperCase()] || PLANS.FREE;

  return {
    usage: stats,
    limits: plan.features,
    plan: plan.name
  };
};

export default {
  PLANS,
  createSubscription,
  getSubscriptionByOrganization,
  updateSubscriptionStatus,
  createInvoice,
  getInvoicesByOrganization,
  markInvoicePaid,
  handlePaymentFailure,
  cancelSubscription,
  checkFeatureAccess,
  getUsageStats
};

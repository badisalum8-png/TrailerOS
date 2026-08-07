import { query } from '../db/index.js';
import crypto from 'crypto';

/**
 * API Management & Webhook Service
 * Handles API keys, rate limiting, webhooks, and data export
 */

/**
 * Generate a new API key
 */
export const generateApiKey = (organizationId, name, permissions = ['read'], expiresAt = null) => {
  const prefix = 'ak_';
  const randomPart = crypto.randomBytes(24).toString('hex');
  const apiKey = `${prefix}${randomPart}`;
  
  // Hash the key for storage
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  return {
    apiKey, // Return this once to the user
    hash,   // Store this in database
    keyId: crypto.randomBytes(8).toString('hex')
  };
};

/**
 * Create an API key for an organization
 */
export const createApiKey = async (organizationId, userId, name, permissions = ['read'], expiresAt = null) => {
  const keyData = generateApiKey(organizationId, name, permissions, expiresAt);
  
  const result = await query(
    `INSERT INTO api_keys (
      key_id, organization_id, user_id, name, key_hash, 
      permissions, expires_at, last_used_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW(), NOW())
    RETURNING *`,
    [
      keyData.keyId,
      organizationId,
      userId,
      name,
      keyData.hash,
      JSON.stringify(permissions),
      expiresAt
    ]
  );

  // Log creation in audit trail
  await query(
    `INSERT INTO audit_logs (organization_id, user_id, action, category, resource_type, resource_id, description, created_at)
     VALUES ($1, $2, 'api_key_created', 'authorization', 'api_key', $3, 'Created new API key: ' || $4, NOW())`,
    [organizationId, userId, keyData.keyId, name]
  );

  return {
    apiKey: `${keyData.apiKey}`, // Return full key once
    key: result.rows[0]
  };
};

/**
 * Validate an API key
 */
export const validateApiKey = async (apiKey) => {
  if (!apiKey || !apiKey.startsWith('ak_')) {
    return { valid: false, reason: 'invalid_format' };
  }

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const result = await query(
    `SELECT ak.*, o.name as organization_name
     FROM api_keys ak
     JOIN organizations o ON ak.organization_id = o.id
     WHERE ak.key_hash = $1 
       AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
       AND ak.revoked_at IS NULL`,
    [hash]
  );

  if (result.rows.length === 0) {
    return { valid: false, reason: 'not_found_or_expired' };
  }

  const key = result.rows[0];

  // Update last used timestamp
  await query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE key_id = $1`,
    [key.key_id]
  );

  return {
    valid: true,
    key
  };
};

/**
 * Revoke an API key
 */
export const revokeApiKey = async (keyId, organizationId, userId, reason = null) => {
  const result = await query(
    `UPDATE api_keys 
     SET revoked_at = NOW(), revocation_reason = $1, updated_at = NOW()
     WHERE key_id = $2 AND organization_id = $3
     RETURNING *`,
    [reason, keyId, organizationId]
  );

  if (result.rows.length === 0) {
    throw new Error('API key not found');
  }

  // Audit log
  await query(
    `INSERT INTO audit_logs (organization_id, user_id, action, category, resource_type, resource_id, description, created_at)
     VALUES ($1, $2, 'api_key_revoked', 'authorization', 'api_key', $3, 'Revoked API key: ' || COALESCE($4, 'N/A'), NOW())`,
    [organizationId, userId, keyId, reason]
  );

  return result.rows[0];
};

/**
 * Get all API keys for an organization
 */
export const getApiKeysByOrganization = async (organizationId) => {
  const result = await query(
    `SELECT key_id, name, permissions, expires_at, last_used_at, created_at, revoked_at
     FROM api_keys
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId]
  );

  return result.rows;
};

/**
 * Check rate limit for an organization
 */
export const checkRateLimit = async (organizationId, endpoint, limit = 1000, windowMs = 86400000) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  // Count requests in the current window
  const countResult = await query(
    `SELECT COUNT(*) as count 
     FROM api_rate_logs 
     WHERE organization_id = $1 
       AND endpoint = $2 
       AND created_at > $3`,
    [organizationId, endpoint, windowStart]
  );

  const count = parseInt(countResult.rows[0].count);
  const remaining = Math.max(0, limit - count);
  const resetAt = new Date(now.getTime() + windowMs);

  // Log this request
  await query(
    `INSERT INTO api_rate_logs (organization_id, endpoint, created_at)
     VALUES ($1, $2, NOW())`,
    [organizationId, endpoint]
  );

  return {
    allowed: count < limit,
    limit,
    remaining,
    resetAt,
    count
  };
};

/**
 * Create a webhook endpoint
 */
export const createWebhook = async (organizationId, url, events, secret = null, active = true) => {
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
  }

  const result = await query(
    `INSERT INTO webhooks (
      organization_id, url, events, secret, active, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING *`,
    [organizationId, url, JSON.stringify(events), secret, active]
  );

  return result.rows[0];
};

/**
 * Get webhooks by organization
 */
export const getWebhooksByOrganization = async (organizationId, active = null) => {
  let whereClause = 'organization_id = $1';
  let params = [organizationId];

  if (active !== null) {
    whereClause += ' AND active = $2';
    params.push(active);
  }

  const result = await query(
    `SELECT id, url, events, active, created_at, updated_at, last_triggered_at, failure_count
     FROM webhooks
     WHERE ${whereClause}
     ORDER BY created_at DESC`,
    params
  );

  return result.rows;
};

/**
 * Trigger webhooks for an event
 */
export const triggerWebhooks = async (organizationId, eventType, payload) => {
  const webhooks = await getWebhooksByOrganization(organizationId, true);
  
  const triggered = [];
  const failed = [];

  for (const webhook of webhooks.rows) {
    const events = JSON.parse(webhook.events);
    
    if (events.includes(eventType) || events.includes('*')) {
      try {
        // In production, this would use a queue system like Bull or RabbitMQ
        // For now, we'll log the webhook delivery attempt
        const signature = generateWebhookSignature(payload, webhook.secret);
        
        await query(
          `INSERT INTO webhook_deliveries (
            webhook_id, event_type, payload, signature, status, attempts, created_at
          ) VALUES ($1, $2, $3, $4, 'pending', 0, NOW())
          RETURNING *`,
          [webhook.id, eventType, JSON.stringify(payload), signature]
        );

        triggered.push({
          webhookId: webhook.id,
          url: webhook.url,
          eventType
        });
      } catch (error) {
        failed.push({
          webhookId: webhook.id,
          error: error.message
        });
      }
    }
  }

  return { triggered, failed };
};

/**
 * Generate webhook signature (HMAC-SHA256)
 */
export const generateWebhookSignature = (payload, secret) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadString}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
};

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = (payload, signature, secret, tolerance = 300) => {
  try {
    const parts = signature.split(',');
    const timestampPart = parts.find(p => p.startsWith('t='));
    const signaturePart = parts.find(p => p.startsWith('v1='));

    if (!timestampPart || !signaturePart) {
      return false;
    }

    const timestamp = parseInt(timestampPart.split('=')[1]);
    const providedSignature = signaturePart.split('=')[1];

    // Check timestamp tolerance (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      return false;
    }

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signedPayload = `${timestamp}.${payloadString}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    return false;
  }
};

/**
 * Get webhook delivery history
 */
export const getWebhookDeliveries = async (webhookId, limit = 50, offset = 0) => {
  const result = await query(
    `SELECT id, event_type, payload, signature, status, response_code, response_body, 
            attempts, next_retry_at, created_at, delivered_at
     FROM webhook_deliveries
     WHERE webhook_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [webhookId, limit, offset]
  );

  const totalResult = await query(
    `SELECT COUNT(*) as total FROM webhook_deliveries WHERE webhook_id = $1`,
    [webhookId]
  );

  return {
    deliveries: result.rows,
    total: parseInt(totalResult.rows[0].total),
    limit,
    offset
  };
};

/**
 * Retry failed webhook delivery
 */
export const retryWebhookDelivery = async (deliveryId) => {
  const result = await query(
    `UPDATE webhook_deliveries 
     SET status = 'pending', attempts = attempts + 1, next_retry_at = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING *`,
    [deliveryId]
  );

  if (result.rows.length === 0) {
    throw new Error('Delivery not found or not in failed status');
  }

  return result.rows[0];
};

/**
 * Export organization data
 */
export const exportOrganizationData = async (organizationId, dataTypes = ['all'], format = 'json') => {
  const exportData = {};
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (dataTypes.includes('all') || dataTypes.includes('farms')) {
    const farmsResult = await query(
      `SELECT * FROM farms WHERE organization_id = $1`,
      [organizationId]
    );
    exportData.farms = farmsResult.rows;
  }

  if (dataTypes.includes('all') || dataTypes.includes('ponds')) {
    const pondsResult = await query(
      `SELECT * FROM ponds WHERE organization_id = $1`,
      [organizationId]
    );
    exportData.ponds = pondsResult.rows;
  }

  if (dataTypes.includes('all') || dataTypes.includes('devices')) {
    const devicesResult = await query(
      `SELECT * FROM devices WHERE organization_id = $1`,
      [organizationId]
    );
    exportData.devices = devicesResult.rows;
  }

  if (dataTypes.includes('all') || dataTypes.includes('telemetry')) {
    const telemetryResult = await query(
      `SELECT * FROM telemetry_data 
       WHERE organization_id = $1 
       ORDER BY timestamp DESC 
       LIMIT 10000`,
      [organizationId]
    );
    exportData.telemetry = telemetryResult.rows;
  }

  if (dataTypes.includes('all') || dataTypes.includes('alerts')) {
    const alertsResult = await query(
      `SELECT * FROM alerts WHERE organization_id = $1`,
      [organizationId]
    );
    exportData.alerts = alertsResult.rows;
  }

  // Log the export
  await query(
    `INSERT INTO data_exports (
      organization_id, data_types, format, status, created_at
    ) VALUES ($1, $2, $3, 'completed', NOW())
    RETURNING *`,
    [organizationId, JSON.stringify(dataTypes), format]
  );

  return {
    filename: `aquaculture_export_${timestamp}.${format}`,
    data: exportData,
    exportedAt: new Date()
  };
};

/**
 * Get data export history
 */
export const getDataExportHistory = async (organizationId, limit = 20) => {
  const result = await query(
    `SELECT * FROM data_exports
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [organizationId, limit]
  );

  return result.rows;
};

/**
 * Clean up old rate limit logs (maintenance task)
 */
export const cleanupRateLimitLogs = async (olderThanDays = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await query(
    `DELETE FROM api_rate_logs WHERE created_at < $1`,
    [cutoffDate]
  );

  return { deletedCount: result.rowCount };
};

/**
 * Clean up old webhook deliveries (maintenance task)
 */
export const cleanupWebhookDeliveries = async (olderThanDays = 90) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await query(
    `DELETE FROM webhook_deliveries WHERE created_at < $1`,
    [cutoffDate]
  );

  return { deletedCount: result.rowCount };
};

export default {
  generateApiKey,
  createApiKey,
  validateApiKey,
  revokeApiKey,
  getApiKeysByOrganization,
  checkRateLimit,
  createWebhook,
  getWebhooksByOrganization,
  triggerWebhooks,
  generateWebhookSignature,
  verifyWebhookSignature,
  getWebhookDeliveries,
  retryWebhookDelivery,
  exportOrganizationData,
  getDataExportHistory,
  cleanupRateLimitLogs,
  cleanupWebhookDeliveries
};

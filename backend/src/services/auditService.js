import { query } from '../db/index.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

/**
 * Audit Logging Service
 * Provides comprehensive audit trails for compliance and security
 */

// Action categories
export const ACTION_CATEGORIES = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  DATA_ACCESS: 'data_access',
  DATA_MODIFICATION: 'data_modification',
  DATA_DELETION: 'data_deletion',
  CONFIGURATION: 'configuration',
  SYSTEM: 'system',
  EXPORT: 'export',
  API: 'api'
};

// Risk levels
export const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Log an audit event
 */
export const logAuditEvent = async (options) => {
  const {
    organizationId,
    userId,
    action,
    category,
    resourceType,
    resourceId,
    description,
    ipAddress,
    userAgent,
    metadata = {},
    riskLevel = RISK_LEVELS.LOW
  } = options;

  try {
    const result = await query(
      `INSERT INTO audit_logs (
        organization_id, user_id, action, category, resource_type, resource_id,
        description, ip_address, user_agent, metadata, risk_level, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        organizationId,
        userId,
        action,
        category,
        resourceType,
        resourceId,
        description,
        ipAddress,
        userAgent,
        JSON.stringify(metadata),
        riskLevel
      ]
    );

    // Also log to Winston for real-time monitoring
    logger.info('Audit event logged', {
      eventId: result.rows[0].id,
      action,
      category,
      userId,
      organizationId,
      riskLevel
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to log audit event', { error, options });
    throw error;
  }
};

/**
 * Get audit logs with filters
 */
export const getAuditLogs = async (filters = {}) => {
  const {
    organizationId,
    userId,
    action,
    category,
    resourceType,
    startDate,
    endDate,
    riskLevel,
    limit = 100,
    offset = 0
  } = filters;

  let whereClause = '1=1';
  let params = [];
  let paramIndex = 1;

  if (organizationId) {
    params.push(organizationId);
    whereClause += ` AND organization_id = $${paramIndex}`;
    paramIndex++;
  }

  if (userId) {
    params.push(userId);
    whereClause += ` AND user_id = $${paramIndex}`;
    paramIndex++;
  }

  if (action) {
    params.push(action);
    whereClause += ` AND action = $${paramIndex}`;
    paramIndex++;
  }

  if (category) {
    params.push(category);
    whereClause += ` AND category = $${paramIndex}`;
    paramIndex++;
  }

  if (resourceType) {
    params.push(resourceType);
    whereClause += ` AND resource_type = $${paramIndex}`;
    paramIndex++;
  }

  if (startDate) {
    params.push(startDate);
    whereClause += ` AND created_at >= $${paramIndex}`;
    paramIndex++;
  }

  if (endDate) {
    params.push(endDate);
    whereClause += ` AND created_at <= $${paramIndex}`;
    paramIndex++;
  }

  if (riskLevel) {
    params.push(riskLevel);
    whereClause += ` AND risk_level = $${paramIndex}`;
    paramIndex++;
  }

  const result = await query(
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  const totalResult = await query(
    `SELECT COUNT(*) as total FROM audit_logs WHERE ${whereClause}`,
    params
  );

  return {
    logs: result.rows,
    total: parseInt(totalResult.rows[0].total),
    limit,
    offset
  };
};

/**
 * Get audit logs for a specific resource
 */
export const getResourceAuditTrail = async (resourceType, resourceId, organizationId = null) => {
  let whereClause = 'resource_type = $1 AND resource_id = $2';
  let params = [resourceType, resourceId];

  if (organizationId) {
    params.push(organizationId);
    whereClause += ' AND organization_id = $3';
  }

  const result = await query(
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE ${whereClause}
     ORDER BY al.created_at ASC`,
    params
  );

  return result.rows;
};

/**
 * Export audit logs for compliance reporting
 */
export const exportAuditLogs = async (filters, format = 'json') => {
  const logs = await getAuditLogs(filters);
  
  // Log the export action itself
  await logAuditEvent({
    organizationId: filters.organizationId,
    userId: filters.userId,
    action: 'audit_logs_exported',
    category: ACTION_CATEGORIES.EXPORT,
    resourceType: 'audit_logs',
    description: `Exported ${logs.total} audit log entries in ${format} format`,
    riskLevel: RISK_LEVELS.MEDIUM,
    metadata: {
      format,
      recordCount: logs.total,
      filters: { ...filters, userId: '[REDACTED]' } // Don't log actual user IDs in metadata
    }
  });

  if (format === 'csv') {
    return convertToCSV(logs.logs);
  }
  
  return logs.logs;
};

const convertToCSV = (logs) => {
  if (logs.length === 0) return '';

  const headers = ['id', 'created_at', 'user_name', 'action', 'category', 'resource_type', 'resource_id', 'description', 'risk_level'];
  const rows = logs.map(log => 
    headers.map(header => {
      const value = log[header] || '';
      // Escape quotes and wrap in quotes if contains comma
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
};

/**
 * Check for suspicious activity patterns
 */
export const detectSuspiciousActivity = async (organizationId, timeWindow = '1 hour') => {
  const now = new Date();
  
  // Multiple failed login attempts
  const failedLogins = await query(
    `SELECT user_id, COUNT(*) as attempt_count
     FROM audit_logs
     WHERE organization_id = $1
       AND action = 'login_failed'
       AND created_at > $2
     GROUP BY user_id
     HAVING COUNT(*) > 5`,
    [organizationId, new Date(now.getTime() - 60 * 60 * 1000)]
  );

  // Bulk data access
  const bulkAccess = await query(
    `SELECT user_id, COUNT(*) as access_count
     FROM audit_logs
     WHERE organization_id = $1
       AND category = $2
       AND created_at > $3
     GROUP BY user_id
     HAVING COUNT(*) > 50`,
    [organizationId, ACTION_CATEGORIES.DATA_ACCESS, new Date(now.getTime() - 60 * 60 * 1000)]
  );

  // High-risk actions
  const highRiskActions = await query(
    `SELECT al.*, u.name as user_name, u.email as user_email
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE al.organization_id = $1
       AND al.risk_level IN ($2, $3)
       AND al.created_at > $4
     ORDER BY al.created_at DESC`,
    [organizationId, RISK_LEVELS.HIGH, RISK_LEVELS.CRITICAL, new Date(now.getTime() - 24 * 60 * 60 * 1000)]
  );

  return {
    multipleFailedLogins: failedLogins.rows,
    bulkDataAccess: bulkAccess.rows,
    highRiskActions: highRiskActions.rows
  };
};

/**
 * GDPR Data Access Log - Track when personal data is accessed
 */
export const logPersonalDataAccess = async (userId, dataSubjectId, dataType, purpose) => {
  return await logAuditEvent({
    userId,
    action: 'personal_data_accessed',
    category: ACTION_CATEGORIES.DATA_ACCESS,
    resourceType: 'personal_data',
    resourceId: dataSubjectId,
    description: `Accessed ${dataType} for purpose: ${purpose}`,
    riskLevel: RISK_LEVELS.MEDIUM,
    metadata: { dataType, purpose }
  });
};

/**
 * GDPR Data Export Log
 */
export const logDataExport = async (userId, dataSubjectId, dataTypes, format) => {
  return await logAuditEvent({
    userId,
    action: 'personal_data_exported',
    category: ACTION_CATEGORIES.EXPORT,
    resourceType: 'personal_data',
    resourceId: dataSubjectId,
    description: `Exported personal data in ${format} format`,
    riskLevel: RISK_LEVELS.MEDIUM,
    metadata: { dataTypes, format }
  });
};

/**
 * GDPR Data Deletion Log
 */
export const logDataDeletion = async (userId, dataSubjectId, reason) => {
  return await logAuditEvent({
    userId,
    action: 'personal_data_deleted',
    category: ACTION_CATEGORIES.DATA_DELETION,
    resourceType: 'personal_data',
    resourceId: dataSubjectId,
    description: `Deleted personal data. Reason: ${reason}`,
    riskLevel: RISK_LEVELS.HIGH,
    metadata: { reason }
  });
};

/**
 * Retention policy - Auto-delete old audit logs based on compliance requirements
 */
export const applyRetentionPolicy = async (retentionDays = 2555) => { // 7 years default
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await query(
    `DELETE FROM audit_logs WHERE created_at < $1`,
    [cutoffDate]
  );

  logger.info(`Audit log retention applied: deleted ${result.rowCount} records older than ${retentionDays} days`);
  
  return {
    deletedCount: result.rowCount,
    cutoffDate
  };
};

/**
 * Get audit statistics
 */
export const getAuditStats = async (organizationId, startDate = null, endDate = null) => {
  let whereClause = 'organization_id = $1';
  let params = [organizationId];
  let paramIndex = 2;

  if (startDate) {
    params.push(startDate);
    whereClause += ` AND created_at >= $${paramIndex}`;
    paramIndex++;
  }

  if (endDate) {
    params.push(endDate);
    whereClause += ` AND created_at <= $${paramIndex}`;
    paramIndex++;
  }

  const stats = {};

  // Total events
  const totalResult = await query(
    `SELECT COUNT(*) as count FROM audit_logs WHERE ${whereClause}`,
    params
  );
  stats.totalEvents = parseInt(totalResult.rows[0].count);

  // By category
  const categoryResult = await query(
    `SELECT category, COUNT(*) as count
     FROM audit_logs
     WHERE ${whereClause}
     GROUP BY category`,
    params
  );
  stats.byCategory = {};
  categoryResult.rows.forEach(row => {
    stats.byCategory[row.category] = parseInt(row.count);
  });

  // By risk level
  const riskResult = await query(
    `SELECT risk_level, COUNT(*) as count
     FROM audit_logs
     WHERE ${whereClause}
     GROUP BY risk_level`,
    params
  );
  stats.byRiskLevel = {};
  riskResult.rows.forEach(row => {
    stats.byRiskLevel[row.risk_level] = parseInt(row.count);
  });

  // Unique users
  const userResult = await query(
    `SELECT COUNT(DISTINCT user_id) as count FROM audit_logs WHERE ${whereClause}`,
    params
  );
  stats.uniqueUsers = parseInt(userResult.rows[0].count);

  // High risk events
  const highRiskResult = await query(
    `SELECT COUNT(*) as count 
     FROM audit_logs 
     WHERE ${whereClause} AND risk_level IN ($${paramIndex}, $${paramIndex + 1})`,
    [...params, RISK_LEVELS.HIGH, RISK_LEVELS.CRITICAL]
  );
  stats.highRiskEvents = parseInt(highRiskResult.rows[0].count);

  return stats;
};

export default {
  ACTION_CATEGORIES,
  RISK_LEVELS,
  logAuditEvent,
  getAuditLogs,
  getResourceAuditTrail,
  exportAuditLogs,
  detectSuspiciousActivity,
  logPersonalDataAccess,
  logDataExport,
  logDataDeletion,
  applyRetentionPolicy,
  getAuditStats
};

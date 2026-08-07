import express from 'express';
import { authenticate } from '../middleware/auth.js';
import auditService, { ACTION_CATEGORIES, RISK_LEVELS } from '../services/auditService.js';

const router = express.Router();

// All audit routes require authentication
router.use(authenticate);

/**
 * GET /api/audit/logs
 * Get audit logs with filters
 */
router.get('/logs', async (req, res, next) => {
  try {
    const {
      action,
      category,
      resourceType,
      resourceId,
      startDate,
      endDate,
      riskLevel,
      limit = 100,
      offset = 0
    } = req.query;

    const filters = {
      organizationId: req.organizationId,
      action,
      category,
      resourceType,
      resourceId,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      riskLevel,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const result = await auditService.getAuditLogs(filters);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit/logs/:resourceType/:resourceId
 * Get audit trail for a specific resource
 */
router.get('/logs/:resourceType/:resourceId', async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.params;

    const logs = await auditService.getResourceAuditTrail(
      resourceType,
      resourceId,
      req.organizationId
    );

    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit/export
 * Export audit logs
 */
router.get('/export', async (req, res, next) => {
  try {
    const { format = 'json', startDate, endDate } = req.query;

    const filters = {
      organizationId: req.organizationId,
      userId: req.userId,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null
    };

    const data = await auditService.exportAuditLogs(filters, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${Date.now()}.csv"`);
      return res.send(data);
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit/suspicious-activity
 * Check for suspicious activity patterns
 */
router.get('/suspicious-activity', async (req, res, next) => {
  try {
    const { timeWindow } = req.query;

    const activity = await auditService.detectSuspiciousActivity(
      req.organizationId,
      timeWindow || '1 hour'
    );

    res.json(activity);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit/stats
 * Get audit statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await auditService.getAuditStats(
      req.organizationId,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/audit/gdpr/access
 * Log GDPR personal data access
 */
router.post('/gdpr/access', async (req, res, next) => {
  try {
    const { dataSubjectId, dataType, purpose } = req.body;

    if (!dataSubjectId || !dataType || !purpose) {
      return res.status(400).json({ error: 'dataSubjectId, dataType, and purpose are required' });
    }

    const log = await auditService.logPersonalDataAccess(
      req.userId,
      dataSubjectId,
      dataType,
      purpose
    );

    res.json({
      message: 'Data access logged',
      log
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/audit/gdpr/export
 * Log GDPR data export
 */
router.post('/gdpr/export', async (req, res, next) => {
  try {
    const { dataSubjectId, dataTypes, format } = req.body;

    if (!dataSubjectId || !format) {
      return res.status(400).json({ error: 'dataSubjectId and format are required' });
    }

    const log = await auditService.logDataExport(
      req.userId,
      dataSubjectId,
      dataTypes || [],
      format
    );

    res.json({
      message: 'Data export logged',
      log
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/audit/gdpr/deletion
 * Log GDPR data deletion
 */
router.post('/gdpr/deletion', async (req, res, next) => {
  try {
    const { dataSubjectId, reason } = req.body;

    if (!dataSubjectId || !reason) {
      return res.status(400).json({ error: 'dataSubjectId and reason are required' });
    }

    const log = await auditService.logDataDeletion(
      req.userId,
      dataSubjectId,
      reason
    );

    res.json({
      message: 'Data deletion logged',
      log
    });
  } catch (error) {
    next(error);
  }
});

export default router;

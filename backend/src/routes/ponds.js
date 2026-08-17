import express from 'express';
import pondService from '../services/pondService.js';
import { authenticate, checkOrganizationAccess } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/ponds
 * Create a new pond
 */
router.post('/', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const farm = await getFarmById(req.params.farmId);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    const pond = await pondService.createPond(req.contextOrganizationId, farmId, {
      name,
      code,
      pondType,
      waterSource,
      volumeLiters,
      areaSqm,
      fishSpecies,
      stockingDate,
      targetHarvestDate
    });

    res.status(201).json({ success: true, data: pond });
  } catch (error) {
    console.error('Error creating pond:', error);
    res.status(500).json({ error: 'Failed to create pond' });
  }
});

/**
 * GET /api/ponds?farmId=xxx
 * Get all ponds for a specific farm
 */
router.get('/', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const { farmId } = req.query;
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ponds = await pondService.getPondsByFarm(req.contextOrganizationId, farmId);
    res.json({ success: true, data: ponds });
  } catch (error) {
    console.error('Fetch ponds error:', error);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

/**
 * GET /api/ponds/:id
 * Get a single pond by ID
 */
router.get('/:id', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const pond = await pondService.getPondById(req.contextOrganizationId, req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ pond });
  } catch (error) {
    console.error('Fetch pond error:', error);
    res.status(500).json({ error: 'Failed to fetch pond' });
  }
});

/**
 * PUT /api/ponds/:id
 * Update pond details
 */
router.put('/:id', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const updates = req.body;
    
    const pond = await pondService.updatePond(req.contextOrganizationId, req.params.id, updates);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }

    res.json({ success: true, data: pond });
  } catch (error) {
    console.error('Error updating pond:', error);
    res.status(500).json({ error: 'Failed to update pond' });
  }
});

/**
 * DELETE /api/ponds/:id
 * Delete a pond
 */
router.delete('/:id', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const deleted = await pondService.deletePond(req.contextOrganizationId, req.params.id);
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ success: true, message: 'Pond deleted successfully' });
  } catch (error) {
    console.error('Error deleting pond:', error);
    res.status(500).json({ error: 'Failed to delete pond' });
  }
});

/**
 * GET /api/ponds/:id/status
 * Get pond current status with latest sensor readings
 */
router.get('/:id/status', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const status = await pondService.getPondStatus(req.contextOrganizationId, req.params.id);
    
    const status = await getPondStatus(req.params.id);
    res.json({ status });
  } catch (error) {
    console.error('Fetch pond status error:', error);
    res.status(500).json({ error: 'Failed to fetch pond status' });
  }
});

/**
 * GET /api/ponds/:id/history
 * Get historical sensor readings for a pond
 * Query params: sensorType, startTime, endTime
 */
router.get('/:id/history', authenticate, checkOrganizationAccess, async (req, res) => {
  try {
    const pond = await getPondById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { sensorType, startTime, endTime } = req.query;
    
    if (!sensorType || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required query parameters: sensorType, startTime, endTime' });
    }

    const start = startTime ? new Date(startTime) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default 7 days
    const end = endTime ? new Date(endTime) : new Date();

    const history = await pondService.getPondHistory(
      req.contextOrganizationId, 
      req.params.id, 
      sensorType, 
      start.toISOString(), 
      end.toISOString()
    );

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Fetch pond history error:', error);
    res.status(500).json({ error: 'Failed to fetch pond history' });
  }
});

export default router;

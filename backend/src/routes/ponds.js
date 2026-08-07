const express = require('express');
const router = express.Router();
const pondService = require('../services/pondService');
const auth = require('../middleware/auth');

/**
 * POST /api/ponds
 * Create a new pond
 */
router.post('/', auth, async (req, res) => {
  try {
    const { farmId, name, code, pondType, waterSource, volumeLiters, areaSqm, fishSpecies, stockingDate, targetHarvestDate } = req.body;
    
    if (!farmId || !name) {
      return res.status(400).json({ error: 'Farm ID and pond name are required' });
    }

    const pond = await pondService.createPond(req.user.organizationId, farmId, {
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
router.get('/', auth, async (req, res) => {
  try {
    const { farmId } = req.query;
    
    if (!farmId) {
      return res.status(400).json({ error: 'Farm ID is required' });
    }

    const ponds = await pondService.getPondsByFarm(req.user.organizationId, farmId);
    res.json({ success: true, data: ponds });
  } catch (error) {
    console.error('Error fetching ponds:', error);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

/**
 * GET /api/ponds/:id
 * Get a single pond by ID
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const pond = await pondService.getPondById(req.user.organizationId, req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }

    res.json({ success: true, data: pond });
  } catch (error) {
    console.error('Error fetching pond:', error);
    res.status(500).json({ error: 'Failed to fetch pond' });
  }
});

/**
 * PUT /api/ponds/:id
 * Update pond details
 */
router.put('/:id', auth, async (req, res) => {
  try {
    const updates = req.body;
    
    const pond = await pondService.updatePond(req.user.organizationId, req.params.id, updates);
    
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
router.delete('/:id', auth, async (req, res) => {
  try {
    const deleted = await pondService.deletePond(req.user.organizationId, req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Pond not found' });
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
router.get('/:id/status', auth, async (req, res) => {
  try {
    const status = await pondService.getPondStatus(req.user.organizationId, req.params.id);
    
    if (!status) {
      return res.status(404).json({ error: 'Pond not found' });
    }

    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Error fetching pond status:', error);
    res.status(500).json({ error: 'Failed to fetch pond status' });
  }
});

/**
 * GET /api/ponds/:id/history
 * Get historical sensor readings for a pond
 * Query params: sensorType, startTime, endTime
 */
router.get('/:id/history', auth, async (req, res) => {
  try {
    const { sensorType, startTime, endTime } = req.query;
    
    if (!sensorType) {
      return res.status(400).json({ error: 'Sensor type is required' });
    }

    const start = startTime ? new Date(startTime) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default 7 days
    const end = endTime ? new Date(endTime) : new Date();

    const history = await pondService.getPondHistory(
      req.user.organizationId, 
      req.params.id, 
      sensorType, 
      start.toISOString(), 
      end.toISOString()
    );

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error fetching pond history:', error);
    res.status(500).json({ error: 'Failed to fetch pond history' });
  }
});

module.exports = router;

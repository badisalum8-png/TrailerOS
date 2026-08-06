import express from 'express';
import { 
  createFarm, 
  getFarmsByOrganization, 
  getFarmById, 
  updateFarm, 
  deleteFarm,
  getFarmSummary 
} from '../services/farmService.js';
import { getPondsByFarm } from '../services/pondService.js';
import { authenticate, checkOrganizationAccess } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(checkOrganizationAccess);

// Get all farms for the organization
router.get('/', async (req, res) => {
  try {
    const farms = await getFarmsByOrganization(req.contextOrganizationId);
    res.json({ farms });
  } catch (error) {
    console.error('Fetch farms error:', error);
    res.status(500).json({ error: 'Failed to fetch farms' });
  }
});

// Create new farm
router.post('/', async (req, res) => {
  try {
    const farmData = {
      ...req.body,
      organizationId: req.contextOrganizationId
    };
    
    const farm = await createFarm(farmData);
    res.status(201).json({ message: 'Farm created successfully', farm });
  } catch (error) {
    console.error('Create farm error:', error);
    res.status(400).json({ error: error.message || 'Failed to create farm' });
  }
});

// Get farm by ID
router.get('/:id', async (req, res) => {
  try {
    const farm = await getFarmById(req.params.id);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    // Verify farm belongs to user's organization
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ farm });
  } catch (error) {
    console.error('Fetch farm error:', error);
    res.status(500).json({ error: 'Failed to fetch farm' });
  }
});

// Get farm summary with statistics
router.get('/:id/summary', async (req, res) => {
  try {
    const summary = await getFarmSummary(req.params.id);
    
    if (!summary) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    res.json({ summary });
  } catch (error) {
    console.error('Fetch farm summary error:', error);
    res.status(500).json({ error: 'Failed to fetch farm summary' });
  }
});

// Get ponds for a farm
router.get('/:id/ponds', async (req, res) => {
  try {
    const farm = await getFarmById(req.params.id);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const ponds = await getPondsByFarm(req.params.id);
    res.json({ ponds });
  } catch (error) {
    console.error('Fetch ponds error:', error);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

// Update farm
router.put('/:id', async (req, res) => {
  try {
    const farm = await getFarmById(req.params.id);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedFarm = await updateFarm(req.params.id, req.body);
    res.json({ message: 'Farm updated successfully', farm: updatedFarm });
  } catch (error) {
    console.error('Update farm error:', error);
    res.status(400).json({ error: error.message || 'Failed to update farm' });
  }
});

// Archive farm (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const farm = await getFarmById(req.params.id);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await deleteFarm(req.params.id);
    res.json({ message: 'Farm archived successfully' });
  } catch (error) {
    console.error('Delete farm error:', error);
    res.status(500).json({ error: 'Failed to archive farm' });
  }
});

export default router;

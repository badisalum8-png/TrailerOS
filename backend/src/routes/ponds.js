import express from 'express';
import { 
  createPond, 
  getPondsByFarm, 
  getPondById, 
  updatePond, 
  deletePond,
  getPondStatus,
  getPondHistory
} from '../services/pondService.js';
import { getFarmById } from '../services/farmService.js';
import { authenticate, checkOrganizationAccess } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(checkOrganizationAccess);

// Get all ponds for a farm
router.get('/farm/:farmId', async (req, res) => {
  try {
    const farm = await getFarmById(req.params.farmId);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const ponds = await getPondsByFarm(req.params.farmId);
    res.json({ ponds });
  } catch (error) {
    console.error('Fetch ponds error:', error);
    res.status(500).json({ error: 'Failed to fetch ponds' });
  }
});

// Create new pond
router.post('/', async (req, res) => {
  try {
    const farm = await getFarmById(req.body.farmId);
    
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    if (farm.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const pond = await createPond(req.contextOrganizationId, req.body.farmId, req.body);
    res.status(201).json({ message: 'Pond created successfully', pond });
  } catch (error) {
    console.error('Create pond error:', error);
    res.status(400).json({ error: error.message || 'Failed to create pond' });
  }
});

// Get pond by ID
router.get('/:id', async (req, res) => {
  try {
    const pond = await getPondById(req.params.id);
    
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

// Get pond status with latest readings
router.get('/:id/status', async (req, res) => {
  try {
    const pond = await getPondById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const status = await getPondStatus(req.params.id);
    res.json({ status });
  } catch (error) {
    console.error('Fetch pond status error:', error);
    res.status(500).json({ error: 'Failed to fetch pond status' });
  }
});

// Get pond historical readings
router.get('/:id/history', async (req, res) => {
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
    
    const history = await getPondHistory(req.params.id, sensorType, startTime, endTime);
    res.json({ history });
  } catch (error) {
    console.error('Fetch pond history error:', error);
    res.status(500).json({ error: 'Failed to fetch pond history' });
  }
});

// Update pond
router.put('/:id', async (req, res) => {
  try {
    const pond = await getPondById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const updatedPond = await updatePond(req.params.id, req.body);
    res.json({ message: 'Pond updated successfully', pond: updatedPond });
  } catch (error) {
    console.error('Update pond error:', error);
    res.status(400).json({ error: error.message || 'Failed to update pond' });
  }
});

// Delete pond
router.delete('/:id', async (req, res) => {
  try {
    const pond = await getPondById(req.params.id);
    
    if (!pond) {
      return res.status(404).json({ error: 'Pond not found' });
    }
    
    if (pond.organization_id !== req.contextOrganizationId && req.user.role !== 'SYSTEM_OWNER') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await deletePond(req.params.id);
    res.json({ message: 'Pond deleted successfully' });
  } catch (error) {
    console.error('Delete pond error:', error);
    res.status(500).json({ error: 'Failed to delete pond' });
  }
});

export default router;

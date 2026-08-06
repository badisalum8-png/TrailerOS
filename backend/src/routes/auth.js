import express from 'express';
import { registerUser, loginUser } from '../services/authService.js';
import { createOrganization, getOrganizationByUserId } from '../services/organizationService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Register new user and organization
router.post('/register', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone, 
      organizationName, 
      organizationEmail,
      organizationPhone,
      organizationAddress 
    } = req.body;
    
    // Validate required fields
    if (!email || !password || !organizationName) {
      return res.status(400).json({ error: 'Email, password, and organization name are required' });
    }
    
    // Create organization first
    const organization = await createOrganization({
      name: organizationName,
      email: organizationEmail || email,
      phone: organizationPhone,
      address: organizationAddress,
      subscriptionPlanId: null // Default plan
    });
    
    // Create user with OWNER role
    const user = await registerUser({
      email,
      password,
      organizationId: organization.id,
      role: 'OWNER',
      firstName,
      lastName,
      phone
    });
    
    res.status(201).json({
      message: 'Registration successful',
      organization: {
        id: organization.id,
        name: organization.name
      },
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const result = await loginUser(email, password);
    
    res.json({
      message: 'Login successful',
      ...result
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || 'Login failed' });
  }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const organization = await getOrganizationByUserId(req.user.id);
    
    res.json({
      user: req.user,
      organization: organization || null
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;

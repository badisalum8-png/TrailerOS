import jwt from 'jsonwebtoken';
import pool from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '24h';

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      organizationId: user.organization_id,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Authenticate request middleware
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Missing or invalid Authorization header' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    // Set database context for Row Level Security
    await pool.query(
      'SELECT set_config($1, $2, true)',
      ['app.current_user_id', decoded.id]
    );
    
    req.user = decoded;
    req.token = token;
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Please login again' 
      });
    }
    return res.status(401).json({ 
      error: 'Invalid token',
      message: 'Token verification failed' 
    });
  }
};

/**
 * Role-based access control middleware
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role
      });
    }
    
    next();
  };
};

/**
 * Check organization access - ensures users can only access their own org data
 */
export const checkOrganizationAccess = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    const { organizationId: userOrgId } = req.user;
    
    // System owner can access all organizations (if such role exists)
    if (req.user.role === 'SYSTEM_OWNER') {
      return next();
    }
    
    // Check if user has access to this organization
    if (organizationId && organizationId !== userOrgId) {
      return res.status(403).json({ error: 'Access denied to this organization' });
    }
    
    // Set organization context for the request
    req.contextOrganizationId = userOrgId;
    next();
  } catch (error) {
    console.error('Organization access check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

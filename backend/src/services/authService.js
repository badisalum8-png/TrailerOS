import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

export const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

export const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      organizationId: user.organization_id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

export const registerUser = async (userData) => {
  const { email, password, organizationId, role, firstName, lastName, phone } = userData;
  
  // Check if user already exists
  const existingUser = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );
  
  if (existingUser.rows.length > 0) {
    throw new Error('User with this email already exists');
  }
  
  const passwordHash = await hashPassword(password);
  
  const result = await query(
    `INSERT INTO users (email, password_hash, organization_id, role, first_name, last_name, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, organization_id, role, first_name, last_name, phone, created_at`,
    [email, passwordHash, organizationId, role, firstName, lastName, phone]
  );
  
  return result.rows[0];
};

export const loginUser = async (email, password) => {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Invalid email or password');
  }
  
  const user = result.rows[0];
  const isValid = await comparePassword(password, user.password_hash);
  
  if (!isValid) {
    throw new Error('Invalid email or password');
  }
  
  // Update last login
  await query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );
  
  const token = generateToken(user);
  
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      organizationId: user.organization_id,
    },
    token,
  };
};

export const getUserById = async (userId) => {
  const result = await query(
    'SELECT id, email, organization_id, role, first_name, last_name, phone, created_at FROM users WHERE id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const getUsersByOrganization = async (organizationId) => {
  const result = await query(
    'SELECT id, email, organization_id, role, first_name, last_name, phone, created_at FROM users WHERE organization_id = $1',
    [organizationId]
  );
  
  return result.rows;
};

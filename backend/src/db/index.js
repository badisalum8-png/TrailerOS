import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'aquaculture_db',
  user: process.env.DB_USER || 'aqua_admin',
  password: process.env.DB_PASSWORD || 'secure_password_123',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error', { text, error });
    throw error;
  }
};

export const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  
  client.query = async (text, params) => {
    const start = Date.now();
    try {
      const res = await originalQuery(text, params);
      const duration = Date.now() - start;
      console.log('Executed client query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      console.error('Client query error', { text, error });
      throw error;
    }
  };
  
  client.release = () => {
    console.log('Client released back to pool');
    return release();
  };
  
  return client;
};

export default pool;

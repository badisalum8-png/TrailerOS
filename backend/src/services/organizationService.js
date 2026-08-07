import { query } from '../db/index.js';

export const createOrganization = async (orgData) => {
  const { name, email, phone, address, subscriptionPlanId } = orgData;
  
  const result = await query(
    `INSERT INTO organizations (name, email, phone, address, subscription_plan_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, email, phone, address, subscriptionPlanId]
  );
  
  return result.rows[0];
};

export const getOrganizationById = async (orgId) => {
  const result = await query(
    'SELECT * FROM organizations WHERE id = $1',
    [orgId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const getOrganizationByUserId = async (userId) => {
  const result = await query(
    `SELECT o.* FROM organizations o
     JOIN users u ON o.id = u.organization_id
     WHERE u.id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

export const updateOrganization = async (orgId, updates) => {
  const allowedFields = ['name', 'email', 'phone', 'address', 'subscription_plan_id'];
  const fields = [];
  const values = [];
  let index = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }
  }
  
  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }
  
  values.push(orgId);
  
  const result = await query(
    `UPDATE organizations SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${index}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const getAllOrganizations = async (limit = 100, offset = 0) => {
  const result = await query(
    'SELECT * FROM organizations ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  
  return result.rows;
};

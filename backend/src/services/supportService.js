import { query } from '../db/index.js';

/**
 * Support Ticketing Service
 * Manages customer support tickets, SLAs, and knowledge base
 */

// Ticket priorities
export const PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Ticket statuses
export const STATUSES = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_CUSTOMER: 'waiting_customer',
  WAITING_THIRD_PARTY: 'waiting_third_party',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

// SLA definitions by plan
export const SLA_DEFINITIONS = {
  community: {
    firstResponseTime: 48 * 60 * 60 * 1000, // 48 hours
    resolutionTime: 7 * 24 * 60 * 60 * 1000, // 7 days
    businessHoursOnly: false
  },
  email: {
    firstResponseTime: 24 * 60 * 60 * 1000, // 24 hours
    resolutionTime: 3 * 24 * 60 * 60 * 1000, // 3 days
    businessHoursOnly: false
  },
  priority: {
    firstResponseTime: 4 * 60 * 60 * 1000, // 4 hours
    resolutionTime: 24 * 60 * 60 * 1000, // 24 hours
    businessHoursOnly: false
  },
  dedicated: {
    firstResponseTime: 1 * 60 * 60 * 1000, // 1 hour
    resolutionTime: 4 * 60 * 60 * 1000, // 4 hours
    businessHoursOnly: false
  }
};

/**
 * Create a new support ticket
 */
export const createTicket = async (organizationId, userId, subject, description, priority = PRIORITIES.MEDIUM, category = null) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');

    // Get organization's subscription to determine SLA
    const subResult = await client.query(
      `SELECT s.plan_id, s.status FROM subscriptions s
       WHERE s.organization_id = $1
       ORDER BY s.created_at DESC LIMIT 1`,
      [organizationId]
    );

    const planId = subResult.rows.length > 0 ? subResult.rows[0].plan_id : 'free';
    const plan = planId.toUpperCase();
    
    // Determine SLA based on plan
    let slaDefinition;
    if (plan === 'ENTERPRISE') {
      slaDefinition = SLA_DEFINITIONS.dedicated;
    } else if (plan === 'PROFESSIONAL') {
      slaDefinition = SLA_DEFINITIONS.priority;
    } else if (plan === 'STARTER') {
      slaDefinition = SLA_DEFINITIONS.email;
    } else {
      slaDefinition = SLA_DEFINITIONS.community;
    }

    // Calculate SLA deadlines
    const now = new Date();
    const slaDue = new Date(now.getTime() + slaDefinition.firstResponseTime);
    const resolutionDue = new Date(now.getTime() + slaDefinition.resolutionTime);

    // Generate ticket number
    const ticketNumber = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create ticket
    const result = await client.query(
      `INSERT INTO support_tickets (
        ticket_number, organization_id, user_id, subject, description, 
        priority, status, category, sla_due_at, resolution_due_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        ticketNumber,
        organizationId,
        userId,
        subject,
        description,
        priority,
        STATUSES.OPEN,
        category,
        slaDue,
        resolutionDue
      ]
    );

    // Create initial comment
    await client.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [result.rows[0].id, userId, description, false]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get ticket by ID
 */
export const getTicketById = async (ticketId, organizationId = null) => {
  let whereClause = 't.id = $1';
  let params = [ticketId];
  
  if (organizationId) {
    whereClause += ' AND t.organization_id = $2';
    params.push(organizationId);
  }

  const result = await query(
    `SELECT t.*, 
            u.name as created_by_name, u.email as created_by_email,
            a.name as assigned_to_name
     FROM support_tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN users a ON t.assigned_to = a.id
     WHERE ${whereClause}`,
    params
  );

  return result.rows[0] || null;
};

/**
 * Get all tickets for an organization
 */
export const getTicketsByOrganization = async (organizationId, filters = {}) => {
  const { status, priority, category, limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'DESC' } = filters;
  
  let whereClause = 't.organization_id = $1';
  let params = [organizationId];
  let paramIndex = 2;

  if (status) {
    whereClause += ` AND t.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (priority) {
    whereClause += ` AND t.priority = $${paramIndex}`;
    params.push(priority);
    paramIndex++;
  }

  if (category) {
    whereClause += ` AND t.category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }

  const validSortFields = ['created_at', 'updated_at', 'priority', 'sla_due_at'];
  const orderField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
  const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const result = await query(
    `SELECT t.*, 
            u.name as created_by_name,
            a.name as assigned_to_name
     FROM support_tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN users a ON t.assigned_to = a.id
     WHERE ${whereClause}
     ORDER BY ${orderField} ${order}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  const totalResult = await query(
    `SELECT COUNT(*) as total FROM support_tickets WHERE ${whereClause}`,
    params
  );

  return {
    tickets: result.rows,
    total: parseInt(totalResult.rows[0].total),
    limit,
    offset
  };
};

/**
 * Update ticket status
 */
export const updateTicketStatus = async (ticketId, status, userId = null) => {
  const validStatuses = Object.values(STATUSES);
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const result = await query(
    `UPDATE support_tickets 
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, ticketId]
  );

  // Log status change
  if (userId) {
    await query(
      `INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ticketId, userId, `Status changed to ${status}`, true]
    );
  }

  return result.rows[0];
};

/**
 * Assign ticket to support agent
 */
export const assignTicket = async (ticketId, assignedTo, userId) => {
  const result = await query(
    `UPDATE support_tickets 
     SET assigned_to = $1, status = 'in_progress', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [assignedTo, ticketId]
  );

  // Log assignment
  await query(
    `INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [ticketId, userId, `Ticket assigned to agent ${assignedTo}`, true]
  );

  return result.rows[0];
};

/**
 * Add comment to ticket
 */
export const addComment = async (ticketId, userId, message, isInternal = false, attachments = []) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [ticketId, userId, message, isInternal]
    );

    // Add attachments if any
    for (const attachment of attachments) {
      await client.query(
        `INSERT INTO ticket_attachments (ticket_id, comment_id, file_name, file_url, file_type, file_size, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [ticketId, result.rows[0].id, attachment.fileName, attachment.fileUrl, attachment.fileType, attachment.fileSize]
      );
    }

    // Update ticket updated_at and status if needed
    const ticket = await client.query(
      `SELECT status FROM support_tickets WHERE id = $1`,
      [ticketId]
    );

    if (ticket.rows[0].status === STATUSES.WAITING_CUSTOMER && !isInternal) {
      await client.query(
        `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = $1`,
        [ticketId]
      );
    } else {
      await client.query(
        `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`,
        [ticketId]
      );
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get ticket comments
 */
export const getTicketComments = async (ticketId, isInternal = null) => {
  let whereClause = 'ticket_id = $1';
  let params = [ticketId];
  
  if (isInternal !== null) {
    whereClause += ' AND is_internal = $2';
    params.push(isInternal);
  }

  const result = await query(
    `SELECT tc.*, u.name as author_name, u.email as author_email
     FROM ticket_comments tc
     LEFT JOIN users u ON tc.user_id = u.id
     WHERE ${whereClause}
     ORDER BY tc.created_at ASC`,
    params
  );

  return result.rows;
};

/**
 * Check SLA breaches
 */
export const checkSlaBreaches = async () => {
  const now = new Date();

  // Find tickets with breached first response SLA
  const breachedResponse = await query(
    `SELECT t.*, o.name as organization_name
     FROM support_tickets t
     JOIN organizations o ON t.organization_id = o.id
     WHERE t.sla_due_at < $1 
       AND t.status NOT IN ('resolved', 'closed')
       AND t.first_responded_at IS NULL`,
    [now]
  );

  // Find tickets with breached resolution SLA
  const breachedResolution = await query(
    `SELECT t.*, o.name as organization_name
     FROM support_tickets t
     JOIN organizations o ON t.organization_id = o.id
     WHERE t.resolution_due_at < $1 
       AND t.status NOT IN ('resolved', 'closed')`,
    [now]
  );

  return {
    breachedFirstResponse: breachedResponse.rows,
    breachedResolution: breachedResolution.rows
  };
};

/**
 * Record first response time
 */
export const recordFirstResponse = async (ticketId, userId) => {
  const result = await query(
    `UPDATE support_tickets 
     SET first_responded_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [ticketId]
  );

  return result.rows[0];
};

/**
 * Resolve ticket
 */
export const resolveTicket = async (ticketId, userId, resolution = null) => {
  const client = await query.getClient();
  
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE support_tickets 
       SET status = 'resolved', resolved_at = NOW(), resolution = $1, updated_at = NOW()
       WHERE id = $2`,
      [resolution, ticketId]
    );

    if (resolution) {
      await client.query(
        `INSERT INTO ticket_comments (ticket_id, user_id, message, is_internal, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [ticketId, userId, `Resolution: ${resolution}`, false]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Close ticket (after resolution)
 */
export const closeTicket = async (ticketId, userId) => {
  const result = await query(
    `UPDATE support_tickets 
     SET status = 'closed', closed_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [ticketId]
  );

  return result.rows[0];
};

/**
 * Get support statistics
 */
export const getSupportStats = async (organizationId = null, startDate = null, endDate = null) => {
  let whereClause = '1=1';
  let params = [];
  
  if (organizationId) {
    params.push(organizationId);
    whereClause += ` AND t.organization_id = $${params.length}`;
  }

  if (startDate) {
    params.push(startDate);
    whereClause += ` AND t.created_at >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    whereClause += ` AND t.created_at <= $${params.length}`;
  }

  const stats = {};

  // Total tickets
  const totalResult = await query(
    `SELECT COUNT(*) as count FROM support_tickets t WHERE ${whereClause}`,
    params
  );
  stats.totalTickets = parseInt(totalResult.rows[0].count);

  // By status
  const statusResult = await query(
    `SELECT status, COUNT(*) as count 
     FROM support_tickets t 
     WHERE ${whereClause}
     GROUP BY status`,
    params
  );
  stats.byStatus = {};
  statusResult.rows.forEach(row => {
    stats.byStatus[row.status] = parseInt(row.count);
  });

  // By priority
  const priorityResult = await query(
    `SELECT priority, COUNT(*) as count 
     FROM support_tickets t 
     WHERE ${whereClause}
     GROUP BY priority`,
    params
  );
  stats.byPriority = {};
  priorityResult.rows.forEach(row => {
    stats.byPriority[row.priority] = parseInt(row.count);
  });

  // Average response time (hours)
  const avgResponseResult = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (first_responded_at - created_at)) / 3600) as avg_hours
     FROM support_tickets t
     WHERE ${whereClause} AND first_responded_at IS NOT NULL`,
    params
  );
  stats.avgResponseTimeHours = parseFloat(avgResponseResult.rows[0].avg_hours) || 0;

  // Average resolution time (hours)
  const avgResolutionResult = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) as avg_hours
     FROM support_tickets t
     WHERE ${whereClause} AND resolved_at IS NOT NULL`,
    params
  );
  stats.avgResolutionTimeHours = parseFloat(avgResolutionResult.rows[0].avg_hours) || 0;

  // SLA breach rate
  const breachResult = await query(
    `SELECT COUNT(*) as breached
     FROM support_tickets t
     WHERE ${whereClause} 
       AND (first_responded_at > sla_due_at OR (first_responded_at IS NULL AND sla_due_at < NOW()))`,
    params
  );
  const total = parseInt(totalResult.rows[0].count);
  const breached = parseInt(breachResult.rows[0].breached);
  stats.slaBreachRate = total > 0 ? (breached / total) * 100 : 0;

  return stats;
};

/**
 * Search knowledge base articles
 */
export const searchKnowledgeBase = async (query_text, limit = 10) => {
  const result = await query(
    `SELECT id, title, content, category, tags, views, helpful_count
     FROM knowledge_base_articles
     WHERE to_tsvector(title || ' ' || content) @@ to_tsquery($1)
        OR title ILIKE $2
        OR content ILIKE $2
     ORDER BY helpful_count DESC, views DESC
     LIMIT $3`,
    [query_text.replace(/\s+/g, '|'), `%${query_text}%`, limit]
  );

  // Increment view count
  for (const article of result.rows) {
    await query(
      `UPDATE knowledge_base_articles 
       SET views = views + 1 
       WHERE id = $1`,
      [article.id]
    );
  }

  return result.rows;
};

/**
 * Rate knowledge base article helpfulness
 */
export const rateArticle = async (articleId, helpful) => {
  if (helpful) {
    await query(
      `UPDATE knowledge_base_articles 
       SET helpful_count = helpful_count + 1 
       WHERE id = $1`,
      [articleId]
    );
  } else {
    await query(
      `UPDATE knowledge_base_articles 
       SET not_helpful_count = not_helpful_count + 1 
       WHERE id = $1`,
      [articleId]
    );
  }
};

export default {
  PRIORITIES,
  STATUSES,
  SLA_DEFINITIONS,
  createTicket,
  getTicketById,
  getTicketsByOrganization,
  updateTicketStatus,
  assignTicket,
  addComment,
  getTicketComments,
  checkSlaBreaches,
  recordFirstResponse,
  resolveTicket,
  closeTicket,
  getSupportStats,
  searchKnowledgeBase,
  rateArticle
};

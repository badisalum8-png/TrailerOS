import express from 'express';
import { authenticate } from '../middleware/auth.js';
import supportService, { PRIORITIES, STATUSES } from '../services/supportService.js';

const router = express.Router();

// All support routes require authentication
router.use(authenticate);

/**
 * GET /api/support/tickets
 * Get all tickets for the organization
 */
router.get('/tickets', async (req, res, next) => {
  try {
    const { status, priority, category, limit, offset, sortBy, sortOrder } = req.query;
    
    const filters = {
      status,
      priority,
      category,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      sortBy: sortBy || 'created_at',
      sortOrder: sortOrder || 'DESC'
    };
    
    const result = await supportService.getTicketsByOrganization(
      req.organizationId,
      filters
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/support/tickets
 * Create a new support ticket
 */
router.post('/tickets', async (req, res, next) => {
  try {
    const { subject, description, priority, category } = req.body;
    
    if (!subject || !description) {
      return res.status(400).json({ error: 'Subject and description are required' });
    }
    
    const ticket = await supportService.createTicket(
      req.organizationId,
      req.userId,
      subject,
      description,
      priority || PRIORITIES.MEDIUM,
      category
    );
    
    res.status(201).json({
      message: 'Ticket created successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/support/tickets/:ticketId
 * Get specific ticket details
 */
router.get('/tickets/:ticketId', async (req, res, next) => {
  try {
    const ticket = await supportService.getTicketById(
      req.params.ticketId,
      req.organizationId
    );
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    // Get comments
    const comments = await supportService.getTicketComments(ticket.id);
    
    res.json({ ticket, comments });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/support/tickets/:ticketId/comments
 * Add a comment to a ticket
 */
router.post('/tickets/:ticketId/comments', async (req, res, next) => {
  try {
    const { message, isInternal, attachments } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const comment = await supportService.addComment(
      req.params.ticketId,
      req.userId,
      message,
      isInternal || false,
      attachments || []
    );
    
    res.status(201).json({
      message: 'Comment added successfully',
      comment
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/support/tickets/:ticketId/status
 * Update ticket status
 */
router.put('/tickets/:ticketId/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    
    if (!status || !Object.values(STATUSES).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const ticket = await supportService.updateTicketStatus(
      req.params.ticketId,
      status,
      req.userId
    );
    
    res.json({
      message: 'Status updated successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/support/tickets/:ticketId/resolve
 * Resolve a ticket
 */
router.post('/tickets/:ticketId/resolve', async (req, res, next) => {
  try {
    const { resolution } = req.body;
    
    await supportService.resolveTicket(
      req.params.ticketId,
      req.userId,
      resolution
    );
    
    res.json({
      message: 'Ticket resolved successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/support/stats
 * Get support statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    const stats = await supportService.getSupportStats(
      req.organizationId,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );
    
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/support/knowledge-base
 * Search knowledge base articles
 */
router.get('/knowledge-base', async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const articles = await supportService.searchKnowledgeBase(
      q,
      limit ? parseInt(limit) : 10
    );
    
    res.json({ articles });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/support/knowledge-base/:articleId/rate
 * Rate a knowledge base article
 */
router.post('/knowledge-base/:articleId/rate', async (req, res, next) => {
  try {
    const { helpful } = req.body;
    
    await supportService.rateArticle(
      req.params.articleId,
      helpful !== false
    );
    
    res.json({ message: 'Rating submitted' });
  } catch (error) {
    next(error);
  }
});

export default router;

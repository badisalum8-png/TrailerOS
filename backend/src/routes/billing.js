import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import billingService, { PLANS } from '../services/billingService.js';

const router = express.Router();

// All billing routes require authentication
router.use(authenticate);

/**
 * GET /api/billing/plans
 * Get all available subscription plans
 */
router.get('/plans', async (req, res, next) => {
  try {
    const plans = Object.values(PLANS).map(plan => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval,
      features: plan.features
    }));
    
    res.json({ plans });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/subscription
 * Get current organization's subscription
 */
router.get('/subscription', async (req, res, next) => {
  try {
    const subscription = await billingService.getSubscriptionByOrganization(req.organizationId);
    
    if (!subscription) {
      return res.json({ subscription: null, message: 'No active subscription' });
    }
    
    // Get usage stats
    const usage = await billingService.getUsageStats(req.organizationId);
    
    res.json({ subscription, usage });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscription
 * Create a new subscription
 */
router.post('/subscription', async (req, res, next) => {
  try {
    const { planId, paymentMethodId } = req.body;
    
    if (!planId) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }
    
    const result = await billingService.createSubscription(
      req.organizationId,
      planId,
      paymentMethodId
    );
    
    res.status(201).json({
      message: 'Subscription created successfully',
      subscription: result.subscription,
      invoice: result.invoice
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscription/cancel
 * Cancel current subscription
 */
router.post('/subscription/cancel', async (req, res, next) => {
  try {
    const { cancelAtPeriodEnd } = req.body;
    
    const subscription = await billingService.getSubscriptionByOrganization(req.organizationId);
    
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    const updated = await billingService.cancelSubscription(
      subscription.id,
      cancelAtPeriodEnd !== false
    );
    
    res.json({
      message: 'Subscription cancelled successfully',
      subscription: updated
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/invoices
 * Get all invoices for the organization
 */
router.get('/invoices', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await billingService.getInvoicesByOrganization(
      req.organizationId,
      parseInt(limit),
      parseInt(offset)
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/invoices/:invoiceId
 * Get specific invoice
 */
router.get('/invoices/:invoiceId', async (req, res, next) => {
  try {
    // Implementation would fetch specific invoice
    res.json({ message: 'Invoice details', invoiceId: req.params.invoiceId });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/invoices/:invoiceId/pay
 * Process payment for an invoice
 */
router.post('/invoices/:invoiceId/pay', async (req, res, next) => {
  try {
    const { paymentMethod } = req.body;
    
    const invoice = await billingService.markInvoicePaid(
      req.params.invoiceId,
      paymentMethod
    );
    
    res.json({
      message: 'Payment processed successfully',
      invoice
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/usage
 * Get current usage statistics
 */
router.get('/usage', async (req, res, next) => {
  try {
    const usage = await billingService.getUsageStats(req.organizationId);
    res.json(usage);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/payment-methods
 * Add a new payment method
 */
router.post('/payment-methods', async (req, res, next) => {
  try {
    const { provider, token, type } = req.body;
    
    // Implementation would integrate with payment providers
    res.json({
      message: 'Payment method added',
      provider,
      type
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/payment-methods
 * Get all payment methods
 */
router.get('/payment-methods', async (req, res, next) => {
  try {
    // Implementation would fetch payment methods
    res.json({ paymentMethods: [] });
  } catch (error) {
    next(error);
  }
});

export default router;

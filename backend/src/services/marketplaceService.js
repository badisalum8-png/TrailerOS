/**
 * Marketplace Service
 * Connects farmers with suppliers (feed, equipment) and buyers (processors, retailers)
 * Handles product listings, orders, escrow payments, and logistics coordination
 */

const db = require('../db');
const { sendNotification } = require('./notificationService');

class MarketplaceService {
  /**
   * Create a product listing (for suppliers) or sell request (for farmers)
   */
  async createListing(organizationId, listingData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Validate subscription allows marketplace access
      const orgCheck = await client.query(
        `SELECT subscription_plan_id FROM organizations WHERE id = $1`,
        [organizationId]
      );
      
      if (orgCheck.rows.length === 0) {
        throw new Error('Organization not found');
      }
      
      const listing = await client.query(
        `INSERT INTO marketplace_listings (
          organization_id, listing_type, category, title, description,
          quantity_available, unit_price, currency, quality_grade,
          delivery_options, images, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          organizationId,
          listingData.type, // 'sell' or 'buy_request'
          listingData.category, // 'feed', 'equipment', 'fish', 'services'
          listingData.title,
          listingData.description,
          listingData.quantity,
          listingData.price,
          listingData.currency || 'USD',
          listingData.qualityGrade,
          JSON.stringify(listingData.deliveryOptions),
          JSON.stringify(listingData.images),
          'active',
          listingData.expiresAt || null
        ]
      );
      
      // Notify relevant users in the organization
      await sendNotification(organizationId, {
        type: 'marketplace_listing_created',
        title: 'Listing Created Successfully',
        message: `Your ${listingData.category} listing is now live`,
        data: { listingId: listing.rows[0].id }
      });
      
      await client.query('COMMIT');
      return listing.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Search marketplace listings with filters
   */
  async searchListings(filters, organizationId) {
    const {
      category,
      listingType,
      minPrice,
      maxPrice,
      location,
      radiusKm,
      qualityGrade,
      limit = 20,
      offset = 0
    } = filters;
    
    let query = `
      SELECT 
        ml.*,
        o.name as seller_name,
        o.location as seller_location,
        CASE 
          WHEN ml.organization_id = $1 THEN true 
          ELSE false 
        END as is_own_listing
      FROM marketplace_listings ml
      JOIN organizations o ON ml.organization_id = o.id
      WHERE ml.status = 'active'
        AND (ml.expires_at IS NULL OR ml.expires_at > NOW())
    `;
    
    const params = [organizationId];
    let paramCount = 2;
    
    if (category) {
      query += ` AND ml.category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }
    
    if (listingType) {
      query += ` AND ml.listing_type = $${paramCount}`;
      params.push(listingType);
      paramCount++;
    }
    
    if (minPrice !== undefined) {
      query += ` AND ml.unit_price >= $${paramCount}`;
      params.push(minPrice);
      paramCount++;
    }
    
    if (maxPrice !== undefined) {
      query += ` AND ml.unit_price <= $${paramCount}`;
      params.push(maxPrice);
      paramCount++;
    }
    
    if (qualityGrade) {
      query += ` AND ml.quality_grade = $${paramCount}`;
      params.push(qualityGrade);
      paramCount++;
    }
    
    // Location-based filtering using PostGIS
    if (location && radiusKm) {
      query += ` AND ST_DWithin(
        o.location::geography,
        ST_MakePoint($${paramCount}, $${paramCount + 1})::geography,
        $${paramCount + 2} * 1000
      )`;
      params.push(location.lng, location.lat, radiusKm);
      paramCount += 3;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);
    
    const result = await db.pool.query(query, params);
    return result.rows;
  }
  
  /**
   * Place an order for a listing
   */
  async placeOrder(buyerOrgId, listingId, orderData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get listing details
      const listingResult = await client.query(
        `SELECT * FROM marketplace_listings WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [listingId]
      );
      
      if (listingResult.rows.length === 0) {
        throw new Error('Listing not found or inactive');
      }
      
      const listing = listingResult.rows[0];
      
      if (listing.organization_id === buyerOrgId) {
        throw new Error('Cannot order from yourself');
      }
      
      const totalAmount = listing.unit_price * orderData.quantity;
      
      // Create order with escrow status
      const order = await client.query(
        `INSERT INTO marketplace_orders (
          listing_id, buyer_organization_id, seller_organization_id,
          quantity, unit_price, total_amount, currency,
          delivery_address, expected_delivery_date,
          payment_status, escrow_status, order_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          listingId,
          buyerOrgId,
          listing.organization_id,
          orderData.quantity,
          listing.unit_price,
          totalAmount,
          listing.currency,
          JSON.stringify(orderData.deliveryAddress),
          orderData.expectedDeliveryDate,
          'pending', // payment_status
          'held',    // escrow_status (payment held until delivery confirmed)
          'confirmed' // order_status
        ]
      );
      
      // Update listing available quantity
      await client.query(
        `UPDATE marketplace_listings 
         SET quantity_available = quantity_available - $1
         WHERE id = $2`,
        [orderData.quantity, listingId]
      );
      
      // Notify seller
      await sendNotification(listing.organization_id, {
        type: 'marketplace_order_received',
        title: 'New Order Received',
        message: `You have received an order for ${orderData.quantity} ${listing.category}`,
        data: { orderId: order.rows[0].id, buyerOrgId }
      });
      
      await client.query('COMMIT');
      return order.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Release escrow payment after delivery confirmation
   */
  async confirmDeliveryAndReleasePayment(orderId, confirmingOrgId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const orderResult = await client.query(
        `SELECT * FROM marketplace_orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );
      
      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }
      
      const order = orderResult.rows[0];
      
      // Only buyer can confirm delivery
      if (order.buyer_organization_id !== confirmingOrgId) {
        throw new Error('Only buyer can confirm delivery');
      }
      
      // Update order status
      await client.query(
        `UPDATE marketplace_orders 
         SET payment_status = 'completed', 
             escrow_status = 'released',
             order_status = 'delivered',
             delivered_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      
      // Here you would integrate with payment gateway to release funds
      // For now, just log the transaction
      await client.query(
        `INSERT INTO marketplace_transactions (
          order_id, amount, currency, transaction_type, status
        ) VALUES ($1, $2, $3, 'escrow_release', 'completed')`,
        [orderId, order.total_amount, order.currency]
      );
      
      // Notify seller of payment release
      await sendNotification(order.seller_organization_id, {
        type: 'marketplace_payment_released',
        title: 'Payment Released',
        message: `Payment of ${order.total_amount} ${order.currency} has been released`,
        data: { orderId, amount: order.total_amount }
      });
      
      await client.query('COMMIT');
      return { success: true, message: 'Delivery confirmed, payment released' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get marketplace analytics for an organization
   */
  async getAnalytics(organizationId, period = '30 days') {
    const result = await db.pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE listing_type = 'sell') as total_sell_listings,
        COUNT(*) FILTER (WHERE listing_type = 'buy_request') as total_buy_requests,
        COUNT(*) FILTER (WHERE status = 'active') as active_listings,
        SUM(CASE WHEN listing_type = 'sell' THEN quantity_available ELSE 0 END) as total_supply,
        AVG(unit_price) as avg_price,
        COUNT(DISTINCT mo.id) as total_orders,
        SUM(mo.total_amount) FILTER (WHERE mo.order_status = 'delivered') as total_revenue,
        SUM(mo.total_amount) FILTER (WHERE mo.order_status = 'delivered' AND mo.buyer_organization_id = $1) as total_purchases
       FROM marketplace_listings ml
       LEFT JOIN marketplace_orders mo ON ml.id = mo.listing_id
       WHERE ml.organization_id = $1
         AND ml.created_at > NOW() - INTERVAL '${period}'`,
      [organizationId]
    );
    
    return result.rows[0];
  }
}

module.exports = new MarketplaceService();

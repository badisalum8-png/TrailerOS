/**
 * Device Inventory Service
 * Manages device lifecycle from manufacturing to retirement
 */
const db = require('../db');

class DeviceInventoryService {
  /**
   * Register a new device in inventory (System Owner)
   */
  static async registerDevice(deviceData) {
    const {
      serial_number,
      model_id,
      hardware_version,
      manufacturing_date,
      batch_number,
      supplier_id,
      qc_result = 'passed',
      warehouse_location
    } = deviceData;

    const query = `
      INSERT INTO device_inventory 
      (serial_number, model_id, hardware_version, manufacturing_date, batch_number, supplier_id, qc_result, warehouse_location, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available')
      RETURNING *
    `;
    
    const values = [serial_number, model_id, hardware_version, manufacturing_date, batch_number, supplier_id, qc_result, warehouse_location];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Reserve a device for installation
   */
  static async reserveDevice(serialNumber, organizationId, technicianId = null) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Check device availability
      const deviceCheck = await client.query(
        'SELECT * FROM device_inventory WHERE serial_number = $1 AND status = $2',
        [serialNumber, 'available']
      );
      
      if (deviceCheck.rows.length === 0) {
        throw new Error('Device not available for reservation');
      }
      
      // Update device status
      const updateQuery = `
        UPDATE device_inventory 
        SET status = 'reserved', 
            reserved_for_org = $1,
            reserved_by_technician = $2,
            reserved_at = NOW()
        WHERE serial_number = $3
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, [organizationId, technicianId, serialNumber]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Activate a device and assign to customer
   */
  static async activateDevice(serialNumber, organizationId, pondId, deviceId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Update inventory record
      const inventoryUpdate = `
        UPDATE device_inventory 
        SET status = 'in_service',
            organization_id = $1,
            installed_at = NOW(),
            activated_at = NOW()
        WHERE serial_number = $2
        RETURNING *
      `;
      
      await client.query(inventoryUpdate, [organizationId, serialNumber]);
      
      // Link to operational device
      const deviceUpdate = `
        UPDATE devices 
        SET serial_number = $1,
            pond_id = $2,
            status = 'online',
            activated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      
      const deviceResult = await client.query(deviceUpdate, [serialNumber, pondId, deviceId]);
      
      await client.query('COMMIT');
      return deviceResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Report device for maintenance
   */
  static async reportForMaintenance(serialNumber, issueDescription, reportedBy) {
    const query = `
      UPDATE device_inventory 
      SET status = 'under_maintenance',
          maintenance_reason = $1,
          reported_by = $2,
          reported_at = NOW()
      WHERE serial_number = $3
      RETURNING *
    `;
    
    const result = await db.query(query, [issueDescription, reportedBy, serialNumber]);
    return result.rows[0];
  }

  /**
   * Complete maintenance and return to service
   */
  static async completeMaintenance(serialNumber, notes, technicianId) {
    const query = `
      UPDATE device_inventory 
      SET status = 'in_service',
          maintenance_notes = $1,
          last_serviced_by = $2,
          last_serviced_at = NOW(),
          maintenance_reason = NULL,
          reported_by = NULL,
          reported_at = NULL
      WHERE serial_number = $3
      RETURNING *
    `;
    
    const result = await db.query(query, [notes, technicianId, serialNumber]);
    return result.rows[0];
  }

  /**
   * Replace a faulty device
   */
  static async replaceDevice(oldSerialNumber, newSerialNumber, technicianId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Get old device info
      const oldDevice = await client.query(
        'SELECT * FROM device_inventory WHERE serial_number = $1',
        [oldSerialNumber]
      );
      
      if (oldDevice.rows.length === 0) {
        throw new Error('Old device not found');
      }
      
      // Mark old device as returned
      await client.query(`
        UPDATE device_inventory 
        SET status = 'returned',
            returned_at = NOW(),
            return_reason = 'replacement',
            replaced_by_serial = $1
        WHERE serial_number = $2
      `, [newSerialNumber, oldSerialNumber]);
      
      // Activate new device with same assignment
      const orgId = oldDevice.rows[0].organization_id;
      const pondResult = await client.query(
        'SELECT id FROM ponds WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1',
        [orgId]
      );
      
      if (pondResult.rows.length > 0) {
        await this.activateDevice(newSerialNumber, orgId, pondResult.rows[0].id, null);
      }
      
      await client.query('COMMIT');
      return { success: true, newSerialNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get device lifecycle history
   */
  static async getDeviceHistory(serialNumber) {
    const query = `
      SELECT 
        di.*,
        dm.description as maintenance_description,
        dm.completed_at as maintenance_completed_at,
        dl.event_type,
        dl.event_date,
        dl.details
      FROM device_inventory di
      LEFT JOIN device_maintenance dm ON di.serial_number = dm.serial_number
      LEFT JOIN device_lifecycle_log dl ON di.serial_number = dl.serial_number
      WHERE di.serial_number = $1
      ORDER BY dl.event_date DESC
    `;
    
    const result = await db.query(query, [serialNumber]);
    return result.rows;
  }

  /**
   * Search inventory by various criteria
   */
  static async searchInventory(filters) {
    const { status, model_id, batch_number, organization_id, date_from, date_to } = filters;
    
    let query = 'SELECT * FROM device_inventory WHERE 1=1';
    const values = [];
    let paramCount = 1;
    
    if (status) {
      query += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }
    
    if (model_id) {
      query += ` AND model_id = $${paramCount}`;
      values.push(model_id);
      paramCount++;
    }
    
    if (batch_number) {
      query += ` AND batch_number = $${paramCount}`;
      values.push(batch_number);
      paramCount++;
    }
    
    if (organization_id) {
      query += ` AND organization_id = $${paramCount}`;
      values.push(organization_id);
      paramCount++;
    }
    
    if (date_from) {
      query += ` AND manufacturing_date >= $${paramCount}`;
      values.push(date_from);
      paramCount++;
    }
    
    query += ' ORDER BY manufacturing_date DESC';
    
    const result = await db.query(query, values);
    return result.rows;
  }
}

module.exports = DeviceInventoryService;

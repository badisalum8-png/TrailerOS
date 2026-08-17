/**
 * Maintenance Management Service
 * Handles preventive and corrective maintenance tasks
 */
const db = require('../db');

class MaintenanceService {
  /**
   * Create a maintenance task
   */
  static async createTask(taskData) {
    const {
      device_id,
      pond_id,
      task_type, // 'preventive', 'corrective', 'calibration', 'inspection'
      title,
      description,
      scheduled_date,
      priority = 'medium', // low, medium, high, critical
      assigned_to,
      estimated_duration_minutes,
      required_parts
    } = taskData;

    const query = `
      INSERT INTO maintenance_tasks 
      (device_id, pond_id, task_type, title, description, scheduled_date, priority, assigned_to, estimated_duration_minutes, required_parts, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING *
    `;
    
    const values = [device_id, pond_id, task_type, title, description, scheduled_date, priority, assigned_to, estimated_duration_minutes, JSON.stringify(required_parts || [])];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Create recurring maintenance schedule
   */
  static async createRecurringSchedule(scheduleData) {
    const {
      device_model_id,
      task_type,
      title,
      description,
      interval_days,
      priority,
      estimated_duration_minutes
    } = scheduleData;

    const query = `
      INSERT INTO maintenance_schedules 
      (device_model_id, task_type, title, description, interval_days, priority, estimated_duration_minutes, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING *
    `;
    
    const values = [device_model_id, task_type, title, description, interval_days, priority, estimated_duration_minutes];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Update task status
   */
  static async updateTaskStatus(taskId, status, completedBy = null) {
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled', 'overdue'];
    
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    let query;
    let values;

    if (status === 'completed') {
      query = `
        UPDATE maintenance_tasks 
        SET status = $1, 
            completed_by = $2,
            completed_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      values = [status, completedBy, taskId];
    } else if (status === 'in_progress') {
      query = `
        UPDATE maintenance_tasks 
        SET status = $1, 
            started_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      values = [status, taskId];
    } else {
      query = `
        UPDATE maintenance_tasks 
        SET status = $1
        WHERE id = $2
        RETURNING *
      `;
      values = [status, taskId];
    }

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Complete a maintenance task with details
   */
  static async completeTask(taskId, completionData) {
    const {
      completed_by,
      notes,
      parts_used,
      actual_duration_minutes,
      photos,
      next_maintenance_date
    } = completionData;

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Update task
      const taskQuery = `
        UPDATE maintenance_tasks 
        SET status = 'completed',
            completed_by = $1,
            completed_at = NOW(),
            notes = $2,
            parts_used = $3,
            actual_duration_minutes = $4,
            photos = $5
        WHERE id = $6
        RETURNING *
      `;
      
      const taskResult = await client.query(taskQuery, [
        completed_by, 
        notes, 
        JSON.stringify(parts_used || []), 
        actual_duration_minutes, 
        JSON.stringify(photos || []), 
        taskId
      ]);

      // Create calibration record if applicable
      if (completionData.calibration_data) {
        await client.query(`
          INSERT INTO sensor_calibrations 
          (device_id, sensor_type, calibration_date, calibrated_by, calibration_data, next_due_date)
          VALUES ($1, $2, NOW(), $3, $4, $5)
        `, [
          taskResult.rows[0].device_id,
          completionData.calibration_data.sensor_type,
          completed_by,
          JSON.stringify(completionData.calibration_data),
          next_maintenance_date
        ]);
      }

      await client.query('COMMIT');
      return taskResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get upcoming maintenance tasks
   */
  static async getUpcomingTasks(organizationId, daysAhead = 7) {
    const query = `
      SELECT 
        mt.*,
        d.serial_number as device_serial,
        p.name as pond_name,
        u.name as assigned_user_name
      FROM maintenance_tasks mt
      JOIN devices d ON mt.device_id = d.id
      JOIN ponds p ON mt.pond_id = p.id
      LEFT JOIN users u ON mt.assigned_to = u.id
      WHERE p.organization_id = $1
        AND mt.status IN ('pending', 'in_progress')
        AND mt.scheduled_date <= NOW() + INTERVAL '${daysAhead} days'
      ORDER BY mt.scheduled_date ASC, mt.priority DESC
    `;
    
    const result = await db.query(query, [organizationId]);
    return result.rows;
  }

  /**
   * Get overdue tasks
   */
  static async getOverdueTasks(organizationId) {
    const query = `
      SELECT 
        mt.*,
        d.serial_number as device_serial,
        p.name as pond_name,
        u.name as assigned_user_name,
        EXTRACT(DAY FROM NOW() - mt.scheduled_date) as days_overdue
      FROM maintenance_tasks mt
      JOIN devices d ON mt.device_id = d.id
      JOIN ponds p ON mt.pond_id = p.id
      LEFT JOIN users u ON mt.assigned_to = u.id
      WHERE p.organization_id = $1
        AND mt.status IN ('pending', 'in_progress')
        AND mt.scheduled_date < NOW()
      ORDER BY mt.scheduled_date ASC
    `;
    
    const result = await db.query(query, [organizationId]);
    return result.rows;
  }

  /**
   * Generate maintenance tasks from schedules
   */
  static async generateScheduledTasks() {
    const query = `
      SELECT 
        ms.*,
        d.id as device_id,
        d.pond_id,
        d.last_maintenance_date
      FROM maintenance_schedules ms
      JOIN devices d ON d.model_id = ms.device_model_id
      WHERE ms.is_active = true
        AND (d.last_maintenance_date IS NULL 
             OR d.last_maintenance_date < NOW() - (ms.interval_days || ' days')::INTERVAL)
    `;
    
    const schedules = await db.query(query);
    
    const createdTasks = [];
    
    for (const schedule of schedules.rows) {
      const task = await this.createTask({
        device_id: schedule.device_id,
        pond_id: schedule.pond_id,
        task_type: schedule.task_type,
        title: schedule.title,
        description: schedule.description,
        scheduled_date: new Date(),
        priority: schedule.priority,
        estimated_duration_minutes: schedule.estimated_duration_minutes
      });
      
      createdTasks.push(task);
    }
    
    return createdTasks;
  }

  /**
   * Get maintenance history for a device
   */
  static async getDeviceHistory(deviceId) {
    const query = `
      SELECT 
        mt.*,
        u.name as completed_by_name
      FROM maintenance_tasks mt
      LEFT JOIN users u ON mt.completed_by = u.id
      WHERE mt.device_id = $1
        AND mt.status = 'completed'
      ORDER BY mt.completed_at DESC
    `;
    
    const result = await db.query(query, [deviceId]);
    return result.rows;
  }

  /**
   * Get maintenance statistics
   */
  static async getStatistics(organizationId, startDate, endDate) {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_tasks,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue_tasks,
        AVG(actual_duration_minutes) as avg_duration,
        COUNT(*) FILTER (WHERE task_type = 'preventive') as preventive_count,
        COUNT(*) FILTER (WHERE task_type = 'corrective') as corrective_count,
        COUNT(*) FILTER (WHERE task_type = 'calibration') as calibration_count
      FROM maintenance_tasks mt
      JOIN devices d ON mt.device_id = d.id
      JOIN ponds p ON d.pond_id = p.id
      WHERE p.organization_id = $1
        AND mt.created_at BETWEEN $2 AND $3
    `;
    
    const result = await db.query(query, [organizationId, startDate, endDate]);
    return result.rows[0];
  }
}

module.exports = MaintenanceService;

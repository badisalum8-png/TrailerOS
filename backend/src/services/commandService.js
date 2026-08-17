import pool from '../db/index.js';

/**
 * Handle command response from IoT device
 * @param {string} deviceId - The device ID sending the response
 * @param {object} payload - Command response payload
 */
export async function handleCommandResponse(deviceId, payload) {
  const { commandId, command, status, message, timestamp } = payload;

  console.log(`Command response from ${deviceId}: ${command} - ${status}`);

  try {
    // Update command status in database
    await pool.query(
      `UPDATE equipment_commands
       SET status = $1,
           response_message = $2,
           completed_at = $3
       WHERE id = $4`,
      [status, message, timestamp, commandId]
    );

    if (status === 'FAILED') {
      console.error(`Command failed on device ${deviceId}: ${message}`);
      // Optionally create an alert for failed commands
    }
  } catch (err) {
    console.error('Error processing command response:', err);
  }
}

/**
 * Send a remote command to a device
 * @param {string} deviceId - Target device serial number
 * @param {string} commandType - Type of command (START_PUMP, STOP_AERATOR, etc.)
 * @param {object} params - Additional command parameters
 * @param {string} userId - User initiating the command (for audit)
 */
export async function sendRemoteCommand(deviceId, commandType, params = {}, userId = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify device exists and is active
    const deviceResult = await client.query(
      `SELECT id, status, pond_id FROM devices WHERE serial_number = $1`,
      [deviceId]
    );

    if (deviceResult.rows.length === 0) {
      throw new Error('Device not found');
    }

    const device = deviceResult.rows[0];

    if (device.status === 'OFFLINE') {
      throw new Error('Device is offline, command cannot be delivered');
    }

    // Create command record
    const commandResult = await client.query(
      `INSERT INTO equipment_commands 
       (device_id, command_type, params, initiated_by, status, created_at)
       VALUES ($1, $2, $3, $4, 'PENDING', NOW())
       RETURNING id`,
      [device.id, commandType, JSON.stringify(params), userId]
    );

    const commandId = commandResult.rows[0].id;

    await client.query('COMMIT');

    // Publish command via MQTT
    const { mqttClient } = await import('../mqtt/client.js');
    
    const topic = `aquaculture/${deviceId}/command`;
    const message = {
      commandId,
      command: commandType,
      params,
      timestamp: new Date().toISOString(),
    };

    await mqttClient.publish(topic, message);

    console.log(`Command ${commandId} sent to device ${deviceId}`);

    return { commandId, status: 'PENDING' };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error sending remote command:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get command history for a device
 */
export async function getCommandHistory(deviceId, limit = 50) {
  const result = await pool.query(
    `SELECT ec.id, ec.command_type, ec.params, ec.status, ec.response_message,
            ec.created_at, ec.completed_at, u.full_name as initiated_by
     FROM equipment_commands ec
     JOIN devices d ON ec.device_id = d.id
     LEFT JOIN users u ON ec.initiated_by = u.id
     WHERE d.serial_number = $1
     ORDER BY ec.created_at DESC
     LIMIT $2`,
    [deviceId, limit]
  );

  return result.rows;
}

import { query } from '../db/index.js';

export const createAutomationRule = async (ruleData) => {
  const { 
    organizationId, 
    farmId, 
    pondId, 
    deviceId, 
    name, 
    triggerType, 
    triggerSensor, 
    conditionOperator, 
    thresholdValue, 
    actionType, 
    targetDevice, 
    actionValue, 
    minRuntime, 
    maxRuntime, 
    cooldownPeriod, 
    activeDays, 
    activeHoursStart, 
    activeHoursEnd, 
    priority, 
    isOfflineCapable 
  } = ruleData;
  
  const result = await query(
    `INSERT INTO automation_rules (
      organization_id, farm_id, pond_id, device_id, name, trigger_type, trigger_sensor,
      condition_operator, threshold_value, action_type, target_device, action_value,
      min_runtime_seconds, max_runtime_seconds, cooldown_seconds, active_days,
      active_hours_start, active_hours_end, priority, is_offline_capable, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'active')
     RETURNING *`,
    [organizationId, farmId, pondId, deviceId, name, triggerType, triggerSensor, conditionOperator, thresholdValue, actionType, targetDevice, actionValue, minRuntime, maxRuntime, cooldownPeriod, activeDays, activeHoursStart, activeHoursEnd, priority, isOfflineCapable]
  );
  
  return result.rows[0];
};

export const getAutomationRulesByPond = async (pondId) => {
  const result = await query(
    `SELECT * FROM automation_rules
     WHERE pond_id = $1 AND status = 'active'
     ORDER BY priority DESC, created_at DESC`,
    [pondId]
  );
  
  return result.rows;
};

export const getAutomationRulesByOrganization = async (organizationId) => {
  const result = await query(
    `SELECT ar.*, f.name as farm_name, p.name as pond_name
     FROM automation_rules ar
     JOIN farms f ON ar.farm_id = f.id
     JOIN ponds p ON ar.pond_id = p.id
     WHERE ar.organization_id = $1
     ORDER BY ar.created_at DESC`,
    [organizationId]
  );
  
  return result.rows;
};

export const updateAutomationRule = async (ruleId, updates) => {
  const allowedFields = [
    'name', 'trigger_type', 'trigger_sensor', 'condition_operator', 'threshold_value',
    'action_type', 'target_device', 'action_value', 'min_runtime_seconds', 'max_runtime_seconds',
    'cooldown_seconds', 'active_days', 'active_hours_start', 'active_hours_end', 'priority', 'is_offline_capable'
  ];
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
  
  values.push(ruleId);
  
  const result = await query(
    `UPDATE automation_rules SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${index}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

export const deactivateAutomationRule = async (ruleId) => {
  const result = await query(
    `UPDATE automation_rules SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [ruleId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Rule not found');
  }
  
  return result.rows[0];
};

export const activateAutomationRule = async (ruleId) => {
  const result = await query(
    `UPDATE automation_rules SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [ruleId]
  );
  
  if (result.rows.length === 0) {
    throw newError('Rule not found');
  }
  
  return result.rows[0];
};

export const logAutomationExecution = async (executionData) => {
  const { ruleId, deviceId, triggeredBy, previousState, newState, executionResult, errorMessage } = executionData;
  
  const result = await query(
    `INSERT INTO automation_executions (
      rule_id, device_id, triggered_by_value, previous_state, new_state, execution_result, error_message
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [ruleId, deviceId, triggeredBy, previousState, newState, executionResult, errorMessage]
  );
  
  return result.rows[0];
};

export const getAutomationExecutionHistory = async (ruleId, limit = 50) => {
  const result = await query(
    `SELECT ae.*, ar.name as rule_name
     FROM automation_executions ae
     JOIN automation_rules ar ON ae.rule_id = ar.id
     WHERE ae.rule_id = $1
     ORDER BY ae.executed_at DESC
     LIMIT $2`,
    [ruleId, limit]
  );
  
  return result.rows;
};

export const getAutomationRuleById = async (ruleId) => {
  const result = await query(
    `SELECT ar.*, f.name as farm_name, p.name as pond_name
     FROM automation_rules ar
     JOIN farms f ON ar.farm_id = f.id
     JOIN ponds p ON ar.pond_id = p.id
     WHERE ar.id = $1`,
    [ruleId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
};

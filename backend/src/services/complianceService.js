/**
 * Compliance Service - Regulatory Reporting & Certification
 * Automates compliance reporting for aquaculture regulations
 * Generates certificates, audit trails, and regulatory submissions
 */

const db = require('../db');
const { sendNotification } = require('./notificationService');

class ComplianceService {
  /**
   * Generate regulatory compliance report
   */
  async generateComplianceReport(organizationId, reportType, period) {
    const reportData = {};
    
    // Water Quality Compliance
    if (reportType === 'water_quality' || reportType === 'comprehensive') {
      reportData.waterQuality = await this.getWaterQualityCompliance(organizationId, period);
    }
    
    // Mortality & Disease Reporting
    if (reportType === 'mortality' || reportType === 'comprehensive') {
      reportData.mortality = await this.getMortalityCompliance(organizationId, period);
    }
    
    // Feed & Chemical Usage
    if (reportType === 'chemical_usage' || reportType === 'comprehensive') {
      reportData.chemicalUsage = await this.getChemicalUsageCompliance(organizationId, period);
    }
    
    // Environmental Impact
    if (reportType === 'environmental' || reportType === 'comprehensive') {
      reportData.environmental = await this.getEnvironmentalCompliance(organizationId, period);
    }
    
    // Generate PDF report
    const reportUrl = await this.generatePDFReport(organizationId, reportType, reportData, period);
    
    // Save report record
    const savedReport = await db.pool.query(
      `INSERT INTO compliance_reports (
        organization_id, report_type, period_start, period_end,
        report_data, pdf_url, status, generated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'generated', NOW())
      RETURNING *`,
      [
        organizationId,
        reportType,
        period.startDate,
        period.endDate,
        JSON.stringify(reportData),
        reportUrl
      ]
    );
    
    return savedReport.rows[0];
  }
  
  /**
   * Get water quality compliance metrics
   */
  async getWaterQualityCompliance(organizationId, period) {
    const result = await db.pool.query(
      `SELECT 
        COUNT(*) as total_readings,
        COUNT(*) FILTER (WHERE sensor_type = 'dissolved_oxygen' AND value < 5) as low_do_events,
        COUNT(*) FILTER (WHERE sensor_type = 'ph' AND (value < 6.5 OR value > 8.5)) as ph_violations,
        COUNT(*) FILTER (WHERE sensor_type = 'ammonia' AND value > 0.02) as ammonia_violations,
        COUNT(*) FILTER (WHERE sensor_type = 'nitrite' AND value > 0.1) as nitrite_violations,
        AVG(value) FILTER (WHERE sensor_type = 'dissolved_oxygen') as avg_do,
        AVG(value) FILTER (WHERE sensor_type = 'ph') as avg_ph,
        compliance_percentage
       FROM (
         SELECT 
           sensor_type,
           value,
           CASE 
             WHEN sensor_type = 'dissolved_oxygen' AND value >= 5 THEN 1
             WHEN sensor_type = 'ph' AND value BETWEEN 6.5 AND 8.5 THEN 1
             WHEN sensor_type = 'ammonia' AND value <= 0.02 THEN 1
             WHEN sensor_type = 'nitrite' AND value <= 0.1 THEN 1
             ELSE 0
           END as compliant
         FROM sensor_readings sr
         JOIN devices d ON sr.device_id = d.id
         JOIN ponds p ON d.pond_id = p.id
         WHERE p.organization_id = $1
           AND time BETWEEN $2 AND $3
       ) subquery,
       (SELECT 
         ROUND(100.0 * SUM(compliant) / COUNT(*), 2) as compliance_percentage
        FROM (
          SELECT 
            CASE 
              WHEN sensor_type = 'dissolved_oxygen' AND value >= 5 THEN 1
              WHEN sensor_type = 'ph' AND value BETWEEN 6.5 AND 8.5 THEN 1
              WHEN sensor_type = 'ammonia' AND value <= 0.02 THEN 1
              WHEN sensor_type = 'nitrite' AND value <= 0.1 THEN 1
              ELSE 0
            END as compliant
          FROM sensor_readings sr
          JOIN devices d ON sr.device_id = d.id
          JOIN ponds p ON d.pond_id = p.id
          WHERE p.organization_id = $1
            AND time BETWEEN $2 AND $3
        ) compliance_calc
       ) compliance
       `,
      [organizationId, period.startDate, period.endDate]
    );
    
    return result.rows[0] || {};
  }
  
  /**
   * Get mortality compliance metrics
   */
  async getMortalityCompliance(organizationId, period) {
    const result = await db.pool.query(
      `SELECT 
        SUM(mortality_count) as total_mortality,
        COUNT(*) as mortality_events,
        AVG(mortality_count) as avg_daily_mortality,
        MAX(mortality_count) as max_daily_mortality,
        STRING_AGG(DISTINCT cause_of_death, ', ') as causes,
        ROUND(100.0 * SUM(mortality_count) / NULLIF(SUM(stock_quantity), 0), 2) as mortality_rate_percent
       FROM fish_mortality_records fmr
       JOIN fish_batches fb ON fmr.batch_id = fb.id
       JOIN ponds p ON fb.pond_id = p.id
       WHERE p.organization_id = $1
         AND event_date BETWEEN $2 AND $3`,
      [organizationId, period.startDate, period.endDate]
    );
    
    return result.rows[0] || {};
  }
  
  /**
   * Get chemical/medication usage compliance
   */
  async getChemicalUsageCompliance(organizationId, period) {
    const result = await db.pool.query(
      `SELECT 
        chemical_name,
        SUM(quantity_used) as total_quantity,
        unit,
        purpose,
        COUNT(*) as applications,
        MAX(withdrawal_period_days) as max_withdrawal_period,
        STRING_AGG(DISTINCT applied_by, ', ') as applicators
       FROM chemical_applications ca
       JOIN ponds p ON ca.pond_id = p.id
       WHERE p.organization_id = $1
         AND application_date BETWEEN $2 AND $3
       GROUP BY chemical_name, unit, purpose`,
      [organizationId, period.startDate, period.endDate]
    );
    
    return result.rows;
  }
  
  /**
   * Get environmental compliance metrics
   */
  async getEnvironmentalCompliance(organizationId, period) {
    // Water discharge quality
    const dischargeData = await db.pool.query(
      `SELECT 
        AVG(tss) as avg_tss,
        MAX(tss) as max_tss,
        AVG(total_nitrogen) as avg_nitrogen,
        AVG(total_phosphorus) as avg_phosphorus
       FROM discharge_monitoring dm
       JOIN farms f ON dm.farm_id = f.id
       WHERE f.organization_id = $1
         AND sample_date BETWEEN $2 AND $3`,
      [organizationId, period.startDate, period.endDate]
    );
    
    // Energy consumption
    const energyData = await db.pool.query(
      `SELECT 
        SUM(energy_kwh) as total_energy,
        AVG(energy_kwh) as avg_daily_energy
       FROM energy_consumption ec
       JOIN devices d ON ec.device_id = d.id
       JOIN ponds p ON d.pond_id = p.id
       WHERE p.organization_id = $1
         AND recorded_at BETWEEN $2 AND $3`,
      [organizationId, period.startDate, period.endDate]
    );
    
    return {
      discharge: dischargeData.rows[0] || {},
      energy: energyData.rows[0] || {}
    };
  }
  
  /**
   * Generate PDF report (placeholder - would use PDF library)
   */
  async generatePDFReport(organizationId, reportType, data, period) {
    // In production, this would use a PDF generation library like pdfkit or puppeteer
    // For now, return a mock URL
    const reportId = `RPT-${organizationId}-${reportType}-${Date.now()}`;
    return `/reports/compliance/${reportId}.pdf`;
  }
  
  /**
   * Schedule automatic regulatory submissions
   */
  async scheduleRegulatorySubmission(organizationId, submissionConfig) {
    const scheduled = await db.pool.query(
      `INSERT INTO regulatory_submissions (
        organization_id, agency_name, report_type, frequency,
        next_due_date, auto_submit, contact_email, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
      RETURNING *`,
      [
        organizationId,
        submissionConfig.agency,
        submissionConfig.reportType,
        submissionConfig.frequency, // 'monthly', 'quarterly', 'annual'
        submissionConfig.nextDueDate,
        submissionConfig.autoSubmit || false,
        submissionConfig.contactEmail
      ]
    );
    
    return scheduled.rows[0];
  }
  
  /**
   * Process scheduled regulatory submissions
   */
  async processScheduledSubmissions() {
    const dueSubmissions = await db.pool.query(
      `SELECT * FROM regulatory_submissions 
       WHERE next_due_date <= NOW() 
         AND status = 'scheduled'`
    );
    
    for (const submission of dueSubmissions.rows) {
      try {
        // Generate compliance report
        const period = this.getReportingPeriod(submission.frequency);
        const report = await this.generateComplianceReport(
          submission.organization_id,
          submission.report_type,
          period
        );
        
        if (submission.auto_submit) {
          // Here you would integrate with regulatory agency API
          // or generate email submission
          await this.submitToAgency(submission, report);
        }
        
        // Update next due date
        const nextDue = this.calculateNextDueDate(submission.frequency);
        await db.pool.query(
          `UPDATE regulatory_submissions 
           SET next_due_date = $1, last_submission_date = NOW()
           WHERE id = $2`,
          [nextDue, submission.id]
        );
        
        // Notify organization
        await sendNotification(submission.organization_id, {
          type: 'regulatory_submission_completed',
          title: 'Regulatory Report Submitted',
          message: `Your ${submission.report_type} report has been submitted to ${submission.agency_name}`,
          data: { submissionId: submission.id, reportId: report.id }
        });
        
      } catch (error) {
        console.error(`Failed to process submission ${submission.id}:`, error);
        await db.pool.query(
          `UPDATE regulatory_submissions SET status = 'failed' WHERE id = $1`,
          [submission.id]
        );
      }
    }
  }
  
  /**
   * Get reporting period based on frequency
   */
  getReportingPeriod(frequency) {
    const endDate = new Date();
    let startDate;
    
    switch (frequency) {
      case 'monthly':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarterly':
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'annual':
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    
    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  }
  
  /**
   * Calculate next due date
   */
  calculateNextDueDate(frequency) {
    const now = new Date();
    
    switch (frequency) {
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        break;
      case 'quarterly':
        now.setMonth(now.getMonth() + 3);
        break;
      case 'annual':
        now.setFullYear(now.getFullYear() + 1);
        break;
    }
    
    return now;
  }
  
  /**
   * Submit report to regulatory agency (placeholder)
   */
  async submitToAgency(submission, report) {
    // Integration point for regulatory agency APIs
    // Could be email, SFTP, REST API, etc.
    console.log(`Submitting report ${report.id} to ${submission.agency_name}`);
    return { success: true, submissionRef: `SUB-${Date.now()}` };
  }
  
  /**
   * Get certification status for farm
   */
  async getCertificationStatus(organizationId, farmId) {
    const certifications = await db.pool.query(
      `SELECT * FROM farm_certifications 
       WHERE organization_id = $1 AND farm_id = $2
       ORDER BY expiry_date DESC`,
      [organizationId, farmId]
    );
    
    const complianceScore = await this.calculateComplianceScore(organizationId, farmId);
    
    return {
      certifications: certifications.rows,
      complianceScore,
      eligibleForRenewal: certifications.rows.some(c => 
        c.expiry_date > new Date() && c.expiry_date < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      )
    };
  }
  
  /**
   * Calculate overall compliance score
   */
  async calculateComplianceScore(organizationId, farmId) {
    const period = {
      startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString()
    };
    
    const waterQuality = await this.getWaterQualityCompliance(organizationId, period);
    const mortality = await this.getMortalityCompliance(organizationId, period);
    
    let score = 100;
    
    // Deduct for water quality violations
    if (waterQuality.compliance_percentage) {
      score -= (100 - waterQuality.compliance_percentage) * 0.5;
    }
    
    // Deduct for high mortality
    if (mortality.mortality_rate_percent && mortality.mortality_rate_percent > 5) {
      score -= Math.min((mortality.mortality_rate_percent - 5) * 2, 20);
    }
    
    return Math.round(Math.max(score, 0));
  }
}

module.exports = new ComplianceService();

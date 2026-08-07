-- =====================================================
-- PHASE 3: Business Features Database Schema
-- Subscription Billing, Support, Audit, API Management
-- =====================================================

-- =============================================
-- SUBSCRIPTION & BILLING TABLES
-- =============================================

-- Subscription plans reference table
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    interval VARCHAR(20) NOT NULL DEFAULT 'month',
    interval_months INTEGER NOT NULL DEFAULT 1,
    features JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default plans
INSERT INTO plans (id, name, price, currency, interval, features) VALUES
('free', 'Free Tier', 0, 'USD', 'month', '{"maxPonds": 5, "maxDevices": 10, "dataRetention": 7, "alertsPerMonth": 50, "apiCallsPerDay": 1000, "supportLevel": "community"}'),
('starter', 'Starter', 29, 'USD', 'month', '{"maxPonds": 20, "maxDevices": 50, "dataRetention": 30, "alertsPerMonth": 500, "apiCallsPerDay": 10000, "supportLevel": "email"}'),
('professional', 'Professional', 99, 'USD', 'month', '{"maxPonds": 100, "maxDevices": 250, "dataRetention": 365, "alertsPerMonth": 5000, "apiCallsPerDay": 100000, "supportLevel": "priority"}'),
('enterprise', 'Enterprise', 499, 'USD', 'month', '{"maxPonds": -1, "maxDevices": -1, "dataRetention": -1, "alertsPerMonth": -1, "apiCallsPerDay": -1, "supportLevel": "dedicated"}')
ON CONFLICT (id) DO NOTHING;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    status VARCHAR(20) NOT NULL DEFAULT 'trialing', -- trialing, active, past_due, canceled, unpaid
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    canceled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT,
    payment_failure_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organization ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, paid, failed, void, refunded
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE,
    payment_method VARCHAR(50),
    failure_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_organization ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

-- Payment methods table
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- stripe, paypal, pesapal, mpesa
    provider_customer_id VARCHAR(255),
    provider_payment_method_id VARCHAR(255),
    type VARCHAR(50) NOT NULL, -- card, mobile_money, bank_account
    last_four VARCHAR(10),
    brand VARCHAR(50),
    exp_month INTEGER,
    exp_year INTEGER,
    is_default BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_organization ON payment_methods(organization_id);

-- =============================================
-- SUPPORT TICKETING TABLES
-- =============================================

-- Support tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    status VARCHAR(30) NOT NULL DEFAULT 'open', -- open, in_progress, waiting_customer, waiting_third_party, resolved, closed
    category VARCHAR(100),
    sla_due_at TIMESTAMP WITH TIME ZONE,
    resolution_due_at TIMESTAMP WITH TIME ZONE,
    first_responded_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    resolution TEXT,
    satisfaction_rating INTEGER CHECK (satisfaction_rating >= 1 AND satisfaction_rating <= 5),
    satisfaction_comment TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_organization ON support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_sla_due ON support_tickets(sla_due_at);

-- Ticket comments table
CREATE TABLE IF NOT EXISTS ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT false,
    attachments_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);

-- Ticket attachments table
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES ticket_comments(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments(ticket_id);

-- Knowledge base articles table
CREATE TABLE IF NOT EXISTS knowledge_base_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100),
    tags TEXT[],
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    views INTEGER NOT NULL DEFAULT 0,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    not_helpful_count INTEGER NOT NULL DEFAULT 0,
    published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON knowledge_base_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_published ON knowledge_base_articles(published);
CREATE INDEX IF NOT EXISTS idx_kb_articles_tags ON knowledge_base_articles USING GIN(tags);

-- =============================================
-- AUDIT LOGGING TABLES
-- =============================================

-- Audit logs table (immutable)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    description TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low', -- low, medium, high, critical
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_organization ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_risk_level ON audit_logs(risk_level);

-- =============================================
-- API MANAGEMENT TABLES
-- =============================================

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
    key_id VARCHAR(50) PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    permissions JSONB NOT NULL DEFAULT '["read"]',
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_organization ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- API rate limit logs table
CREATE TABLE IF NOT EXISTS api_rate_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_logs_organization_endpoint ON api_rate_logs(organization_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_logs_created_at ON api_rate_logs(created_at);

-- Webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events JSONB NOT NULL DEFAULT '[]',
    secret VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_organization ON webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);

-- Webhook deliveries table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    signature TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, success, failed
    response_code INTEGER,
    response_body TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);

-- Data exports table
CREATE TABLE IF NOT EXISTS data_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    data_types JSONB NOT NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'json',
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    file_url TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_data_exports_organization ON data_exports(organization_id);
CREATE INDEX IF NOT EXISTS idx_data_exports_status ON data_exports(status);

-- =============================================
-- INTEGRATION MANAGEMENT TABLES
-- =============================================

-- Integration providers configuration
CREATE TABLE IF NOT EXISTS integration_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name VARCHAR(100) NOT NULL UNIQUE,
    provider_type VARCHAR(50) NOT NULL, -- payment, weather, sms, email, mapping
    display_name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    documentation_url TEXT,
    config_schema JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization-specific integrations
CREATE TABLE IF NOT EXISTS organization_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES integration_providers(id),
    enabled BOOLEAN NOT NULL DEFAULT false,
    credentials_encrypted TEXT,
    config JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'inactive', -- inactive, active, error
    last_sync_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_org_integrations_organization ON organization_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_integrations_provider ON organization_integrations(provider_id);

-- Insert default integration providers
INSERT INTO integration_providers (provider_name, provider_type, display_name, config_schema) VALUES
('stripe', 'payment', 'Stripe', '{"fields": [{"name": "publishable_key", "type": "string", "required": true}, {"name": "secret_key", "type": "string", "required": true, "sensitive": true}, {"name": "webhook_secret", "type": "string", "required": false, "sensitive": true}]}'),
('paypal', 'payment', 'PayPal', '{"fields": [{"name": "client_id", "type": "string", "required": true}, {"name": "client_secret", "type": "string", "required": true, "sensitive": true}]}'),
('pesapal', 'payment', 'Pesapal', '{"fields": [{"name": "consumer_key", "type": "string", "required": true}, {"name": "consumer_secret", "type": "string", "required": true, "sensitive": true}, {"name": "sandbox", "type": "boolean", "default": true}]}'),
('mpesa', 'payment', 'M-Pesa', '{"fields": [{"name": "consumer_key", "type": "string", "required": true}, {"name": "consumer_secret", "type": "string", "required": true, "sensitive": true}, {"name": "passkey", "type": "string", "required": true, "sensitive": true}, {"name": "shortcode", "type": "string", "required": true}]}'),
('twilio', 'sms', 'Twilio', '{"fields": [{"name": "account_sid", "type": "string", "required": true}, {"name": "auth_token", "type": "string", "required": true, "sensitive": true}, {"name": "from_number", "type": "string", "required": true}]}'),
('africas_talking', 'sms', "Africa's Talking", '{"fields": [{"name": "username", "type": "string", "required": true}, {"name": "api_key", "type": "string", "required": true, "sensitive": true}, {"name": "from_number", "type": "string", "required": true}]}'),
('sendgrid', 'email', 'SendGrid', '{"fields": [{"name": "api_key", "type": "string", "required": true, "sensitive": true}, {"name": "from_email", "type": "string", "required": true}]}'),
('openweathermap', 'weather', 'OpenWeatherMap', '{"fields": [{"name": "api_key", "type": "string", "required": true, "sensitive": true}]}'),
('google_maps', 'mapping', 'Google Maps', '{"fields": [{"name": "api_key", "type": "string", "required": true, "sensitive": true}]}')
ON CONFLICT (provider_name) DO NOTHING;

-- =============================================
-- USAGE TRACKING TABLES
-- =============================================

-- Daily usage tracking
CREATE TABLE IF NOT EXISTS daily_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- api_calls, alerts_sent, storage_mb, etc.
    metric_value INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, date, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_organization ON daily_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(date);

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Function to generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.invoice_number := 'INV-' || TO_CHAR(NEW.created_at, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate invoice numbers
DROP TRIGGER IF EXISTS trg_generate_invoice_number ON invoices;
CREATE TRIGGER trg_generate_invoice_number
    BEFORE INSERT ON invoices
    FOR EACH ROW
    WHEN (NEW.invoice_number IS NULL)
    EXECUTE FUNCTION generate_invoice_number();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers
CREATE TRIGGER trg_update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_payment_methods_updated_at BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_kb_articles_updated_at BEFORE UPDATE ON knowledge_base_articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_api_keys_updated_at BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_integration_providers_updated_at BEFORE UPDATE ON integration_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_update_org_integrations_updated_at BEFORE UPDATE ON organization_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to check subscription limits
CREATE OR REPLACE FUNCTION check_subscription_limit(
    p_organization_id UUID,
    p_feature VARCHAR(50),
    p_current_value INTEGER
)
RETURNS TABLE(allowed BOOLEAN, reason VARCHAR(100), limit_value INTEGER) AS $$
DECLARE
    v_plan_features JSONB;
    v_limit INTEGER;
BEGIN
    SELECT p.features INTO v_plan_features
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.organization_id = p_organization_id
      AND s.status IN ('active', 'trialing')
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_plan_features IS NULL THEN
        -- Use free tier defaults
        v_plan_features := '{"maxPonds": 5, "maxDevices": 10}'::JSONB;
    END IF;

    v_limit := (v_plan_features->>p_feature)::INTEGER;

    IF v_limit IS NULL THEN
        RETURN QUERY SELECT false, 'feature_not_available'::VARCHAR, NULL::INTEGER;
    ELSIF v_limit = -1 THEN
        RETURN QUERY SELECT true, 'unlimited'::VARCHAR, -1;
    ELSIF p_current_value <= v_limit THEN
        RETURN QUERY SELECT true, 'within_limit'::VARCHAR, v_limit;
    ELSE
        RETURN QUERY SELECT false, 'limit_exceeded'::VARCHAR, v_limit;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;

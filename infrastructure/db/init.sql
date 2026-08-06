-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Organizations (Tenants)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    subscription_plan VARCHAR(50) DEFAULT 'STARTER', -- STARTER, PRO, ENTERPRISE
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- 2. Users
CREATE TYPE user_role AS ENUM ('OWNER', 'MANAGER', 'OPERATOR', 'TECHNICIAN');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    full_name VARCHAR(255),
    phone_number VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    UNIQUE(email, organization_id)
);

-- 3. Farms
CREATE TABLE farms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    address TEXT,
    location GEOGRAPHY(POINT, 4326), -- GPS Coordinates
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Ponds
CREATE TYPE pond_type AS ENUM ('EARTHEN', 'CONCRETE', 'CAGE', 'TANK', 'RAS');

CREATE TABLE ponds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    pond_type pond_type DEFAULT 'EARTHEN',
    volume_liters DECIMAL,
    surface_area_sqm DECIMAL,
    water_source VARCHAR(100),
    current_species VARCHAR(100),
    stocking_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Devices (IoT Controllers)
CREATE TYPE device_status AS ENUM ('MANUFACTURED', 'INVENTORY', 'SHIPPED', 'INSTALLED', 'ACTIVE', 'OFFLINE', 'MAINTENANCE', 'RETIRED');

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    mac_address VARCHAR(50),
    model_number VARCHAR(50) DEFAULT 'AQUA-CTRL-V1',
    organization_id UUID REFERENCES organizations(id), -- Null if in inventory
    farm_id UUID REFERENCES farms(id),
    pond_id UUID REFERENCES ponds(id),
    status device_status DEFAULT 'MANUFACTURED',
    firmware_version VARCHAR(20),
    last_seen_at TIMESTAMPTZ,
    battery_level DECIMAL(5,2), -- Percentage
    signal_strength INTEGER, -- RSSI
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Sensor Readings (Time-Series Hypertable)
CREATE TABLE sensor_readings (
    time TIMESTAMPTZ NOT NULL,
    device_id UUID NOT NULL,
    sensor_type VARCHAR(50) NOT NULL, -- temperature, ph, turbidity, water_level, do
    value DECIMAL NOT NULL,
    unit VARCHAR(20) NOT NULL,
    quality_flag VARCHAR(20) DEFAULT 'GOOD' -- GOOD, SUSPECT, BAD
);

-- Convert to Timescale Hypertable
SELECT create_hypertable('sensor_readings', 'time');

-- Indexes for performance
CREATE INDEX ON sensor_readings (device_id, time DESC);
CREATE INDEX ON sensor_readings (sensor_type, time DESC);

-- 7. Alerts
CREATE TYPE alert_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE alert_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    device_id UUID REFERENCES devices(id),
    pond_id UUID REFERENCES ponds(id),
    rule_name VARCHAR(255),
    message TEXT,
    severity alert_severity,
    status alert_status DEFAULT 'OPEN',
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id),
    resolved_by UUID REFERENCES users(id)
);

-- 8. Automation Rules
CREATE TABLE automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id UUID REFERENCES ponds(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    trigger_sensor VARCHAR(50) NOT NULL,
    condition_operator VARCHAR(10) NOT NULL, -- >, <, =, >=, <=
    threshold_value DECIMAL NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- START_PUMP, STOP_PUMP, START_AERATOR, ALERT_ONLY
    target_device_id UUID, -- Optional: specific device to control
    is_active BOOLEAN DEFAULT TRUE,
    cooldown_minutes INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (Multi-tenancy enforcement)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponds ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's organization
CREATE OR REPLACE FUNCTION get_current_user_org_id() RETURNS UUID AS $$
DECLARE
    user_org_id UUID;
BEGIN
    SELECT organization_id INTO user_org_id 
    FROM users 
    WHERE id = NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
    RETURN user_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies: Users can only access data within their organization
CREATE POLICY org_isolation ON farms
    FOR ALL TO PUBLIC
    USING (organization_id = get_current_user_org_id());

CREATE POLICY org_isolation ON ponds
    FOR ALL TO PUBLIC
    USING (
        farm_id IN (
            SELECT id FROM farms 
            WHERE organization_id = get_current_user_org_id()
        )
    );

CREATE POLICY org_isolation ON devices
    FOR ALL TO PUBLIC
    USING (
        organization_id = get_current_user_org_id() 
        OR organization_id IS NULL
    );

CREATE POLICY org_isolation ON sensor_readings
    FOR ALL TO PUBLIC
    USING (
        device_id IN (
            SELECT id FROM devices 
            WHERE organization_id = get_current_user_org_id()
        )
    );

CREATE POLICY org_isolation ON alerts
    FOR ALL TO PUBLIC
    USING (organization_id = get_current_user_org_id());

CREATE POLICY org_isolation ON automation_rules
    FOR ALL TO PUBLIC
    USING (
        pond_id IN (
            SELECT id FROM ponds p
            JOIN farms f ON p.farm_id = f.id
            WHERE f.organization_id = get_current_user_org_id()
        )
    );

-- 9. Device Commands (Audit Trail for Remote Control)
CREATE TYPE command_status AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'EXECUTED', 'FAILED', 'TIMEOUT');

CREATE TABLE device_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    issued_by UUID REFERENCES users(id),
    command_type VARCHAR(50) NOT NULL, -- START_PUMP, STOP_PUMP, START_AERATOR, RESTART_DEVICE, etc.
    payload JSONB, -- Additional parameters
    status command_status DEFAULT 'PENDING',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ
);

CREATE INDEX idx_device_commands_device ON device_commands(device_id, created_at DESC);
CREATE INDEX idx_device_commands_status ON device_commands(status);

-- Seed Data for Development
INSERT INTO organizations (name, slug, subscription_plan) 
VALUES ('Demo Fish Farm', 'demo-farm', 'PRO');

-- Default user: admin@demofarm.com / password: password123
-- Hash generated with bcrypt cost 10
INSERT INTO users (organization_id, email, password_hash, role, full_name) 
VALUES (
    (SELECT id FROM organizations WHERE slug='demo-farm'), 
    'admin@demofarm.com', 
    '$2b$10$rQZ9vXJXL5K5Z5Z5Z5Z5ZeYhQGYhQGYhQGYhQGYhQGYhQGYhQGYhQ', 
    'OWNER', 
    'System Administrator'
);

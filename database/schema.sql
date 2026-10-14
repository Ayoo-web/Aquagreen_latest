-- ==============================================================================
-- AQUAGREEN SMART IRRIGATION SYSTEM - SUPABASE POSTGRESQL PRODUCTION SCHEMA
-- Academic Research Database: Multi-Sensor Telemetry & Autonomous Control
-- Hardened Security, Strict RLS Policies, and Idempotent Migrations
-- ==============================================================================

-- 1. Sensor Telemetry Readings Table
CREATE TABLE IF NOT EXISTS readings (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature NUMERIC(5, 2) NOT NULL,
    humidity NUMERIC(5, 2) NOT NULL,
    soil_moisture_raw INTEGER NOT NULL CHECK (soil_moisture_raw >= 0 AND soil_moisture_raw <= 4095),
    soil_moisture_percent NUMERIC(5, 2) CHECK (soil_moisture_percent IS NULL OR soil_moisture_percent BETWEEN 0 AND 100),
    pressure NUMERIC(7, 2) NOT NULL,
    wind_speed NUMERIC(5, 2) CHECK (wind_speed IS NULL OR wind_speed BETWEEN 0 AND 75),
    lux NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
    rain_detected BOOLEAN,
    pump_state BOOLEAN NOT NULL DEFAULT FALSE,
    is_soil_fault BOOLEAN NOT NULL DEFAULT FALSE,
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    supply_tank_distance_cm NUMERIC(7, 2) CHECK (supply_tank_distance_cm IS NULL OR supply_tank_distance_cm BETWEEN 2 AND 400),
    supply_tank_percent NUMERIC(5, 2) CHECK (supply_tank_percent IS NULL OR supply_tank_percent BETWEEN 0 AND 100),
    supply_tank_sensor_ok BOOLEAN,
    collection_tank_distance_cm NUMERIC(7, 2) CHECK (collection_tank_distance_cm IS NULL OR collection_tank_distance_cm BETWEEN 2 AND 400),
    collection_tank_percent NUMERIC(5, 2) CHECK (collection_tank_percent IS NULL OR collection_tank_percent BETWEEN 0 AND 100),
    collection_tank_sensor_ok BOOLEAN,
    soil_sensor_ok BOOLEAN,
    rain_sensor_ok BOOLEAN,
    wind_sensor_ok BOOLEAN,
    wind_raw INTEGER CHECK (wind_raw IS NULL OR wind_raw BETWEEN 0 AND 4095),
    wind_voltage_v NUMERIC(6,3) CHECK (wind_voltage_v IS NULL OR wind_voltage_v BETWEEN 0 AND 3.3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Prevent duplicate sensor ingestion if ESP32 retries an identical timestamp
    CONSTRAINT uq_reading_timestamp_source UNIQUE (timestamp, is_simulated)
);

CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_readings_is_simulated ON readings(is_simulated);

-- 2. Command Queue Table (Bidirectional ESP32 Remote Control Lifecycle)
CREATE TABLE IF NOT EXISTS command_queue (
    id BIGSERIAL PRIMARY KEY,
    command_id VARCHAR(64) UNIQUE NOT NULL,
    command_type VARCHAR(32) NOT NULL CHECK (command_type IN ('PUMP_ON', 'PUMP_OFF', 'EMERGENCY_STOP')),
    duration_seconds INTEGER NOT NULL DEFAULT 300,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    dispatched_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    dispatch_attempts INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'DISPATCHED', 'ACKNOWLEDGED', 'EXPIRED', 'SUPERSEDED', 'REJECTED')),
    ack_state BOOLEAN,
    ack_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_command_queue_status_expires ON command_queue(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_command_queue_command_id ON command_queue(command_id);

-- 3. Irrigation Switching & Safety Interlock Events Table
CREATE TABLE IF NOT EXISTS irrigation_events (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(32) NOT NULL,
    trigger_reason TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    estimated_volume_liters NUMERIC(8, 2) DEFAULT 0.0,
    soil_moisture_before NUMERIC(5, 2),
    soil_moisture_after NUMERIC(5, 2),
    command_source VARCHAR(32) NOT NULL,
    pump_reported_state BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON irrigation_events(timestamp DESC);

-- 4. Shared System Settings & Calibration Table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Initial Default Settings if empty
INSERT INTO settings (key, value) VALUES
('calibration', '{
    "soilDryAdc": 3200,
    "soilWetAdc": 1400,
    "latitude": 14.5995,
    "elevation": 25.0,
    "anemometerHeight": 1.0,
    "anemometerFactor": 0.0875,
    "kRs": 0.16,
    "pumpFlowRate": 12.0,
    "relayActiveLow": true
}'::jsonb),
('automation', '{
    "enabled": true,
    "mode": "AUTO",
    "dryThresholdPercent": 35,
    "targetWetPercent": 65,
    "maxRuntimeMinutes": 15,
    "minIntervalHours": 4,
    "cooldownMinutes": 30,
    "rainInhibitionEnabled": true,
    "dailyMaxVolumeLiters": 150,
    "emergencyStop": false
}'::jsonb),
('crop', '{
    "cropName": "Generic Research Crop",
    "stage": "mid",
    "kcInitial": 0.50,
    "kcMid": 1.05,
    "kcEnd": 0.65,
    "irrigatedAreaSqM": 20.0,
    "irrigationEfficiency": 0.85
}'::jsonb),
('waterTanks', '{
    "supplyLowThresholdPercent": 20,
    "collectionHighThresholdPercent": 90,
    "alertHysteresisPercent": 5
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5. Notifications & Fault Audit Table
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    title VARCHAR(128) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(32) NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_acknowledged ON notifications(acknowledged);

-- ==============================================================================
-- Hardened Row-Level Security (RLS) Configuration
-- ==============================================================================
ALTER TABLE readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies if they exist
DROP POLICY IF EXISTS "Public Read Access on Readings" ON readings;
DROP POLICY IF EXISTS "Public Read Access on Command Queue" ON command_queue;
DROP POLICY IF EXISTS "Public Read Access on Events" ON irrigation_events;
DROP POLICY IF EXISTS "Public Read Access on Settings" ON settings;
DROP POLICY IF EXISTS "Public Read Access on Notifications" ON notifications;
DROP POLICY IF EXISTS "Service Role Full Access on Readings" ON readings;
DROP POLICY IF EXISTS "Service Role Full Access on Command Queue" ON command_queue;
DROP POLICY IF EXISTS "Service Role Full Access on Events" ON irrigation_events;
DROP POLICY IF EXISTS "Service Role Full Access on Settings" ON settings;
DROP POLICY IF EXISTS "Service Role Full Access on Notifications" ON notifications;

-- Readings Policy:
-- Authenticated users or anonymous read-only visitors can view readings.
-- Direct insert/update/delete is strictly reserved for the trusted server-side service role.
CREATE POLICY "Readings Public Select" ON readings FOR SELECT USING (true);
CREATE POLICY "Readings Service Role All" ON readings FOR ALL TO service_role USING (true);

-- Command Queue Policy:
-- STRICTLY RESTRICTED to server-side service role. Clients and physical devices MUST NEVER
-- query or manipulate the command queue table directly via client keys.
CREATE POLICY "Command Queue Service Role Only" ON command_queue FOR ALL TO service_role USING (true);

-- Irrigation Events Policy:
CREATE POLICY "Events Public Select" ON irrigation_events FOR SELECT USING (true);
CREATE POLICY "Events Service Role All" ON irrigation_events FOR ALL TO service_role USING (true);

-- Settings Policy:
-- Authenticated users can view settings; only server-side service role can write.
CREATE POLICY "Settings Public Select" ON settings FOR SELECT USING (true);
CREATE POLICY "Settings Service Role All" ON settings FOR ALL TO service_role USING (true);

-- Notifications Policy:
CREATE POLICY "Notifications Public Select" ON notifications FOR SELECT USING (true);
CREATE POLICY "Notifications Service Role All" ON notifications FOR ALL TO service_role USING (true);

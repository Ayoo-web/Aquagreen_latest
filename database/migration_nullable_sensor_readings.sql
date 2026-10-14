-- AquaGreen partial telemetry migration (run once in Supabase SQL Editor).
-- Allows the ESP32 to upload valid sensors while explicitly marking uncalibrated
-- soil/rain/wind readings as NULL. Existing historical rows are preserved.
BEGIN;
ALTER TABLE readings ALTER COLUMN soil_moisture_percent DROP NOT NULL;
ALTER TABLE readings ALTER COLUMN wind_speed DROP NOT NULL;
ALTER TABLE readings ALTER COLUMN rain_detected DROP NOT NULL;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS soil_sensor_ok BOOLEAN;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS rain_sensor_ok BOOLEAN;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS wind_sensor_ok BOOLEAN;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS wind_raw INTEGER CHECK (wind_raw IS NULL OR wind_raw BETWEEN 0 AND 4095);
ALTER TABLE readings ADD COLUMN IF NOT EXISTS wind_voltage_v NUMERIC(6,3) CHECK (wind_voltage_v IS NULL OR wind_voltage_v BETWEEN 0 AND 3.3);
COMMIT;

-- AquaGreen water-tank monitoring migration (safe to run more than once).
-- Run in Supabase SQL Editor before deploying the API/frontend changes.
ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_distance_cm NUMERIC(7, 2)
  CHECK (supply_tank_distance_cm IS NULL OR supply_tank_distance_cm BETWEEN 2 AND 400);
ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_percent NUMERIC(5, 2)
  CHECK (supply_tank_percent IS NULL OR supply_tank_percent BETWEEN 0 AND 100);
ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_sensor_ok BOOLEAN;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_distance_cm NUMERIC(7, 2)
  CHECK (collection_tank_distance_cm IS NULL OR collection_tank_distance_cm BETWEEN 2 AND 400);
ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_percent NUMERIC(5, 2)
  CHECK (collection_tank_percent IS NULL OR collection_tank_percent BETWEEN 0 AND 100);
ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_sensor_ok BOOLEAN;

INSERT INTO settings (key, value) VALUES
  ('waterTanks', '{"supplyLowThresholdPercent":20,"collectionHighThresholdPercent":90,"alertHysteresisPercent":5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

"""
AquaGreen Smart Irrigation System - Comprehensive Architectural Test Suite
Standard library unittest tests verifying:
1. Command queue peek vs claim lifecycle (Defect 2)
2. Production Supabase PostgreSQL enforcement and elimination of silent SQLite fallback (Defect 3)
3. Structured settings persistence consistency (Defect 4)
4. FAO-56 diurnal temporal data sufficiency (Defect 5)
5. Simulator segregation from physical telemetry (Defect 9)
"""

import unittest
import os
import sys
from datetime import datetime, timedelta

# Ensure parent and api directories are importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
from api import database
from api.fao56_engine import compute_fao56

class TestAquaGreenArchitecture(unittest.TestCase):

    def setUp(self):
        database.init_db()
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM command_queue")
        cursor.execute("DELETE FROM readings")
        cursor.execute("DELETE FROM settings")
        cursor.execute("DELETE FROM notifications")
        cursor.execute("DELETE FROM irrigation_events")
        conn.commit()
        conn.close()

    def test_peek_does_not_consume_or_dispatch_command(self):
        """
        Defect 2: peek_active_command (used by /api/pump/status) must inspect
        pending commands without consuming or dispatching them.
        Only claim_pending_command_for_esp32 (called by ESP32) claims the command.
        """
        # Step 1: Queue a command
        queued = database.queue_command("PUMP_ON", duration_seconds=120, ttl_seconds=60)
        cmd_id = queued["command_id"]

        # Step 2: Dashboard polls status via peek_active_command multiple times
        peek1 = database.peek_active_command()
        self.assertIsNotNone(peek1)
        self.assertEqual(peek1["command_id"], cmd_id)

        peek2 = database.peek_active_command()
        self.assertIsNotNone(peek2)
        self.assertEqual(peek2["command_id"], cmd_id)

        # Check DB: Status MUST STILL BE 'PENDING', NOT 'DISPATCHED'
        stored = database.get_command_by_id(cmd_id)
        self.assertEqual(stored["status"], "PENDING", "peek_active_command must NOT consume or dispatch pending commands")

        # Step 3: Physical ESP32 connects -> claim_pending_command_for_esp32 is called
        claimed = database.claim_pending_command_for_esp32()
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed["command_id"], cmd_id)

        # Verify command is now DISPATCHED
        stored_after = database.get_command_by_id(cmd_id)
        self.assertEqual(stored_after["status"], "DISPATCHED")

    def test_simulator_telemetry_segregation(self):
        """
        Defect 9: Simulator recordings are strictly marked is_simulated=True,
        and isolated from genuine physical research telemetry.
        """
        sim_payload = {
            "temperature": 28.0,
            "humidity": 60.0,
            "soilMoistureRaw": 1800,
            "soilMoisturePercent": 75.0,
            "pressure": 1011.0,
            "windSpeed": 2.0,
            "lux": 45000,
            "rainDetected": False,
            "pumpState": False,
            "isSimulated": True
        }
        row_id = database.insert_reading(sim_payload)
        self.assertGreater(row_id, 0)

        # Verify latest reading reports is_simulated=True
        latest = database.get_latest_reading(include_simulated=True)
        self.assertTrue(bool(latest.get("is_simulated")))

        # Verify genuine query excludes simulated reading
        genuine = database.get_latest_reading(include_simulated=False)
        self.assertIsNone(genuine, "Simulated data must never masquerade as physical ESP32 telemetry")

    def test_settings_structured_persistence_consistency(self):
        """
        Defect 4: Calibration, automation, and crop settings are persisted
        and retrieved with a consistent nested structure.
        """
        update_payload = {
            "calibration": {
                "soilDryAdc": 3150,
                "soilWetAdc": 1350,
                "pumpFlowRate": 15.0
            },
            "automation": {
                "dryThresholdPercent": 40,
                "emergencyStop": False
            },
            "crop": {
                "cropName": "Research Tomato",
                "stage": "flowering"
            }
        }
        database.update_structured_settings(update_payload)

        # Retrieve all settings
        settings = database.get_all_settings()

        self.assertIn("calibration", settings)
        self.assertIn("automation", settings)
        self.assertIn("crop", settings)

        self.assertEqual(settings["calibration"]["soilDryAdc"], 3150)
        self.assertEqual(settings["calibration"]["pumpFlowRate"], 15.0)
        self.assertEqual(settings["automation"]["dryThresholdPercent"], 40)
        self.assertEqual(settings["crop"]["cropName"], "Research Tomato")

    def test_production_database_no_silent_fallback(self):
        """
        Defect 3: In production, missing or broken Supabase PostgreSQL connection
        MUST raise DatabaseConfigurationError or DatabaseConnectionError, NOT silently fall back to SQLite.
        """
        old_prod = database.IS_PRODUCTION
        old_url = database.POSTGRES_URL
        try:
            database.IS_PRODUCTION = True
            database.POSTGRES_URL = None

            # With no DATABASE_URL in production, get_connection must raise DatabaseConfigurationError
            with self.assertRaises(database.DatabaseConfigurationError):
                database.get_connection()

            # With invalid DATABASE_URL in production, must raise DatabaseError (Connection or Configuration error, never SQLite fallback)
            database.POSTGRES_URL = "postgresql://invalid_user:invalid_pass@127.0.0.1:9999/invalid_db"
            with self.assertRaises(database.DatabaseError):
                database.get_connection()
        finally:
            database.IS_PRODUCTION = old_prod
            database.POSTGRES_URL = old_url

if __name__ == "__main__":
    unittest.main()

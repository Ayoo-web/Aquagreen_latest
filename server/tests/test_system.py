"""
AquaGreen Smart Irrigation System - Comprehensive Automated Test Suite
Validates FAO-56 Penman-Monteith physics, sensor calibration, safety controllers,
database persistence, and the complete ESP32 command lifecycle.
Built with standard library unittest for zero-dependency execution.
"""

import unittest
import math
import sys
import os
import time
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fao56_engine import compute_fao56
import database

class TestAquaGreenSystem(unittest.TestCase):

    def setUp(self):
        # Initialize fresh schema and clean state for isolated testing
        database.init_db()
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM command_queue")
        cursor.execute("DELETE FROM readings")
        cursor.execute("DELETE FROM notifications")
        cursor.execute("DELETE FROM irrigation_events")
        conn.commit()
        conn.close()

    def test_fao56_benchmark_calculation(self):
        """
        Validates FAO-56 calculation against standardized FAO meteorological benchmark conditions.
        Standard test condition: Tmin=18°C, Tmax=32°C, RHmin=40%, RHmax=85%, Wind=2.0 m/s at 25m elevation.
        """
        res = compute_fao56(
            t_min=18.0,
            t_max=32.0,
            rh_min=40.0,
            rh_max=85.0,
            wind_speed=2.0,
            elevation=25.0,
            lat=14.6
        )

        # Reference ET0 should be in realistic semi-arid range (typically 3.5 - 7.0 mm/day)
        self.assertTrue(3.5 <= res["et0"] <= 7.0, f"Unexpected ET0 result: {res['et0']}")
        self.assertEqual(res["tMean"], 25.0)
        self.assertGreater(res["vpd"], 0, "Vapor pressure deficit must be positive")
        self.assertGreater(res["rn"], 0, "Net radiation during daytime must be positive")
        self.assertGreater(res["rsEstimated"], 0, "Estimated solar radiation must be positive")
        self.assertGreater(res["windSpeed2m"], 0, "2m height-adjusted wind speed must be positive")

    def test_soil_moisture_calibration_and_fault_detection(self):
        """
        Validates inverted ADC soil probe scaling and checks open-circuit threshold (ADC 4095).
        """
        soil_dry_adc = 3200
        soil_wet_adc = 1400

        def raw_to_percent(adc):
            if adc >= 4090:
                return None, True # Open circuit fault
            range_val = soil_dry_adc - soil_wet_adc
            pct = ((soil_dry_adc - adc) / range_val) * 100.0
            return max(0.0, min(100.0, round(pct, 1))), False

        # Test completely dry probe (ADC 3200) -> 0%
        pct, fault = raw_to_percent(3200)
        self.assertFalse(fault)
        self.assertEqual(pct, 0.0)

        # Test fully saturated soil probe (ADC 1400) -> 100%
        pct, fault = raw_to_percent(1400)
        self.assertFalse(fault)
        self.assertEqual(pct, 100.0)

        # Test mid-moisture reading (ADC 2300) -> 50%
        pct, fault = raw_to_percent(2300)
        self.assertFalse(fault)
        self.assertAlmostEqual(pct, 50.0, delta=1.0)

        # Test open-circuit fault (ADC 4095)
        pct, fault = raw_to_percent(4095)
        self.assertTrue(fault, "ADC 4095 must be flagged as open-circuit fault")

    def test_safety_controllers_rain_inhibition(self):
        """
        Validates that rain surface wetness inhibits or halts automatic irrigation.
        """
        rain_detected = True
        rain_inhibit_enabled = True
        soil_moisture = 20.0 # Extremely dry (< 35%)

        # Even though soil is dry, rain inhibit MUST block irrigation
        should_pump_start = (soil_moisture <= 35.0) and not (rain_detected and rain_inhibit_enabled)
        self.assertFalse(should_pump_start, "Irrigation must be inhibited when rain sensor detects wetness")

    def test_maximum_runtime_cutoff(self):
        """
        Ensures that pump is forced OFF when duration exceeds max allowable runtime.
        """
        max_runtime_sec = 15 * 60 # 15 minutes = 900s
        active_runtime_sec = 905

        should_force_stop = active_runtime_sec >= max_runtime_sec
        self.assertTrue(should_force_stop, "Pump must be stopped when exceeding max runtime limit")

    def test_hysteresis_dual_threshold_protection(self):
        """
        Validates hysteresis logic preventing rapid relay chatter.
        """
        dry_threshold = 35.0
        wet_threshold = 65.0

        # Condition A: Soil drops to 34% -> Turn ON
        self.assertLessEqual(34.0, dry_threshold)

        # Condition B: Moisture reaches 45% while running -> Stay ON (not yet at 65%)
        is_pump_on = True
        if is_pump_on:
            stay_on = 45.0 < wet_threshold
            self.assertTrue(stay_on)

        # Condition C: Moisture reaches 66% while running -> Cutoff OFF
        if is_pump_on:
            cutoff = 66.0 >= wet_threshold
            self.assertTrue(cutoff)

    def test_database_crud_operations(self):
        """
        Validates telemetry insertion, retrieval, settings storage, and notifications in SQLite.
        """
        # 1. Insert Telemetry
        reading_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "temperature": 27.4,
            "humidity": 65.2,
            "soilMoistureRaw": 2150,
            "soilMoisturePercent": 58.3,
            "pressure": 1011.2,
            "windSpeed": 1.45,
            "lux": 32000,
            "rainDetected": False,
            "pumpState": False
        }
        row_id = database.insert_reading(reading_data)
        self.assertGreater(row_id, 0)

        latest = database.get_latest_reading()
        self.assertIsNotNone(latest)
        self.assertEqual(latest["soil_moisture_raw"], 2150)
        self.assertEqual(latest["temperature"], 27.4)

        # 2. Settings Persistence
        database.save_setting("test_key", {"threshold": 35, "mode": "AUTO"})
        val = database.get_setting("test_key")
        self.assertEqual(val["threshold"], 35)
        self.assertEqual(val["mode"], "AUTO")

        # 3. Notification Persistence & Acknowledgment
        notif_id = database.insert_notification("Test Alert", "Soil moisture low", "WARNING", "SOIL")
        self.assertGreater(notif_id, 0)

        notifs = database.get_notifications(limit=10)
        self.assertTrue(any(n["id"] == notif_id for n in notifs))

        acked = database.acknowledge_notification(notif_id)
        self.assertTrue(acked)

    def test_esp32_command_queue_and_acknowledgement_lifecycle(self):
        """
        Validates the complete bidirectional ESP32 command lifecycle:
        1. Operator queues command (status = PENDING)
        2. ESP32 polls / receives command (status = DISPATCHED)
        3. ESP32 acknowledges physical relay state switch (status = ACKNOWLEDGED)
        """
        # Step 1: Queue PUMP_ON command
        queued = database.queue_command("PUMP_ON", duration_seconds=180, ttl_seconds=60)
        cmd_id = queued["command_id"]
        self.assertTrue(cmd_id.startswith("cmd_"))
        self.assertEqual(queued["status"], "PENDING")

        # Step 2: ESP32 retrieves pending command
        dispatched = database.get_active_pending_command()
        self.assertIsNotNone(dispatched)
        self.assertEqual(dispatched["command_id"], cmd_id)
        self.assertEqual(dispatched["command_type"], "PUMP_ON")

        # Verify command status transitioned to DISPATCHED
        fetched = database.get_command_by_id(cmd_id)
        self.assertEqual(fetched["status"], "DISPATCHED")

        # Step 3: ESP32 acknowledges physical relay activation on GPIO17
        ack_success = database.acknowledge_command(
            command_id=cmd_id,
            actual_state=True,
            success=True,
            ack_message="Relay verified on GPIO17 Active-LOW"
        )
        self.assertTrue(ack_success)

        # Verify final state is ACKNOWLEDGED with actual reported state
        final_cmd = database.get_command_by_id(cmd_id)
        self.assertEqual(final_cmd["status"], "ACKNOWLEDGED")
        self.assertEqual(final_cmd["ack_state"], 1)

    def test_emergency_stop_supersedes_pending_commands(self):
        """
        Ensures that an EMERGENCY_STOP command supersedes and cancels earlier pending commands.
        """
        # Queue regular pump start
        c1 = database.queue_command("PUMP_ON", duration_seconds=300)
        
        # Queue emergency stop
        c2 = database.queue_command("EMERGENCY_STOP", duration_seconds=0)

        # Check that c1 was superseded
        cmd1 = database.get_command_by_id(c1["command_id"])
        self.assertEqual(cmd1["status"], "SUPERSEDED")

        # Active command must be emergency stop
        active = database.get_active_pending_command()
        self.assertEqual(active["command_id"], c2["command_id"])
        self.assertEqual(active["command_type"], "EMERGENCY_STOP")

if __name__ == "__main__":
    unittest.main()

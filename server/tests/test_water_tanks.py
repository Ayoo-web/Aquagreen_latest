"""Tests for dual HC-SR04 tank telemetry and threshold-crossing alerts."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
# The older test suite imports server/database.py as top-level `database`.
# Remove that alias so api.index resolves api/database.py for endpoint tests.
sys.modules.pop("database", None)
from api import index


class TestWaterTankMonitoring(unittest.TestCase):
    def setUp(self):
        self.db = index.database
        self.db.init_db()
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM readings")
        cursor.execute("DELETE FROM notifications")
        cursor.execute("DELETE FROM settings")
        conn.commit()
        conn.close()

    @staticmethod
    def payload(supply_pct, collection_pct, timestamp=None):
        data = dict(
            temperature=29.5,
            humidity=72.0,
            soilMoistureRaw=2200,
            soilMoisturePercent=45.0,
            pressure=1007.0,
            windSpeed=1.2,
            lux=12000.0,
            rainDetected=False,
            pumpState=False,
            isSoilFault=False,
            supplyTankDistanceCm=95.0,
            supplyTankPercent=supply_pct,
            supplyTankSensorOk=True,
            collectionTankDistanceCm=8.0,
            collectionTankPercent=collection_pct,
            collectionTankSensorOk=True,
        )
        if timestamp:
            data["timestamp"] = timestamp
        return index.PhysicalTelemetryPayload(**data)

    def test_low_and_high_levels_create_dashboard_notifications_once(self):
        index.receive_telemetry(self.payload(18.0, 94.0), _auth=True)
        tank_alerts = [n for n in self.db.get_notifications(20) if n["category"] == "WATER_TANK"]
        self.assertEqual({n["title"] for n in tank_alerts}, {
            "Water Supply Tank Low",
            "Water Collection Tank Almost Full",
        })

        reading = self.db.get_latest_reading(include_simulated=False)
        self.assertAlmostEqual(float(reading["supply_tank_percent"]), 18.0)
        self.assertAlmostEqual(float(reading["collection_tank_percent"]), 94.0)

        # Remaining on the warning side of the threshold does not spam alerts.
        index.receive_telemetry(self.payload(17.0, 95.0), _auth=True)
        tank_alerts = [n for n in self.db.get_notifications(20) if n["category"] == "WATER_TANK"]
        self.assertEqual(len(tank_alerts), 2)

    def test_missing_percentages_do_not_create_tank_notifications(self):
        index.receive_telemetry(self.payload(None, None), _auth=True)
        tank_alerts = [n for n in self.db.get_notifications(20) if n["category"] == "WATER_TANK"]
        self.assertEqual(tank_alerts, [])

    def test_water_tank_thresholds_persist(self):
        updated = self.db.update_structured_settings({
            "waterTanks": {
                "supplyLowThresholdPercent": 15,
                "collectionHighThresholdPercent": 95,
                "alertHysteresisPercent": 4,
            }
        })
        self.assertEqual(updated["waterTanks"]["supplyLowThresholdPercent"], 15)
        reloaded = self.db.get_all_settings()
        self.assertEqual(reloaded["waterTanks"]["collectionHighThresholdPercent"], 95)


if __name__ == "__main__":
    unittest.main()

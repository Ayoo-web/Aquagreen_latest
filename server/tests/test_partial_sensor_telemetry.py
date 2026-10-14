import unittest
from datetime import datetime, timezone

from api import database
from api.index import PhysicalTelemetryPayload


class TestPartialSensorTelemetry(unittest.TestCase):
    def test_wind_soil_percent_and_rain_can_be_unavailable(self):
        payload = PhysicalTelemetryPayload(
            temperature=33.7, humidity=60.1, soilMoistureRaw=4095,
            soilMoisturePercent=None, pressure=1006.62, windSpeed=None,
            lux=14.2, rainDetected=None, pumpState=False, isSoilFault=True,
            soilSensorOk=False, rainSensorOk=False, windSensorOk=False,
            windRaw=0, windVoltageV=0.0,
            collectionTankDistanceCm=20.6, collectionTankPercent=49.4, collectionTankSensorOk=True
        )
        self.assertIsNone(payload.windSpeed)
        self.assertIsNone(payload.rainDetected)
        self.assertIsNone(payload.soilMoisturePercent)

        database.init_db()
        row_id = database.insert_reading({
            **payload.model_dump(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "isSimulated": False
        })
        self.assertGreater(row_id, 0)
        row = database.get_latest_reading(include_simulated=False)
        self.assertIsNotNone(row)
        self.assertIsNone(row["wind_speed"])
        self.assertIsNone(row["soil_moisture_percent"])
        self.assertIsNone(row["rain_detected"])
        self.assertAlmostEqual(float(row["collection_tank_percent"]), 49.4, places=1)


if __name__ == "__main__":
    unittest.main()

# AquaGreen Dual Water-Tank Monitoring — Setup Guide

This update adds percentage-based monitoring for the **water supply tank** and **water collection tank**, persistent cloud readings, threshold notifications, and two percentage bars on the dashboard Overview tab.

## 1. Wiring

| Sensor / device | ESP32 GPIO | Purpose |
|---|---:|---|
| Supply tank HC-SR04 TRIG | GPIO 5 | Trigger pulse |
| Supply tank HC-SR04 ECHO | GPIO 18 | Echo distance input |
| Collection tank HC-SR04 TRIG | GPIO 13 | Trigger pulse |
| Collection tank HC-SR04 ECHO | GPIO 14 | Echo distance input |
| Analog wind sensor output | GPIO 32 | Wind voltage input; no longer shares GPIO32 with an HC-SR04 |
| Pump relay | GPIO 17 | Active-LOW output |
| DHT22 | GPIO 4 | Temperature and humidity |
| Rain sensor analog | GPIO 34 | Wet/dry detector |
| Soil sensor analog | GPIO 35 | Raw soil ADC |
| BMP280 + BH1750 SDA / SCL | GPIO 21 / GPIO 22 | Shared I²C bus |
| DS1302 RST / DAT / CLK | GPIO 27 / GPIO 26 / GPIO 25 | RTC (verify against the actual wiring) |

**Electrical safety:** HC-SR04 ECHO can output approximately 5 V, while the ESP32 GPIO is not 5 V tolerant. Use a resistor divider or logic-level shifter on **each** ECHO wire, and measure/verify that the ESP32 input sees no more than 3.3 V. A divider example is a 1 kΩ resistor from ECHO to the GPIO node and 1.8 kΩ from that node to GND (about 3.2 V from a 5 V ECHO); share common GND. Do not use an unverified resistor combination. If you only have 1 kΩ and 2.2 kΩ resistors, don't assume every arrangement is safe—use a suitable level shifter or obtain the correct resistor value and verify it with a meter.

Mount each sensor securely at the top of its own tank, pointed vertically toward the water. Keep the two sensors separated and sample one after the other to reduce ultrasonic cross-talk. Avoid positioning the sensor where it can directly hit tank walls, pipes, or internal bracing.

## 2. How percentage is calculated

For each tank, the sensor measures the distance from its face down to the water surface. The firmware calculates a normalized fill-height percentage:

`fillPercent = ((emptyDistanceCm - currentDistanceCm) / (emptyDistanceCm - safeFullDistanceCm)) × 100`

The result is clamped to 0–100%. This represents the calibrated fill height between your selected EMPTY and SAFE FULL levels. If the tank has a non-uniform cross-section, this is **not necessarily the percentage of total water volume**; volume percentage would require a tank-specific geometry/level calibration.

### Measure and enter both endpoints

1. With the supply tank at the chosen empty reference level, measure sensor-face-to-water distance and enter **Supply tank distance when EMPTY (cm)** in the ESP32 Wi-Fi setup portal.
2. Fill the supply tank to its chosen safe-full level (below the sensor's blind zone/overflow) and measure again. Enter **Supply tank distance at safe FULL (cm)**.
3. Repeat these measurements for **Collection tank distance when EMPTY (cm)** and **Collection tank distance at safe FULL (cm)**.
4. For each tank, the EMPTY distance must be **greater than** the SAFE FULL distance. Use centimeters, measure from the mounted sensor face, and don't guess values.
5. Reopen the portal using the firmware's `CONFIG` serial command if you need to change these calibration values later. The updated firmware saves them in ESP32 Preferences.

If calibration is missing, the dashboard displays `CALIBRATION NEEDED` instead of inventing a percentage. If there is no valid echo, the dashboard displays `SENSOR ERROR`. Check sensor power, GND, TRIG/ECHO wiring, the ECHO divider, and reflections.

## 3. Default alert thresholds

| Tank | Default threshold | Dashboard action |
|---|---:|---|
| Water supply | **20% or lower** | Adds a “Water Supply Tank Low” warning/critical alert |
| Water collection | **90% or higher** | Adds a “Water Collection Tank Almost Full” warning/critical alert |

The dashboard Settings tab lets you change these thresholds. A 5-percentage-point hysteresis prevents repeated notifications while the water level stays on the same side of the threshold. When the supply tank is extremely low, the alert severity becomes critical. The ESP32 also has a separate **5% local supply-tank cutoff** to help protect the pump from running dry; this is independent of the configurable dashboard warning threshold.

Alerts are saved to the application's existing notification feed, visible from the dashboard notification area and History → Alerts. This is an in-dashboard notification implementation: SMS, email, and operating-system push notifications are not configured.

## 4. Supabase migration — do this before deployment

The new backend writes six columns to `readings`. On an existing Supabase project, run this file in **Supabase → SQL Editor** before deploying the updated code:

`database/migration_add_water_tank_columns.sql`

It is safe to run more than once. It adds the two distances, two percentages, and two sensor-validity fields, and inserts default `waterTanks` settings if none exist. Do not deploy the API first; otherwise telemetry inserts can fail because the production table is missing the new columns.

`database/schema.sql` was also updated for new database installations.

## 5. Deploy the dashboard/API update

1. Apply the SQL migration in Supabase first.
2. Replace the files in your connected AquaGreen GitHub repository with the files from the updated project bundle and push to the branch connected to Vercel. Vercel should rebuild the dashboard and Python API.
3. Open the deployed dashboard and visit **Settings → Water Tank Notification Thresholds**. Confirm the defaults or set your chosen warning percentages.
4. Flash `AquaGreen_ESP32_Firmware_Water_Tanks.ino` after confirming the pin map above and all ECHO dividers. Enter your HTTPS Vercel origin and the existing `AQUAGREEN_DEVICE_TOKEN` in the ESP32 setup portal; never put a dashboard key or device token in public source code.
5. Enter all four tank distance endpoints in the portal and save.
6. Open Serial Monitor at 115200 baud and run `STATUS`. Look for valid echo/calibration states for both tanks. The telemetry values are sent as `supplyTankPercent` and `collectionTankPercent` with corresponding sensor-validity fields.
7. Check the dashboard Overview tab. Both tanks should show percentages, progress bars, distance readings, and status labels. Test the warning thresholds using safe, controlled level changes; do not overfill the collection tank to test an alert.

## 6. Validation and limitations

- Backend notifications are created from **physical ESP32 telemetry** when a valid percentage crosses a configured threshold. Missing percentage readings do not create tank warnings.
- The dashboard simulator can preview the two percentages visually, but simulated values are kept segregated from physical research data and don't create physical tank alerts.
- Tank monitoring requires calibrated distances. A missing echo or missing calibration never gets converted to a fake 0% or 100%.
- After deployment, confirm `/api/health` remains online and check History → Alerts for a threshold-crossing notification.
- The current container did not have the project's npm dependencies installed, and installation timed out, so a full Vite production build could not be run here. Python syntax checks and the 15 backend tests passed. The tank-enabled sketch still needs compilation against the ESP32 Arduino core and its installed libraries in Arduino IDE before connecting the pump's power supply.

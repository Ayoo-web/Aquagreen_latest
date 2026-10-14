# AquaGreen Smart Irrigation Monitoring and Automation System

AquaGreen is an empirical, research-grade smart irrigation automation system designed for agricultural research studies. It implements the standardized **FAO-56 Penman–Monteith reference evapotranspiration equation**, interfaces directly with physical ESP32 multi-sensor telemetry, and guarantees non-blocking autonomous relay safety during network interruptions.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│               ESP32 EMBEDDED CONTROLLER                │
│  - DHT22 (GPIO4): Air Temp & Relative Humidity         │
│  - BMP280 (I2C 21/22): Barometric Pressure & Temp      │
│  - GY-302 / BH1750 (I2C 21/22): Illuminance (lux)      │
│  - Analog wind sensor (GPIO32): Wind voltage           │
│  - HC-SR04 supply tank (TRIG 5 / ECHO 18): Fill %      │
│  - HC-SR04 collection tank (TRIG 13 / ECHO 14): Fill % │
│  - Rain Sensor (GPIO34): Conductive Surface Wetness    │
│  - Soil Probe (GPIO35): 12-bit ADC (0 - 4095)          │
│  - DS1302 RTC (GPIO 25, 26, 27): Chronometer           │
│  - Water Pump Relay (GPIO17): Active-LOW Polarity      │
│  - WiFiManager: Captive Portal (No-reflash Wi-Fi/URL)  │
│  - ISRG Root X1 CA: Cryptographic HTTPS Validation     │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS JSON Telemetry & Commands (Port 443)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   AQUAGREEN BACKEND                    │
│  - FastAPI Serverless API on Vercel (`api/index.py`)   │
│  - Production Supabase PostgreSQL (`schema.sql`)       │
│  - Mandatory Device Token & Dashboard Authentication   │
│  - Non-Consuming Command Peeking & Reliable Claims     │
│  - Diurnal FAO-56 Data Sufficiency Engine              │
│  - Segregated Simulator Endpoint                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│               AQUAGREEN WEB DASHBOARD                  │
│  - Real-time Sensor Metric HUD & Multi-series Charts   │
│  - Real vs Simulated Measurement Distinction           │
│  - Interactive FAO-56 Equation Mathematical Inspector  │
│  - Crop Water Demand (ETc) & Pump Runtime Calculator   │
│  - Autonomous Dual-Threshold Hysteresis State Machine  │
│  - Dual Water Tank Percentage Gauges + Threshold Alerts│
│  - Statistical Soil Moisture Trajectory Forecasting    │
│  - 2-Point ADC Soil Calibration & Emergency Stop       │
│  - Integrated Hardware Testbed & Fault Injector        │
└────────────────────────────────────────────────────────┘
```

---

## 2. Hardware Wiring & Pin Mapping

| Peripheral / Sensor | Interface | ESP32 Pin | Logic & Electrical Notes |
| :--- | :--- | :--- | :--- |
| **Water Pump Relay** | Digital Output | **GPIO 17** | **Active-LOW Polarity**: `LOW (0V)` energizes the coil (Pump ON); `HIGH (3.3V)` de-energizes the coil (Safe OFF). Boot sequence forces GPIO17 HIGH before output activation. |
| **DHT22** | Single-bus Digital | **GPIO 4** | 4.7kΩ pull-up resistor to 3.3V recommended. |
| **BMP280** | I2C Data (SDA) | **GPIO 21** | 3.3V VCC. I2C address 0x76 or 0x77. |
| **BMP280** | I2C Clock (SCL) | **GPIO 22** | 3.3V VCC. |
| **GY-302 / BH1750** | I2C Data (SDA) | **GPIO 21** | Shared I2C bus. Measures **lux**, NOT solar radiation. |
| **GY-302 / BH1750** | I2C Clock (SCL) | **GPIO 22** | Shared I2C bus. |
| **Wind sensor** | Analog voltage | **GPIO 32** | This sketch requires an analog-output sensor and verified zero-wind voltage/slope. |
| **Supply tank HC-SR04** | TRIG / ECHO | **GPIO 5 / GPIO 18** | Percentage from measured empty and safe-full distances. Use a voltage divider on ECHO. |
| **Collection tank HC-SR04** | TRIG / ECHO | **GPIO 13 / GPIO 14** | Percentage from measured empty and safe-full distances. Use a voltage divider on ECHO. |
| **Rain Sensor** | Analog ADC | **GPIO 34** | Measures surface conductivity. Detects wetness; does not measure mm depth. |
| **Soil Moisture** | Analog ADC | **GPIO 35** | 12-bit ADC (0 - 4095). High ADC (~3200) = Dry; Low ADC (~1400) = Saturated. **ADC = 4095 indicates open-circuit probe fault.** |
| **DS1302 RTC** | 3-Wire Serial | **GPIO 25, 26, 27** | CLK=25, DAT=26, RST=27. Battery-backed hardware chronometer. |

---

## 3. Scientific Methodology: FAO-56 Penman–Monteith

The reference evapotranspiration ($ET_0$) is computed strictly in accordance with **FAO Irrigation and Drainage Paper No. 56**:

$$ET_0 = \frac{0.408 \Delta (R_n - G) + \gamma \left(\frac{900}{T + 273}\right) u_2 (e_s - e_a)}{\Delta + \gamma (1 + 0.34 u_2)}$$

### Data Sufficiency Rules (Defect 5 Fix):
- **Diurnal Temporal Coverage**: Full-day $ET_0$ calculation requires physical telemetry spanning at least **4.0 hours** with at least **12 distinct samples** across the day to capture realistic diurnal extremes ($T_{\min}$ and $T_{\max}$).
- **No Synthetic Fabrication**: When daily coverage is incomplete, the system marks the calculation as `INSUFFICIENT_DIURNAL_COVERAGE` with clear scientific disclosure, rather than silently fabricating weather inputs.
- **Physical vs Simulated Separation**: Genuine research computations filter `is_simulated = FALSE` so simulated data never contaminates empirical research calculations.

### Supporting Physical Equations:
1. **Saturation Vapor Pressure $e^\circ(T)$ (kPa)**:
   $$e^\circ(T) = 0.6108 \exp\left(\frac{17.27 T}{T + 237.3}\right)$$
   $$e_s = \frac{e^\circ(T_{\max}) + e^\circ(T_{\min})}{2}$$
2. **Actual Vapor Pressure $e_a$ (kPa)**:
   $$e_a = \frac{e^\circ(T_{\min}) \frac{RH_{\max}}{100} + e^\circ(T_{\max}) \frac{RH_{\min}}{100}}{2}$$
3. **Slope of Vapor Pressure Curve $\Delta$ (kPa/°C)**:
   $$\Delta = \frac{4098 \left[0.6108 \exp\left(\frac{17.27 T}{T + 237.3}\right)\right]}{(T + 237.3)^2}$$
4. **Atmospheric Pressure $P$ & Psychrometric Constant $\gamma$ (kPa/°C)**:
   $$P = 101.3 \left(\frac{293 - 0.0065 z}{293}\right)^{5.26}, \quad \gamma = 0.000665 P$$
5. **Wind Speed 2-Meter Height Adjustment ($u_2$)**:
   $$u_2 = u_z \frac{4.87}{\ln(67.8 z_w - 5.42)}$$
6. **Solar Radiation Limitation ($R_s$)**:
   Because the GY-302 sensor measures photometric illuminance in **lux** rather than radiometric energy ($W/m^2$), and external cloud APIs are prohibited, AquaGreen utilizes the **FAO Hargreaves temperature-difference method**:
   $$R_s = k_{Rs} \sqrt{T_{\max} - T_{\min}} R_a$$
   where extraterrestrial radiation $R_a$ is computed from site latitude $\varphi$ and day of the year $J$, and $k_{Rs} = 0.16$ (interior location) or $0.19$ (coastal location).

---

## 4. Public Vercel & Supabase Cloud Deployment Guide

### Step 1: Create Free Supabase Database
1. Go to [supabase.com](https://supabase.com) and create a project.
2. In the Supabase project dashboard, navigate to **SQL Editor**.
3. Copy the contents of `database/schema.sql` and run it. This establishes:
   - `readings` table with unique `(timestamp, is_simulated)` constraint.
   - `command_queue` table with status checking, expiry, and dispatch counters.
   - Hardened Row-Level Security (RLS) restricting all write actions and command queue visibility to `service_role`.
   - Seeded default settings for `calibration`, `automation`, `crop`, and `waterTanks`.
   - Supply and collection tank percentage history; run `database/migration_add_water_tank_columns.sql` (run this in Supabase SQL Editor before deployment). against an existing Supabase project before deploying the tank-monitoring update.
4. Navigate to **Project Settings -> Database -> Connection String**.
5. Copy the connection URI:
   ```
   postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   ```

### Step 2: (Optional) Migrate Existing SQLite Data to Supabase
If you have historical measurements in `server/data/agriculture.db`:
```bash
python database/migrate_sqlite_to_supabase.py --postgres-url "YOUR_SUPABASE_DATABASE_URL"
```

### Step 3: Deploy to Vercel
1. Link your repository in Vercel.
2. In Project Settings -> Environment Variables, configure:
   - `DATABASE_URL`: Your Supabase connection string.
   - `AQUAGREEN_DEVICE_TOKEN`: A strong, randomly generated device token for the physical ESP32. Keep it private and use the same value in the Wi-Fi setup portal.
   - `DASHBOARD_API_KEY`: Secret key required for remote pump operations.
3. Deploy! Vercel automatically compiles Vite frontend to `dist/` and runs FastAPI on `/api/*`.

### Step 4: Flash ESP32 Firmware & WiFiManager
1. Open `firmware/sensor_ayaw_hilabti_updated.ino` in Arduino IDE (this is the tank-enabled firmware in this bundle).
2. Install required Arduino libraries:
   - `WiFiManager` by tzapu
   - `ArduinoJson` (v6 or v7)
   - `DHT sensor library` by Adafruit
   - `Adafruit BMP280 Library`
   - `BH1750` by Christopher Laws
   - `RtcDS1302` by Makuna
3. Upload to the ESP32.
4. On first boot, the ESP32 prints a uniquely suffixed **`AquaGreen-...`** setup access-point name and password in Serial Monitor:
   - Connect your phone or laptop to the exact SSID/password printed in Serial Monitor.
   - The captive portal opens at `192.168.4.1`.
   - Select your Wi-Fi network, enter password, your public Vercel HTTPS API URL, and your device token.
   - Click Save. The ESP32 connects and saves credentials in Non-Volatile Storage (Preferences).
   - If you ever change Wi-Fi networks, you do **NOT** need to reflash!

---

## 5. REST API Reference

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | System health check and database status. | Public |
| `POST` | `/api/telemetry` | Physical ESP32 sensor telemetry ingest & command claim. | `X-Device-Token` |
| `POST` | `/api/simulator/telemetry` | Simulator telemetry injection (`is_simulated = TRUE`). | Dashboard Key |
| `GET` | `/api/telemetry/latest` | Most recent reading with source label & staleness indicator. | Public |
| `GET` | `/api/telemetry/history` | Historical sensor time-series records. | Public |
| `POST` | `/api/pump/control` | Queue remote command (`PUMP_ON`, `PUMP_OFF`, `EMERGENCY_STOP`). | Dashboard Key |
| `GET` | `/api/pump/status` | Current pump relay state & active command (Non-consuming peek). | Public |
| `POST` | `/api/pump/acknowledge` | ESP32 relay confirmation on GPIO17. | `X-Device-Token` |
| `GET` | `/api/fao56/calculate` | FAO-56 Penman-Monteith calculation with diurnal sufficiency checks. | Public |
| `POST` | `/api/crop/demand` | Crop water demand ($ET_c$) and pump runtime calculations. | Public |
| `GET` | `/api/predictions` | Linear drying trajectory & time-to-threshold forecasting. | Public |
| `GET` | `/api/settings` | Retrieve system settings (`calibration`, `automation`, `crop`). | Public |
| `POST` | `/api/settings` | Update system settings with consistent structured schema. | Dashboard Key |
| `GET` | `/api/notifications` | Retrieve system safety notifications and audit alerts. | Public |
| `POST` | `/api/notifications/:id/acknowledge` | Acknowledge active notification. | Public |
| `GET` | `/api/export/csv` | Download complete research dataset as CSV. | Public |

---

## 6. Running Automated Tests

Run the comprehensive unit and integration test suite:
```bash
python3 -m unittest discover -s server/tests
```
All 15 tests validate the FAO-56 math, sensor calibration, safety controllers, command lifecycle, and Supabase production error handling.


## Water tank monitoring

AquaGreen supports two HC-SR04 sensors. The **supply tank** warns when its calibrated fill level falls to/below the configured low threshold (default 20%); local firmware dry-run protection uses a separate 5% cutoff. The **collection tank** warns when its calibrated fill level reaches/exceeds the near-full threshold (default 90%). Dashboard warning thresholds are adjustable under Settings.

Each tank percentage is calculated from two measured distances: `((emptyDistanceCm - currentDistanceCm) / (emptyDistanceCm - safeFullDistanceCm)) * 100`, clamped to 0–100%. Measure the distance from the mounted sensor face to the water surface when that tank is empty, then again at its chosen safe-full level. If calibration is missing or an ultrasonic echo is invalid, the dashboard shows the tank level as unavailable rather than guessing. These sensors measure distance, which is converted to a normalized fill percentage; a geometrically irregular tank may need a calibrated level-to-volume curve for true volume percent.

HC-SR04 ECHO pins can output 5 V. **Do not connect ECHO directly to ESP32 GPIO**; use a divider or level shifter so the GPIO sees no more than 3.3 V. The current sketch pin map is supply TRIG/ECHO GPIO5/18 and collection TRIG/ECHO GPIO13/14. Keep the analog wind output on GPIO32.

Warnings are persisted in the dashboard notification feed when physical telemetry crosses a configured threshold. Hysteresis reduces duplicate alerts while readings remain near the threshold. These are in-dashboard notifications; no SMS/email/push provider has been configured.

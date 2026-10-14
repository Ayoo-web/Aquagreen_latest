/**
 * AQUAGREEN SMART IRRIGATION SYSTEM - CORRECTED ESP32 FIRMWARE
 *
 * Compatible with the deployed AquaGreen FastAPI contract:
 *   POST /api/telemetry
 *   POST /api/pump/acknowledge
 *
 * Important safety / research rules:
 * - Relay GPIO17 is active-LOW and is driven OFF before other setup.
 * - HTTPS only; validates server certificates against trusted GTS Root R1 / ISRG Root X1 CAs.
 * - No fabricated fallback sensor readings are uploaded.
 * - Telemetry is withheld until cloud credentials and soil/rain/wind calibration are valid,
 *   and each required sensor reports a valid sample. This is intentional: the current API
 *   requires numeric sensor fields and otherwise cannot represent an unknown measurement.
 * - Remote commands are received only in successful telemetry responses.
 * - Pump start is blocked unless soil/rain readings and their calibrations are valid.
 * - Local pump runtime cap is 5 minutes; sensor faults/rain/target-moisture stop locally.
 * - If valid server responses stop arriving while the pump is on, it shuts off and locks out.
 * - Emergency-stop and runtime lockout survive reboot.
 * - This build does NOT autonomously START watering from the dashboard AUTO calculation. It executes
 *   authenticated queued commands and enforces local interlocks; the current dashboard/API still
 *   needs an automation-dispatch patch before AUTO mode can be treated as operational.
 *
 * PIN MAP (verify each wire physically before upload):
 *   DHT22 data         GPIO 4
 *   Soil analog        GPIO 35
 *   Rain analog        GPIO 34
 *   Analog wind output GPIO 32
 *   Water supply HC-SR04   TRIG GPIO 5,  ECHO GPIO 18
 *   Collection HC-SR04    TRIG GPIO 13, ECHO GPIO 14
 *   BMP280 + BH1750       SDA GPIO 21, SCL GPIO 22
 *   DS1302                RST GPIO 27, DAT GPIO 26, CLK GPIO 25
 *   Active-LOW relay      GPIO 17
 *   IMPORTANT: Each HC-SR04 ECHO output is 5V. Use a resistor voltage divider
 *   (e.g. 1k from ECHO to the GPIO node and 1.8k from that node to GND; verify <= 3.3V) per ECHO.
 *
 * Libraries needed in Arduino IDE Library Manager:
 *   WiFiManager by tzapu, ArduinoJson, DHT sensor library, Adafruit BMP280,
 *   BH1750, Makuna Rtc by Makuna
 *
 * Before enabling watering, measure dry/wet ADC endpoints and the wind sensor's real
 * zero-voltage + m/s-per-volt slope. Do not guess those values.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_BMP280.h>
#include <BH1750.h>
#include <ThreeWire.h>
#include <RtcDS1302.h>
#include <time.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

// --------------------------- GPIO assignments ---------------------------
static const uint8_t RELAY_PIN       = 17; // Active LOW: LOW=ON, HIGH=OFF
static const uint8_t DHT_PIN         = 4;
static const uint8_t SOIL_ADC_PIN    = 35;
static const uint8_t RAIN_ADC_PIN    = 34;
static const uint8_t WIND_ANALOG_PIN = 32; // Analog voltage output; not a pulse-count input
static const uint8_t SUPPLY_TANK_TRIG_PIN = 5;
static const uint8_t SUPPLY_TANK_ECHO_PIN = 18;
static const uint8_t COLLECTION_TANK_TRIG_PIN = 13;
static const uint8_t COLLECTION_TANK_ECHO_PIN = 14;
static const uint8_t RTC_RST_PIN     = 27;
static const uint8_t RTC_DAT_PIN     = 26;
static const uint8_t RTC_CLK_PIN     = 25;
static const uint8_t I2C_SDA_PIN     = 21;
static const uint8_t I2C_SCL_PIN     = 22;

// ----------------------------- Safety limits ----------------------------
static const unsigned long SENSOR_SAMPLE_INTERVAL_MS = 2200UL; // DHT22 needs ~2 s
static const unsigned long TELEMETRY_INTERVAL_MS     = 5000UL;
static const unsigned long LOG_INTERVAL_MS            = 10000UL;
static const unsigned long MAX_PUMP_RUNTIME_MS        = 5UL * 60UL * 1000UL;
static const unsigned long SERVER_HEARTBEAT_TIMEOUT_MS = 15000UL;
static const float SOIL_START_THRESHOLD_PERCENT       = 35.0f;
static const float SOIL_STOP_THRESHOLD_PERCENT        = 65.0f;
static const float MIN_VALID_PRESSURE_HPA             = 800.0f;
static const float MAX_VALID_PRESSURE_HPA             = 1100.0f;
static const float MIN_SUPPLY_TANK_PERCENT_TO_RUN     = 5.0f; // local dry-run prevention cutoff

// -------------------------- Trusted root CA -----------------------------
// Root bundle: GTS Root R1 covers the current standard *.vercel.app chain; ISRG Root X1
// covers Vercel-issued custom-domain certificates that chain to Let's Encrypt. Both are pinned
// by official root fingerprints and are parsed as a PEM CA bundle. Never use setInsecure(). If
// the exact hostname chains to another root, verify that chain and update this bundle accordingly.
static const char VERCEL_ROOT_CA[] PROGMEM = R"CERT(-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)CERT";

// ---------------------------- Runtime config ----------------------------
char apiBaseUrl[160] = ""; // Must be the Vercel origin, e.g. https://your-app.vercel.app
char deviceToken[96] = ""; // Must equal Vercel AQUAGREEN_DEVICE_TOKEN

int soilDryAdc = -1;
int soilWetAdc = -1;
int rainDryAdc = -1;
int rainWetAdc = -1;
float windZeroVoltageV = NAN;
float windSlopeMsPerV = NAN;
float supplyTankEmptyDistanceCm = NAN; // sensor-to-water distance when supply tank is EMPTY
float supplyTankFullDistanceCm = NAN;  // sensor-to-water distance at safe FULL level
float collectionTankEmptyDistanceCm = NAN;
float collectionTankFullDistanceCm = NAN;

Preferences preferences;
WiFiManager wifiManager;
WiFiManagerParameter* pApiUrl = nullptr;
WiFiManagerParameter* pDeviceToken = nullptr;
WiFiManagerParameter* pSoilDry = nullptr;
WiFiManagerParameter* pSoilWet = nullptr;
WiFiManagerParameter* pRainDry = nullptr;
WiFiManagerParameter* pRainWet = nullptr;
WiFiManagerParameter* pWindZero = nullptr;
WiFiManagerParameter* pWindSlope = nullptr;
WiFiManagerParameter* pSupplyTankEmpty = nullptr;
WiFiManagerParameter* pSupplyTankFull = nullptr;
WiFiManagerParameter* pCollectionTankEmpty = nullptr;
WiFiManagerParameter* pCollectionTankFull = nullptr;

bool shouldSaveConfig = false;
unsigned long lastNtpRetryMs = 0;
bool rtcUsable = false;
bool bmpReady = false;
bool lightMeterReady = false;
bool timeSynced = false;
bool pumpIsActive = false;
bool emergencyStopLatch = false;
bool runtimeLockout = false;
unsigned long pumpStartTime = 0;
unsigned long pumpRuntimeLimitMs = MAX_PUMP_RUNTIME_MS;
unsigned long lastServerSuccessMs = 0;
unsigned long lastSensorSampleMs = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastLogMs = 0;
unsigned long lastConfigWarningMs = 0;
unsigned long lastSensorWarningMs = 0;
unsigned long lastHealthCheckMs = 0;

DHT dht(DHT_PIN, DHT22);
Adafruit_BMP280 bmp;
BH1750 lightMeter;
ThreeWire rtcWire(RTC_DAT_PIN, RTC_CLK_PIN, RTC_RST_PIN);
RtcDS1302<ThreeWire> Rtc(rtcWire);

struct SensorSnapshot {
  float temperatureC = NAN;
  float humidityPct = NAN;
  float pressureHpa = NAN;
  float lux = NAN;
  float windVoltageV = NAN;
  float windSpeedMs = NAN;
  int soilRaw = -1;
  int rainRaw = -1;
  int windRaw = -1;
  float soilPercent = NAN;
  bool dhtValid = false;
  bool pressureValid = false;
  bool luxValid = false;
  bool soilValid = false;
  bool rainValid = false;
  bool windValid = false;
  bool rainDetected = false;
  float supplyTankDistanceCm = NAN;
  float supplyTankPercent = NAN;
  float collectionTankDistanceCm = NAN;
  float collectionTankPercent = NAN;
  bool supplyTankEchoValid = false;
  bool collectionTankEchoValid = false;
  bool supplyTankPercentValid = false;
  bool collectionTankPercentValid = false;
};

SensorSnapshot sensors;

// ----------------------------- Basic helpers ----------------------------
void saveConfigCallback() {
  shouldSaveConfig = true;
}

void persistSafetyState() {
  preferences.begin("aquagreen", false);
  preferences.putBool("estop", emergencyStopLatch);
  preferences.putBool("lockout", runtimeLockout);
  preferences.end();
}

bool finiteNumber(float v) {
  return !isnan(v) && !isinf(v);
}

String normalizeBaseUrl(const char* raw) {
  String url = raw ? String(raw) : String("");
  url.trim();
  while (url.endsWith("/")) url.remove(url.length() - 1);
  return url;
}

bool isHttpsUrlConfigured() {
  String url = normalizeBaseUrl(apiBaseUrl);
  return url.startsWith("https://") && url.length() > 12;
}

bool soilCalibrationValid() {
  return soilDryAdc > 10 && soilDryAdc < 4090 &&
         soilWetAdc > 10 && soilWetAdc < 4090 &&
         abs(soilDryAdc - soilWetAdc) >= 100;
}

bool rainCalibrationValid() {
  return rainDryAdc >= 0 && rainDryAdc <= 4095 &&
         rainWetAdc >= 0 && rainWetAdc <= 4095 &&
         abs(rainDryAdc - rainWetAdc) >= 50;
}

bool windCalibrationValid() {
  return finiteNumber(windZeroVoltageV) && windZeroVoltageV >= 0.0f && windZeroVoltageV <= 3.3f &&
         finiteNumber(windSlopeMsPerV) && windSlopeMsPerV > 0.0f && windSlopeMsPerV <= 1000.0f;
}

bool tankCalibrationValid(float emptyDistanceCm, float fullDistanceCm) {
  return finiteNumber(emptyDistanceCm) && finiteNumber(fullDistanceCm) &&
         emptyDistanceCm >= 5.0f && emptyDistanceCm <= 400.0f &&
         fullDistanceCm >= 2.0f && fullDistanceCm < emptyDistanceCm - 5.0f;
}

bool supplyTankCalibrationValid() {
  return tankCalibrationValid(supplyTankEmptyDistanceCm, supplyTankFullDistanceCm);
}

bool collectionTankCalibrationValid() {
  return tankCalibrationValid(collectionTankEmptyDistanceCm, collectionTankFullDistanceCm);
}

bool cloudConfigReady() {
  return isHttpsUrlConfigured() && strlen(deviceToken) >= 32 &&
         soilCalibrationValid() && rainCalibrationValid() && windCalibrationValid();
}

bool localPumpConfigReady() {
  return soilCalibrationValid() && rainCalibrationValid();
}

void printConfigurationStatus() {
  Serial.println("\n[CONFIG STATUS]");
  Serial.printf("  HTTPS API URL configured: %s\n", isHttpsUrlConfigured() ? "yes" : "NO");
  Serial.printf("  Device token configured: %s\n", strlen(deviceToken) >= 32 ? "yes" : "NO");
  Serial.printf("  Soil calibration: %s (dry=%d, wet=%d)\n",
                soilCalibrationValid() ? "valid" : "NOT VALID", soilDryAdc, soilWetAdc);
  Serial.printf("  Rain calibration: %s (dry=%d, wet=%d)\n",
                rainCalibrationValid() ? "valid" : "NOT VALID", rainDryAdc, rainWetAdc);
  Serial.printf("  Wind calibration: %s (zero=%.3f V, slope=%.3f m/s/V)\n",
                windCalibrationValid() ? "valid" : "NOT VALID", windZeroVoltageV, windSlopeMsPerV);
  Serial.printf("  Supply tank distance calibration: %s (empty=%.1f cm, full=%.1f cm)\n",
                supplyTankCalibrationValid() ? "valid" : "NOT SET", supplyTankEmptyDistanceCm, supplyTankFullDistanceCm);
  Serial.printf("  Collection tank distance calibration: %s (empty=%.1f cm, full=%.1f cm)\n",
                collectionTankCalibrationValid() ? "valid" : "NOT SET", collectionTankEmptyDistanceCm, collectionTankFullDistanceCm);
  Serial.printf("  Cloud telemetry ready: %s\n", cloudConfigReady() ? "yes" : "NO - upload intentionally inhibited");
}

int parseIntField(const char* text) {
  if (!text || !text[0]) return -1;
  char* end = nullptr;
  long v = strtol(text, &end, 10);
  if (end == text || *end != '\0' || v < 0 || v > 4095) return -1;
  return (int)v;
}

float parseFloatField(const char* text) {
  if (!text || !text[0]) return NAN;
  char* end = nullptr;
  float value = strtof(text, &end);
  if (end == text || *end != '\0' || !finiteNumber(value)) return NAN;
  return value;
}

void copyText(char* destination, size_t size, const char* source) {
  if (size == 0) return;
  snprintf(destination, size, "%s", source ? source : "");
}

String portalSSID;
String portalPassword;
void buildPortalCredentials() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toUpperCase();
  String suffix = mac.length() >= 6 ? mac.substring(mac.length() - 6) : String("A1B2C3");
  portalSSID = "AquaGreen-" + suffix;
  portalPassword = "AQG-" + suffix;
}

void loadStoredConfig() {
  preferences.begin("aquagreen", false);
  preferences.getString("api_url", apiBaseUrl, sizeof(apiBaseUrl));
  preferences.getString("token", deviceToken, sizeof(deviceToken));
  soilDryAdc = preferences.getInt("soil_dry", -1);
  soilWetAdc = preferences.getInt("soil_wet", -1);
  rainDryAdc = preferences.getInt("rain_dry", -1);
  rainWetAdc = preferences.getInt("rain_wet", -1);
  windZeroVoltageV = preferences.getFloat("wind_zero", NAN);
  windSlopeMsPerV = preferences.getFloat("wind_slope", NAN);
  supplyTankEmptyDistanceCm = preferences.getFloat("sup_empty", NAN);
  supplyTankFullDistanceCm = preferences.getFloat("sup_full", NAN);
  collectionTankEmptyDistanceCm = preferences.getFloat("col_empty", NAN);
  collectionTankFullDistanceCm = preferences.getFloat("col_full", NAN);
  emergencyStopLatch = preferences.getBool("estop", false);
  runtimeLockout = preferences.getBool("lockout", false);
  preferences.end();
}

void makePortalParameters() {
  char soilDryText[8] = "";
  char soilWetText[8] = "";
  char rainDryText[8] = "";
  char rainWetText[8] = "";
  char windZeroText[16] = "";
  char windSlopeText[16] = "";
  char supplyEmptyText[16] = "";
  char supplyFullText[16] = "";
  char collectionEmptyText[16] = "";
  char collectionFullText[16] = "";
  if (soilDryAdc >= 0) snprintf(soilDryText, sizeof(soilDryText), "%d", soilDryAdc);
  if (soilWetAdc >= 0) snprintf(soilWetText, sizeof(soilWetText), "%d", soilWetAdc);
  if (rainDryAdc >= 0) snprintf(rainDryText, sizeof(rainDryText), "%d", rainDryAdc);
  if (rainWetAdc >= 0) snprintf(rainWetText, sizeof(rainWetText), "%d", rainWetAdc);
  if (finiteNumber(windZeroVoltageV)) snprintf(windZeroText, sizeof(windZeroText), "%.3f", windZeroVoltageV);
  if (finiteNumber(windSlopeMsPerV)) snprintf(windSlopeText, sizeof(windSlopeText), "%.4f", windSlopeMsPerV);
  if (finiteNumber(supplyTankEmptyDistanceCm)) snprintf(supplyEmptyText, sizeof(supplyEmptyText), "%.1f", supplyTankEmptyDistanceCm);
  if (finiteNumber(supplyTankFullDistanceCm)) snprintf(supplyFullText, sizeof(supplyFullText), "%.1f", supplyTankFullDistanceCm);
  if (finiteNumber(collectionTankEmptyDistanceCm)) snprintf(collectionEmptyText, sizeof(collectionEmptyText), "%.1f", collectionTankEmptyDistanceCm);
  if (finiteNumber(collectionTankFullDistanceCm)) snprintf(collectionFullText, sizeof(collectionFullText), "%.1f", collectionTankFullDistanceCm);

  pApiUrl = new WiFiManagerParameter("api_url", "Vercel API base URL (HTTPS origin only)", apiBaseUrl, sizeof(apiBaseUrl));
  pDeviceToken = new WiFiManagerParameter("device_token", "AQUAGREEN_DEVICE_TOKEN", deviceToken, sizeof(deviceToken));
  pSoilDry = new WiFiManagerParameter("soil_dry", "Soil ADC in DRY soil (measure first)", soilDryText, sizeof(soilDryText));
  pSoilWet = new WiFiManagerParameter("soil_wet", "Soil ADC in WELL-WATERED soil", soilWetText, sizeof(soilWetText));
  pRainDry = new WiFiManagerParameter("rain_dry", "Rain ADC when sensor is DRY", rainDryText, sizeof(rainDryText));
  pRainWet = new WiFiManagerParameter("rain_wet", "Rain ADC when sensor is WET", rainWetText, sizeof(rainWetText));
  pWindZero = new WiFiManagerParameter("wind_zero", "Wind sensor zero-wind voltage (V)", windZeroText, sizeof(windZeroText));
  pWindSlope = new WiFiManagerParameter("wind_slope", "Verified wind scale (m/s per V)", windSlopeText, sizeof(windSlopeText));
  pSupplyTankEmpty = new WiFiManagerParameter("sup_empty", "Supply tank distance when EMPTY (cm)", supplyEmptyText, sizeof(supplyEmptyText));
  pSupplyTankFull = new WiFiManagerParameter("sup_full", "Supply tank distance at safe FULL (cm)", supplyFullText, sizeof(supplyFullText));
  pCollectionTankEmpty = new WiFiManagerParameter("col_empty", "Collection tank distance when EMPTY (cm)", collectionEmptyText, sizeof(collectionEmptyText));
  pCollectionTankFull = new WiFiManagerParameter("col_full", "Collection tank distance at safe FULL (cm)", collectionFullText, sizeof(collectionFullText));

  wifiManager.addParameter(pApiUrl);
  wifiManager.addParameter(pDeviceToken);
  wifiManager.addParameter(pSoilDry);
  wifiManager.addParameter(pSoilWet);
  wifiManager.addParameter(pRainDry);
  wifiManager.addParameter(pRainWet);
  wifiManager.addParameter(pWindZero);
  wifiManager.addParameter(pWindSlope);
  wifiManager.addParameter(pSupplyTankEmpty);
  wifiManager.addParameter(pSupplyTankFull);
  wifiManager.addParameter(pCollectionTankEmpty);
  wifiManager.addParameter(pCollectionTankFull);
}

void savePortalParameters() {
  if (!pApiUrl || !pDeviceToken) return;
  String url = normalizeBaseUrl(pApiUrl->getValue());
  copyText(apiBaseUrl, sizeof(apiBaseUrl), url.c_str());
  copyText(deviceToken, sizeof(deviceToken), pDeviceToken->getValue());

  soilDryAdc = parseIntField(pSoilDry ? pSoilDry->getValue() : "");
  soilWetAdc = parseIntField(pSoilWet ? pSoilWet->getValue() : "");
  rainDryAdc = parseIntField(pRainDry ? pRainDry->getValue() : "");
  rainWetAdc = parseIntField(pRainWet ? pRainWet->getValue() : "");
  windZeroVoltageV = parseFloatField(pWindZero ? pWindZero->getValue() : "");
  windSlopeMsPerV = parseFloatField(pWindSlope ? pWindSlope->getValue() : "");
  supplyTankEmptyDistanceCm = parseFloatField(pSupplyTankEmpty ? pSupplyTankEmpty->getValue() : "");
  supplyTankFullDistanceCm = parseFloatField(pSupplyTankFull ? pSupplyTankFull->getValue() : "");
  collectionTankEmptyDistanceCm = parseFloatField(pCollectionTankEmpty ? pCollectionTankEmpty->getValue() : "");
  collectionTankFullDistanceCm = parseFloatField(pCollectionTankFull ? pCollectionTankFull->getValue() : "");

  preferences.begin("aquagreen", false);
  preferences.putString("api_url", apiBaseUrl);
  preferences.putString("token", deviceToken);
  preferences.putInt("soil_dry", soilDryAdc);
  preferences.putInt("soil_wet", soilWetAdc);
  preferences.putInt("rain_dry", rainDryAdc);
  preferences.putInt("rain_wet", rainWetAdc);
  preferences.putFloat("wind_zero", windZeroVoltageV);
  preferences.putFloat("wind_slope", windSlopeMsPerV);
  preferences.putFloat("sup_empty", supplyTankEmptyDistanceCm);
  preferences.putFloat("sup_full", supplyTankFullDistanceCm);
  preferences.putFloat("col_empty", collectionTankEmptyDistanceCm);
  preferences.putFloat("col_full", collectionTankFullDistanceCm);
  preferences.end();

  shouldSaveConfig = false;
  printConfigurationStatus();
}

void enterConfigPortal() {
  // Do not allow the pump to remain on while local network/device configuration is open.
  if (pumpIsActive) {
    digitalWrite(RELAY_PIN, HIGH);
    pumpIsActive = false;
    pumpStartTime = 0;
    Serial.println("[SAFETY] Pump forced OFF before opening configuration portal.");
  }
  buildPortalCredentials();
  wifiManager.setConfigPortalTimeout(180);
  Serial.printf("[WIFI] Setup portal SSID: %s\n", portalSSID.c_str());
  Serial.printf("[WIFI] Setup portal password: %s\n", portalPassword.c_str());
  Serial.println("[WIFI] Connect to this AP, then open http://192.168.4.1");
  bool connected = wifiManager.startConfigPortal(portalSSID.c_str(), portalPassword.c_str());
  if (connected) Serial.printf("[WIFI] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
  savePortalParameters();
}

// ------------------------------- RTC ------------------------------------
void initializeRtc() {
  Rtc.Begin();
  bool valid = Rtc.IsDateTimeValid();
  RtcDateTime now = Rtc.GetDateTime();
  if (!valid || now.Year() < 2023 || now.Year() > 2099) {
    Serial.println("[RTC] Invalid/untrusted time; setting compile time for local display only.");
    Rtc.SetIsWriteProtected(false);
    Rtc.SetDateTime(RtcDateTime(__DATE__, __TIME__));
  }
  if (Rtc.GetIsWriteProtected()) Rtc.SetIsWriteProtected(false);
  if (!Rtc.GetIsRunning()) Rtc.SetIsRunning(true);
  rtcUsable = Rtc.IsDateTimeValid();
}

void printRtcLocalTime() {
  if (!rtcUsable || !Rtc.IsDateTimeValid()) {
    Serial.print("RTC=invalid");
    return;
  }
  RtcDateTime dt = Rtc.GetDateTime();
  Serial.printf("RTC-local=%04u-%02u-%02u %02u:%02u:%02u",
                dt.Year(), dt.Month(), dt.Day(), dt.Hour(), dt.Minute(), dt.Second());
}

// --------------------------- Time / HTTPS -------------------------------
bool synchronizeClock() {
  if (WiFi.status() != WL_CONNECTED) return false;
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  struct tm timeInfo;
  for (int attempt = 0; attempt < 15; ++attempt) {
    if (getLocalTime(&timeInfo, 1000) && timeInfo.tm_year >= (2024 - 1900)) {
      Serial.println("[TIME] System clock synchronized (UTC via NTP).");
      return true;
    }
    delay(150);
  }
  Serial.println("[TIME WARN] NTP sync failed; HTTPS requests will remain disabled until clock is valid.");
  return false;
}

bool httpsPostJson(const String& endpoint, const String& payload, String& responseBody, int& responseCode) {
  responseCode = -1;
  responseBody = "";
  if (WiFi.status() != WL_CONNECTED || !timeSynced || !isHttpsUrlConfigured()) return false;

  String url = normalizeBaseUrl(apiBaseUrl) + endpoint;
  HTTPClient http;
  WiFiClientSecure secureClient;
  secureClient.setCACert(VERCEL_ROOT_CA);
  secureClient.setTimeout(12000);
  http.setTimeout(12000);

  if (!http.begin(secureClient, url)) {
    Serial.println("[HTTPS ERR] Could not initialize HTTPS request.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", deviceToken);
  responseCode = http.POST(payload);
  if (responseCode > 0) responseBody = http.getString();
  http.end();
  return responseCode > 0;
}

bool httpsGetHealth(String& responseBody, int& responseCode) {
  responseCode = -1;
  responseBody = "";
  if (WiFi.status() != WL_CONNECTED || !timeSynced || !isHttpsUrlConfigured()) return false;

  String url = normalizeBaseUrl(apiBaseUrl) + "/api/health";
  HTTPClient http;
  WiFiClientSecure secureClient;
  secureClient.setCACert(VERCEL_ROOT_CA);
  secureClient.setTimeout(10000);
  http.setTimeout(10000);
  if (!http.begin(secureClient, url)) return false;
  responseCode = http.GET();
  if (responseCode > 0) responseBody = http.getString();
  http.end();
  return responseCode > 0;
}

void checkCloudHealth() {
  if (millis() - lastHealthCheckMs < 30000UL) return;
  lastHealthCheckMs = millis();
  if (WiFi.status() != WL_CONNECTED || !timeSynced || !isHttpsUrlConfigured()) return;
  String body;
  int code = -1;
  if (httpsGetHealth(body, code) && code >= 200 && code < 300) {
    StaticJsonDocument<384> health;
    if (!deserializeJson(health, body) && health["status"] == "online") {
      Serial.println("[CLOUD HEALTH OK] Verified HTTPS/TLS + Vercel API/Supabase health. No sensor data was written by this check.");
      return;
    }
  }
  Serial.printf("[CLOUD HEALTH WARN] /api/health request failed; HTTP status=%d.\n", code);
}

// ----------------------------- Sensor reads -----------------------------
float readUltrasonicDistanceCm(uint8_t trigPin, uint8_t echoPin) {
  // HC-SR04 ECHO must be reduced to <= 3.3V before reaching the ESP32 GPIO.
  digitalWrite(trigPin, LOW);
  delayMicroseconds(3);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  unsigned long duration = pulseIn(echoPin, HIGH, 30000UL);
  if (duration == 0) return NAN; // timeout / no echo: never convert it to 0% or 100%
  float distanceCm = (float)duration * 0.0343f / 2.0f;
  if (!finiteNumber(distanceCm) || distanceCm < 2.0f || distanceCm > 400.0f) return NAN;
  return distanceCm;
}

float tankPercentFromDistance(float distanceCm, float emptyDistanceCm, float fullDistanceCm) {
  if (!finiteNumber(distanceCm) || !tankCalibrationValid(emptyDistanceCm, fullDistanceCm)) return NAN;
  // The tank is expected to measure between its calibration endpoints (with a small margin).
  // An out-of-range echo is treated as a sensor/configuration problem instead of a false alarm.
  if (distanceCm > emptyDistanceCm + 5.0f || distanceCm < fullDistanceCm - 2.0f) return NAN;
  float percent = ((emptyDistanceCm - distanceCm) / (emptyDistanceCm - fullDistanceCm)) * 100.0f;
  if (percent < 0.0f) percent = 0.0f;
  if (percent > 100.0f) percent = 100.0f;
  return percent;
}

void sampleSensors() {
  sensors.temperatureC = dht.readTemperature();
  sensors.humidityPct = dht.readHumidity();
  sensors.dhtValid = finiteNumber(sensors.temperatureC) && sensors.temperatureC >= -40.0f &&
                     sensors.temperatureC <= 80.0f && finiteNumber(sensors.humidityPct) &&
                     sensors.humidityPct >= 0.0f && sensors.humidityPct <= 100.0f;

  sensors.soilRaw = analogRead(SOIL_ADC_PIN);
  sensors.soilValid = soilCalibrationValid() && sensors.soilRaw > 10 && sensors.soilRaw < 4090;
  sensors.soilPercent = NAN;
  if (sensors.soilValid) {
    float denominator = (float)(soilDryAdc - soilWetAdc);
    sensors.soilPercent = ((float)(soilDryAdc - sensors.soilRaw) / denominator) * 100.0f;
    if (sensors.soilPercent < 0.0f) sensors.soilPercent = 0.0f;
    if (sensors.soilPercent > 100.0f) sensors.soilPercent = 100.0f;
  }

  sensors.rainRaw = analogRead(RAIN_ADC_PIN);
  sensors.rainValid = rainCalibrationValid() && sensors.rainRaw > 5 && sensors.rainRaw < 4090;
  sensors.rainDetected = false;
  if (sensors.rainValid) {
    float midpoint = ((float)rainDryAdc + (float)rainWetAdc) / 2.0f;
    sensors.rainDetected = (rainWetAdc < rainDryAdc)
      ? ((float)sensors.rainRaw <= midpoint)
      : ((float)sensors.rainRaw >= midpoint);
  }

  sensors.pressureHpa = NAN;
  sensors.pressureValid = false;
  if (bmpReady) {
    float pressure = bmp.readPressure() / 100.0f;
    if (finiteNumber(pressure) && pressure >= MIN_VALID_PRESSURE_HPA && pressure <= MAX_VALID_PRESSURE_HPA) {
      sensors.pressureHpa = pressure;
      sensors.pressureValid = true;
    }
  }

  sensors.lux = NAN;
  sensors.luxValid = false;
  if (lightMeterReady) {
    float lux = lightMeter.readLightLevel();
    if (finiteNumber(lux) && lux >= 0.0f && lux <= 200000.0f) {
      sensors.lux = lux;
      sensors.luxValid = true;
    }
  }

  // This firmware treats the installed wind sensor as an analog voltage output on GPIO32.
  // A zero/near-zero ADC reading is treated as a wiring/power fault until verified.
  sensors.windRaw = analogRead(WIND_ANALOG_PIN);
  sensors.windVoltageV = analogReadMilliVolts(WIND_ANALOG_PIN) / 1000.0f;
  sensors.windValid = windCalibrationValid() && sensors.windRaw >= 5 && sensors.windRaw < 4090 &&
                      finiteNumber(sensors.windVoltageV) && sensors.windVoltageV >= 0.0f &&
                      sensors.windVoltageV <= 3.3f;
  sensors.windSpeedMs = NAN;
  if (sensors.windValid) {
    float speed = (sensors.windVoltageV - windZeroVoltageV) * windSlopeMsPerV;
    if (speed < 0.0f) speed = 0.0f;
    // Reject implausible conversion outputs rather than uploading them.
    if (speed <= 75.0f) sensors.windSpeedMs = speed;
    else sensors.windValid = false;
  }

  // Tank sensors are sampled sequentially with a gap to reduce ultrasonic crosstalk.
  sensors.supplyTankDistanceCm = readUltrasonicDistanceCm(SUPPLY_TANK_TRIG_PIN, SUPPLY_TANK_ECHO_PIN);
  sensors.supplyTankEchoValid = finiteNumber(sensors.supplyTankDistanceCm);
  sensors.supplyTankPercent = tankPercentFromDistance(
      sensors.supplyTankDistanceCm, supplyTankEmptyDistanceCm, supplyTankFullDistanceCm);
  sensors.supplyTankPercentValid = sensors.supplyTankEchoValid && finiteNumber(sensors.supplyTankPercent);

  delay(65);
  sensors.collectionTankDistanceCm = readUltrasonicDistanceCm(COLLECTION_TANK_TRIG_PIN, COLLECTION_TANK_ECHO_PIN);
  sensors.collectionTankEchoValid = finiteNumber(sensors.collectionTankDistanceCm);
  sensors.collectionTankPercent = tankPercentFromDistance(
      sensors.collectionTankDistanceCm, collectionTankEmptyDistanceCm, collectionTankFullDistanceCm);
  sensors.collectionTankPercentValid = sensors.collectionTankEchoValid && finiteNumber(sensors.collectionTankPercent);

  lastSensorSampleMs = millis();
}

bool telemetrySampleValid() {
  return sensors.dhtValid && sensors.pressureValid && sensors.luxValid && sensors.soilValid &&
         sensors.rainValid && sensors.windValid && finiteNumber(sensors.soilPercent) &&
         finiteNumber(sensors.windSpeedMs);
}

bool pumpStartSafetyReady() {
  bool recentServerHeartbeat = (lastServerSuccessMs > 0) &&
      (millis() - lastServerSuccessMs <= SERVER_HEARTBEAT_TIMEOUT_MS);
  return recentServerHeartbeat && !emergencyStopLatch && !runtimeLockout && localPumpConfigReady() &&
         sensors.soilValid && sensors.rainValid && !sensors.rainDetected &&
         sensors.supplyTankPercentValid && sensors.supplyTankPercent > MIN_SUPPLY_TANK_PERCENT_TO_RUN &&
         finiteNumber(sensors.soilPercent) && sensors.soilPercent <= SOIL_START_THRESHOLD_PERCENT;
}

// ------------------------------- Pump -----------------------------------
void stopPump(const char* reason) {
  if (pumpIsActive) {
    unsigned long elapsed = (millis() - pumpStartTime) / 1000UL;
    digitalWrite(RELAY_PIN, HIGH);
    pumpIsActive = false;
    pumpStartTime = 0;
    Serial.printf("[PUMP OFF] after %lu s. Reason: %s\n", elapsed, reason);
  } else {
    digitalWrite(RELAY_PIN, HIGH);
  }
}

bool startPump(const char* reason, unsigned long requestedRuntimeMs = MAX_PUMP_RUNTIME_MS) {
  if (pumpIsActive) return true; // Do not reset the start timer on duplicate ON commands.
  if (!pumpStartSafetyReady()) {
    Serial.printf("[SAFETY] Pump ON rejected (%s): check soil/rain calibration, moisture, or lockout.\n", reason);
    return false;
  }
  unsigned long chosenLimit = requestedRuntimeMs;
  if (chosenLimit == 0 || chosenLimit > MAX_PUMP_RUNTIME_MS) chosenLimit = MAX_PUMP_RUNTIME_MS;
  pumpRuntimeLimitMs = chosenLimit;
  digitalWrite(RELAY_PIN, LOW);
  pumpIsActive = true;
  pumpStartTime = millis();
  Serial.printf("[PUMP ON] GPIO17 LOW; local runtime limit=%lu s. Reason: %s\n",
                pumpRuntimeLimitMs / 1000UL, reason);
  return true;
}

void applyLocalSafety() {
  if (!pumpIsActive) return;

  unsigned long now = millis();
  if (now - pumpStartTime >= pumpRuntimeLimitMs) {
    stopPump("Local hard runtime limit reached");
    runtimeLockout = true;
    persistSafetyState();
    Serial.println("[LOCKOUT] Runtime lockout set; send dashboard PUMP_OFF or serial RESETSTOP after checking the system.");
    return;
  }
  if (!sensors.soilValid || !sensors.rainValid) {
    stopPump("Soil/rain sensor invalid or calibration missing");
    return;
  }
  if (!sensors.supplyTankPercentValid) {
    stopPump("Supply tank sensor invalid or distance calibration missing");
    return;
  }
  if (sensors.supplyTankPercent <= MIN_SUPPLY_TANK_PERCENT_TO_RUN) {
    stopPump("Supply tank at dry-run protection cutoff (<= 5%)");
    return;
  }
  if (sensors.rainDetected) {
    stopPump("Rain wetness detected locally");
    return;
  }
  if (finiteNumber(sensors.soilPercent) && sensors.soilPercent >= SOIL_STOP_THRESHOLD_PERCENT) {
    stopPump("Soil moisture reached stop threshold");
    return;
  }
  if (now - lastServerSuccessMs > SERVER_HEARTBEAT_TIMEOUT_MS) {
    stopPump("No valid authenticated server response within heartbeat timeout");
    runtimeLockout = true;
    persistSafetyState();
    Serial.println("[LOCKOUT] Cloud heartbeat timeout; serial RESETSTOP or dashboard PUMP_OFF required to unlock.");
    return;
  }
}

// --------------------------- Command handling ---------------------------
void acknowledgeCommand(const char* commandId, bool success, const char* message) {
  if (!commandId || !commandId[0]) return;
  StaticJsonDocument<256> ack;
  ack["command_id"] = commandId;
  ack["actual_state"] = pumpIsActive;
  ack["success"] = success;
  ack["error_message"] = message;
  String payload;
  serializeJson(ack, payload);

  String body;
  int code = -1;
  bool transportOk = httpsPostJson("/api/pump/acknowledge", payload, body, code);
  if (transportOk && code >= 200 && code < 300) {
    Serial.printf("[COMMAND ACK] %s accepted by API (HTTP %d).\n", commandId, code);
  } else {
    Serial.printf("[COMMAND ACK WARN] HTTP status=%d; acknowledgement may not have been saved.\n", code);
  }
}

void handleServerCommand(JsonObject command) {
  const char* commandType = command["type"] | "";
  const char* commandId = command["command_id"] | "";
  unsigned long durationMs = MAX_PUMP_RUNTIME_MS;
  if (command["duration_seconds"].is<unsigned long>()) {
    unsigned long seconds = command["duration_seconds"].as<unsigned long>();
    if (seconds > 0) durationMs = seconds * 1000UL;
  }
  if (durationMs > MAX_PUMP_RUNTIME_MS) durationMs = MAX_PUMP_RUNTIME_MS;

  bool success = false;
  const char* ackMessage = "Unknown command type";

  if (strcmp(commandType, "PUMP_ON") == 0) {
    success = startPump("Authenticated dashboard PUMP_ON", durationMs);
    ackMessage = success ? "GPIO17 commanded ON; no electrical feedback sensor is installed" :
                            "Local safety interlock blocked pump activation";
  } else if (strcmp(commandType, "PUMP_OFF") == 0) {
    stopPump("Authenticated dashboard PUMP_OFF");
    runtimeLockout = false;
    persistSafetyState();
    success = true;
    ackMessage = "GPIO17 commanded OFF; runtime lockout cleared; emergency-stop latch remains if set";
  } else if (strcmp(commandType, "EMERGENCY_STOP") == 0) {
    emergencyStopLatch = true;
    runtimeLockout = true;
    stopPump("Authenticated dashboard EMERGENCY_STOP");
    persistSafetyState();
    success = !pumpIsActive;
    ackMessage = "Emergency stop latched; physical serial reset required to clear latch";
  }

  if (commandId[0]) acknowledgeCommand(commandId, success, ackMessage);
}

// --------------------------- Telemetry upload ---------------------------
void uploadTelemetryAndPollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!cloudConfigReady()) {
    if (millis() - lastConfigWarningMs >= 15000UL) {
      Serial.println("[DATA HOLD] Cloud upload disabled until HTTPS/token + soil/rain/wind calibration values are valid.");
      printConfigurationStatus();
      lastConfigWarningMs = millis();
    }
    return;
  }
  if (!telemetrySampleValid()) {
    if (millis() - lastSensorWarningMs >= 15000UL) {
      Serial.print("[DATA HOLD] No fabricated values will be uploaded. Invalid: ");
      if (!sensors.dhtValid) Serial.print("DHT22 ");
      if (!sensors.pressureValid) Serial.print("BMP280/pressure ");
      if (!sensors.luxValid) Serial.print("BH1750/lux ");
      if (!sensors.soilValid) Serial.print("soil ADC/calibration ");
      if (!sensors.rainValid) Serial.print("rain calibration ");
      if (!sensors.windValid) Serial.print("wind voltage/calibration ");
      Serial.println();
      lastSensorWarningMs = millis();
    }
    return;
  }

  StaticJsonDocument<768> doc;
  doc["temperature"] = sensors.temperatureC;
  doc["humidity"] = sensors.humidityPct;
  doc["soilMoistureRaw"] = sensors.soilRaw;
  doc["soilMoisturePercent"] = sensors.soilPercent;
  doc["pressure"] = sensors.pressureHpa;
  doc["windSpeed"] = sensors.windSpeedMs;
  doc["lux"] = sensors.lux;
  doc["rainDetected"] = sensors.rainDetected;
  doc["pumpState"] = pumpIsActive;
  doc["isSoilFault"] = false;
  if (finiteNumber(sensors.supplyTankDistanceCm)) doc["supplyTankDistanceCm"] = sensors.supplyTankDistanceCm; else doc["supplyTankDistanceCm"] = nullptr;
  if (sensors.supplyTankPercentValid) doc["supplyTankPercent"] = sensors.supplyTankPercent; else doc["supplyTankPercent"] = nullptr;
  doc["supplyTankSensorOk"] = sensors.supplyTankEchoValid;
  if (finiteNumber(sensors.collectionTankDistanceCm)) doc["collectionTankDistanceCm"] = sensors.collectionTankDistanceCm; else doc["collectionTankDistanceCm"] = nullptr;
  if (sensors.collectionTankPercentValid) doc["collectionTankPercent"] = sensors.collectionTankPercent; else doc["collectionTankPercent"] = nullptr;
  doc["collectionTankSensorOk"] = sensors.collectionTankEchoValid;
  // Intentionally omit timestamp/rtcTimestamp. The API records its own UTC receipt time;
  // this avoids labelling DS1302 local time as UTC with a misleading trailing 'Z'.

  String payload;
  serializeJson(doc, payload);
  String response;
  int code = -1;
  bool transportOk = httpsPostJson("/api/telemetry", payload, response, code);

  if (!transportOk || code < 200 || code >= 300) {
    Serial.printf("[HTTPS ERR] Telemetry request failed; HTTP status=%d. TLS/auth errors fail closed.\n", code);
    return;
  }

  StaticJsonDocument<768> responseDoc;
  DeserializationError jsonErr = deserializeJson(responseDoc, response);
  if (jsonErr || !(responseDoc["status"] == "received")) {
    Serial.println("[API WARN] HTTP success but response was not a valid telemetry receipt; heartbeat not refreshed.");
    return;
  }

  lastServerSuccessMs = millis();
  Serial.printf("[CLOUD OK] Telemetry accepted; HTTP %d.\n", code);
  if (responseDoc["command"].is<JsonObject>()) {
    handleServerCommand(responseDoc["command"].as<JsonObject>());
  }
}

// ---------------------------- Serial control ----------------------------
void printStatus() {
  Serial.println("\n[AQUAGREEN STATUS]");
  Serial.printf("Wi-Fi: %s\n", WiFi.status() == WL_CONNECTED ? "connected" : "disconnected");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
  }
  Serial.printf("API URL: %s\n", isHttpsUrlConfigured() ? apiBaseUrl : "NOT CONFIGURED (HTTPS required)");
  Serial.printf("Pump: %s\n", pumpIsActive ? "ON" : "OFF");
  Serial.printf("Emergency stop latch: %s\n", emergencyStopLatch ? "SET" : "clear");
  Serial.printf("Runtime/heartbeat lockout: %s\n", runtimeLockout ? "SET" : "clear");
  Serial.printf("Sensor validity: DHT=%d BMP=%d BH1750=%d Soil=%d Rain=%d Wind=%d SupplyEcho=%d SupplyPercentValid=%d CollectionEcho=%d CollectionPercentValid=%d\n",
                sensors.dhtValid, sensors.pressureValid, sensors.luxValid,
                sensors.soilValid, sensors.rainValid, sensors.windValid,
                sensors.supplyTankEchoValid, sensors.supplyTankPercentValid,
                sensors.collectionTankEchoValid, sensors.collectionTankPercentValid);
  Serial.printf("Raw values: soil=%d rain=%d windADC=%d windV=%.3f V\n",
                sensors.soilRaw, sensors.rainRaw, sensors.windRaw, sensors.windVoltageV);
  if (finiteNumber(sensors.soilPercent)) Serial.printf("Calibrated relative soil index: %.1f %%\n", sensors.soilPercent);
  else Serial.println("Calibrated relative soil index: unavailable");
  if (sensors.supplyTankPercentValid) Serial.printf("Supply tank: %.1f%% (distance %.1f cm)\n", sensors.supplyTankPercent, sensors.supplyTankDistanceCm);
  else Serial.printf("Supply tank: unavailable (distance=%.1f cm, echo=%d, calibration=%d)\n", sensors.supplyTankDistanceCm, sensors.supplyTankEchoValid, supplyTankCalibrationValid());
  if (sensors.collectionTankPercentValid) Serial.printf("Collection tank: %.1f%% (distance %.1f cm)\n", sensors.collectionTankPercent, sensors.collectionTankDistanceCm);
  else Serial.printf("Collection tank: unavailable (distance=%.1f cm, echo=%d, calibration=%d)\n", sensors.collectionTankDistanceCm, sensors.collectionTankEchoValid, collectionTankCalibrationValid());
  printConfigurationStatus();
}

void processSerialCommands() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "STATUS") {
    printStatus();
  } else if (cmd == "CONFIG") {
    enterConfigPortal();
    if (WiFi.status() == WL_CONNECTED) timeSynced = synchronizeClock();
  } else if (cmd == "OFF") {
    stopPump("Local serial OFF command");
    runtimeLockout = false;
  } else if (cmd == "ON") {
    startPump("Local serial ON command");
  } else if (cmd == "RESETSTOP") {
    stopPump("Local serial RESETSTOP command");
    emergencyStopLatch = false;
    runtimeLockout = false;
    persistSafetyState();
    Serial.println("[SAFETY] Emergency/runtime lockout cleared locally. Verify wiring, sensors, and water path before ON.");
  } else if (cmd == "RESETWIFI") {
    stopPump("RESETWIFI command");
    Serial.println("[WIFI] Erasing saved Wi-Fi credentials and restarting; API token/calibration settings are preserved.");
    wifiManager.resetSettings();
    delay(300);
    ESP.restart();
  } else if (cmd.length() > 0) {
    Serial.println("Commands: STATUS, CONFIG, ON, OFF, RESETSTOP, RESETWIFI");
  }
}

// -------------------------------- Setup ---------------------------------
void setup() {
  Serial.begin(115200);
  delay(350);
  Serial.println("\n===============================================");
  Serial.println(" AquaGreen - corrected ESP32 cloud controller ");
  Serial.println("===============================================");

  // Active-LOW relay: write HIGH before OUTPUT mode to reduce startup glitches.
  digitalWrite(RELAY_PIN, HIGH);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);
  pinMode(SOIL_ADC_PIN, INPUT);
  pinMode(RAIN_ADC_PIN, INPUT);
  pinMode(WIND_ANALOG_PIN, INPUT);
  pinMode(SUPPLY_TANK_TRIG_PIN, OUTPUT);
  pinMode(SUPPLY_TANK_ECHO_PIN, INPUT);
  pinMode(COLLECTION_TANK_TRIG_PIN, OUTPUT);
  pinMode(COLLECTION_TANK_ECHO_PIN, INPUT);
  digitalWrite(SUPPLY_TANK_TRIG_PIN, LOW);
  digitalWrite(COLLECTION_TANK_TRIG_PIN, LOW);
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(RAIN_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(WIND_ANALOG_PIN, ADC_11db);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  dht.begin();
  Serial.println("[INIT] DHT22 started on GPIO4.");

  bmpReady = bmp.begin(0x76);
  if (!bmpReady) bmpReady = bmp.begin(0x77);
  Serial.printf("[INIT] BMP280: %s\n", bmpReady ? "ready" : "NOT DETECTED; telemetry inhibited");

  lightMeterReady = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
  Serial.printf("[INIT] BH1750/GY-302: %s\n", lightMeterReady ? "ready" : "NOT DETECTED; telemetry inhibited");

  initializeRtc();
  loadStoredConfig();
  makePortalParameters();

  wifiManager.setSaveConfigCallback(saveConfigCallback);
  wifiManager.setConfigPortalTimeout(180);
  wifiManager.setConnectTimeout(20);
  buildPortalCredentials();

  Serial.printf("[WIFI] Setup AP if needed: %s\n", portalSSID.c_str());
  Serial.printf("[WIFI] AP password: %s\n", portalPassword.c_str());
  bool connected = wifiManager.autoConnect(portalSSID.c_str(), portalPassword.c_str());
  if (connected) {
    Serial.printf("[WIFI] Connected; IP=%s\n", WiFi.localIP().toString().c_str());
    WiFi.setAutoReconnect(true);
    savePortalParameters();
    timeSynced = synchronizeClock();
  } else {
    Serial.println("[WIFI] No connection. Local safety remains active; use serial CONFIG to retry.");
  }

  printConfigurationStatus();
  Serial.println("[SERIAL] Commands: STATUS, CONFIG, ON, OFF, RESETSTOP, RESETWIFI");
  Serial.println("[DATA QUALITY] Do not enable watering until soil/rain endpoints and wind calibration are measured.");
}

// -------------------------------- Loop ----------------------------------
void loop() {
  processSerialCommands();
  unsigned long now = millis();

  if (now - lastSensorSampleMs >= SENSOR_SAMPLE_INTERVAL_MS || lastSensorSampleMs == 0) {
    sampleSensors();
  }

  applyLocalSafety();

  // If Wi-Fi returns after a drop, resynchronize time before making TLS requests.
  static bool wasConnected = false;
  bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected && !wasConnected) {
    timeSynced = synchronizeClock();
    lastNtpRetryMs = millis();
  }
  wasConnected = wifiConnected;
  if (wifiConnected && !timeSynced && millis() - lastNtpRetryMs >= 60000UL) {
    lastNtpRetryMs = millis();
    timeSynced = synchronizeClock();
  }
  checkCloudHealth();

  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    uploadTelemetryAndPollCommands();
  }

  if (now - lastLogMs >= LOG_INTERVAL_MS) {
    lastLogMs = now;
    Serial.print("[SENSORS] ");
    if (finiteNumber(sensors.temperatureC)) Serial.printf("T=%.2fC ", sensors.temperatureC); else Serial.print("T=INVALID ");
    if (finiteNumber(sensors.humidityPct)) Serial.printf("RH=%.1f%% ", sensors.humidityPct); else Serial.print("RH=INVALID ");
    if (finiteNumber(sensors.pressureHpa)) Serial.printf("P=%.2fhPa ", sensors.pressureHpa); else Serial.print("P=INVALID ");
    Serial.printf("soilADC=%d rainADC=%d windADC=%d windV=%.3fV ", sensors.soilRaw, sensors.rainRaw, sensors.windRaw, sensors.windVoltageV);
    if (finiteNumber(sensors.lux)) Serial.printf("lux=%.1f ", sensors.lux); else Serial.print("lux=INVALID ");
    if (finiteNumber(sensors.soilPercent)) Serial.printf("soilIndex=%.1f%% ", sensors.soilPercent); else Serial.print("soilIndex=UNAVAILABLE ");
    if (sensors.supplyTankPercentValid) Serial.printf("supply=%.1f%% ", sensors.supplyTankPercent); else Serial.print("supply=INVALID ");
    if (sensors.collectionTankPercentValid) Serial.printf("collection=%.1f%% ", sensors.collectionTankPercent); else Serial.print("collection=INVALID ");
    Serial.printf("rain=%s pump=%s ", sensors.rainValid ? (sensors.rainDetected ? "WET" : "DRY") : "UNCALIBRATED", pumpIsActive ? "ON" : "OFF");
    printRtcLocalTime();
    Serial.println();
  }

  delay(5);
}

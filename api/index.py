"""
AquaGreen Smart Irrigation System - Vercel Serverless Production API
Public HTTPS Endpoint for React Frontend and ESP32 IoT Controller.
Enforces strict device/dashboard authentication, reliable command lifecycle,
and scientific FAO-56 diurnal data sufficiency.
"""

from fastapi import FastAPI, APIRouter, HTTPException, Response, Query, Header, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import csv
import io
import os
import sys

# Ensure local imports resolve in Vercel serverless environment
sys.path.insert(0, os.path.dirname(__file__))

import database
from fao56_engine import compute_fao56

app = FastAPI(
    title="AquaGreen Smart Irrigation API",
    description="Universal Production API for ESP32 Multi-Sensor Telemetry & Autonomous Irrigation Control",
    version="2.1.0"
)

# Enable CORS for public Vercel domain and local preview
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()

# ------------------------------------------------------------------------------
# Security & Token Verification (Defect 1)
# ------------------------------------------------------------------------------
IS_PRODUCTION = bool(
    os.getenv("VERCEL") or 
    os.getenv("ENVIRONMENT") in ("production", "prod") or
    os.getenv("NODE_ENV") == "production"
)

DEVICE_TOKEN_SECRET = os.getenv("AQUAGREEN_DEVICE_TOKEN")
DASHBOARD_KEY_SECRET = os.getenv("DASHBOARD_API_KEY")

def verify_device_token(x_device_token: Optional[str] = Header(None)):
    """
    Protects physical IoT endpoints (/api/telemetry, /api/pump/acknowledge).
    Mandatory in production environments.
    """
    if IS_PRODUCTION:
        if not DEVICE_TOKEN_SECRET:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Production security invariant failure: AQUAGREEN_DEVICE_TOKEN is not configured in Vercel."
            )
        if not x_device_token or x_device_token != DEVICE_TOKEN_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Valid X-Device-Token header is mandatory in production."
            )
    else:
        # Development mode: enforce token only if configured
        if DEVICE_TOKEN_SECRET and x_device_token != DEVICE_TOKEN_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid X-Device-Token header."
            )
    return True

def verify_dashboard_control(
    x_dashboard_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)
):
    """
    Protects remote manual pump controls and configuration writes.
    Mandatory in production environments.
    """
    if IS_PRODUCTION:
        if not DASHBOARD_KEY_SECRET:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Production security invariant failure: DASHBOARD_API_KEY is not configured in Vercel."
            )
        token = x_dashboard_key
        if not token and authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ")[1]
        if not token or token != DASHBOARD_KEY_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Valid X-Dashboard-Key or Bearer token required for remote operations."
            )
    else:
        # Development mode: enforce key only if configured
        if DASHBOARD_KEY_SECRET:
            token = x_dashboard_key
            if not token and authorization and authorization.startswith("Bearer "):
                token = authorization.split(" ")[1]
            if not token or token != DASHBOARD_KEY_SECRET:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unauthorized: Invalid dashboard authentication key."
                )
    return True

# ------------------------------------------------------------------------------
# Request / Response Models
# ------------------------------------------------------------------------------
class PhysicalTelemetryPayload(BaseModel):
    temperature: float = Field(..., description="Air Temperature in °C")
    humidity: float = Field(..., description="Relative Humidity in %")
    soilMoistureRaw: int = Field(..., description="Raw ADC value (0-4095)")
    soilMoisturePercent: Optional[float] = Field(None, description="Calibrated moisture percentage")
    pressure: float = Field(..., description="Barometric pressure in hPa")
    windSpeed: float = Field(..., description="Wind speed in m/s")
    lux: float = Field(..., description="Illuminance in lux (NOT solar radiation)")
    rainDetected: bool = Field(..., description="Rain sensor surface wetness indicator")
    pumpState: bool = Field(..., description="Reported relay state from ESP32")
    isSoilFault: Optional[bool] = False
    rtcTimestamp: Optional[str] = Field(None, description="Optional DS1302 RTC ISO timestamp")
    timestamp: Optional[str] = Field(None, description="Optional timestamp")
    supplyTankDistanceCm: Optional[float] = Field(None, ge=2, le=400)
    supplyTankPercent: Optional[float] = Field(None, ge=0, le=100)
    supplyTankSensorOk: Optional[bool] = None
    collectionTankDistanceCm: Optional[float] = Field(None, ge=2, le=400)
    collectionTankPercent: Optional[float] = Field(None, ge=0, le=100)
    collectionTankSensorOk: Optional[bool] = None

class SimulatorTelemetryPayload(BaseModel):
    temperature: float = Field(..., description="Air Temperature in °C")
    humidity: float = Field(..., description="Relative Humidity in %")
    soilMoistureRaw: int = Field(..., description="Raw ADC value (0-4095)")
    soilMoisturePercent: Optional[float] = Field(None, description="Calibrated moisture percentage")
    pressure: float = Field(..., description="Barometric pressure in hPa")
    windSpeed: float = Field(..., description="Wind speed in m/s")
    lux: float = Field(..., description="Illuminance in lux")
    rainDetected: bool = Field(..., description="Rain sensor surface wetness indicator")
    pumpState: bool = Field(..., description="Simulated relay state")
    isSoilFault: Optional[bool] = False
    supplyTankDistanceCm: Optional[float] = Field(None, ge=2, le=400)
    supplyTankPercent: Optional[float] = Field(None, ge=0, le=100)
    supplyTankSensorOk: Optional[bool] = None
    collectionTankDistanceCm: Optional[float] = Field(None, ge=2, le=400)
    collectionTankPercent: Optional[float] = Field(None, ge=0, le=100)
    collectionTankSensorOk: Optional[bool] = None

class PumpControlPayload(BaseModel):
    command: str = Field(..., description="PUMP_ON, PUMP_OFF, or EMERGENCY_STOP")
    durationMinutes: Optional[int] = Field(5, description="Requested runtime duration in minutes")
    reason: Optional[str] = "Manual operator command from public dashboard"

class PumpAcknowledgePayload(BaseModel):
    command_id: str = Field(..., description="Command UUID dispatched by backend")
    actual_state: bool = Field(..., description="Physical relay state verified on GPIO17")
    success: bool = Field(True, description="Whether relay transition was successful")
    error_message: Optional[str] = None

class CropDemandRequest(BaseModel):
    crop_name: str = "Generic Research Crop"
    stage: str = "mid"
    kc: float = 1.05
    area_sqm: float = 20.0
    efficiency: float = 0.85
    pump_flow_rate_lpm: float = 12.0

class SettingsPayload(BaseModel):
    calibration: Optional[Dict[str, Any]] = None
    automation: Optional[Dict[str, Any]] = None
    crop: Optional[Dict[str, Any]] = None
    waterTanks: Optional[Dict[str, Any]] = None
    # Support direct flat properties
    soilDryAdc: Optional[int] = None
    soilWetAdc: Optional[int] = None
    latitude: Optional[float] = None
    elevation: Optional[float] = None
    anemometerHeight: Optional[float] = None
    anemometerFactor: Optional[float] = None
    kRs: Optional[float] = None
    pumpFlowRate: Optional[float] = None
    relayActiveLow: Optional[bool] = None
    dryThresholdPercent: Optional[int] = None
    targetWetPercent: Optional[int] = None
    maxRuntimeMinutes: Optional[int] = None
    rainInhibitionEnabled: Optional[bool] = None
    emergencyStop: Optional[bool] = None

# ------------------------------------------------------------------------------
# System Health & Root
# ------------------------------------------------------------------------------
@router.get("/health")
def health_check():
    try:
        latest = database.get_latest_reading()
        last_seen = latest["timestamp"] if latest else None
        db_mode = "supabase_postgresql" if database.IS_POSTGRES else "sqlite_local"
        return {
            "status": "online",
            "system": "AquaGreen Smart Irrigation System",
            "environment": "production" if IS_PRODUCTION else "development",
            "database": db_mode,
            "timestamp": datetime.utcnow().isoformat(),
            "last_telemetry_timestamp": last_seen,
            "security": {
                "device_token_enforced": bool(DEVICE_TOKEN_SECRET) or IS_PRODUCTION,
                "dashboard_auth_enforced": bool(DASHBOARD_KEY_SECRET) or IS_PRODUCTION
            }
        }
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=f"Database connection error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# Physical Telemetry Ingest & Query Endpoints
# ------------------------------------------------------------------------------
@router.post("/telemetry")
def receive_telemetry(payload: PhysicalTelemetryPayload, _auth=Depends(verify_device_token)):
    """
    Ingests genuine sensor reading from the PHYSICAL ESP32 controller.
    Always marks reading as isSimulated=False.
    Performs safety validation, persists to Supabase, and claims pending commands.
    """
    try:
        # Threshold-crossing checks use only the preceding PHYSICAL sample.
        previous = database.get_latest_reading(include_simulated=False)
        data_dict = payload.model_dump()
        # Strictly mark physical telemetry
        data_dict["isSimulated"] = False

        row_id = database.insert_reading(data_dict)

        # Water-tank warnings depend on valid percentages, never on missing/invalid samples.
        tank_settings = database.get_all_settings().get("waterTanks", {})
        supply_threshold = float(tank_settings.get("supplyLowThresholdPercent", 20))
        collection_threshold = float(tank_settings.get("collectionHighThresholdPercent", 90))
        hysteresis = max(0.0, float(tank_settings.get("alertHysteresisPercent", 5)))
        supply_pct = data_dict.get("supplyTankPercent")
        collection_pct = data_dict.get("collectionTankPercent")
        previous_supply = previous.get("supply_tank_percent") if previous else None
        previous_collection = previous.get("collection_tank_percent") if previous else None

        if data_dict.get("supplyTankSensorOk") is True and supply_pct is not None and 0 <= float(supply_pct) <= 100:
            supply_pct = float(supply_pct)
            crossed_low = (previous_supply is None and supply_pct <= supply_threshold) or (
                previous_supply is not None and float(previous_supply) > supply_threshold + hysteresis and supply_pct <= supply_threshold
            )
            if crossed_low:
                severity = "CRITICAL" if supply_pct <= max(5.0, supply_threshold / 2.0) else "WARNING"
                database.insert_notification(
                    title="Water Supply Tank Low",
                    message=f"Water supply tank is at {supply_pct:.1f}%, at or below the {supply_threshold:.1f}% warning threshold. Refill the supply tank before the pump runs dry.",
                    severity=severity,
                    category="WATER_TANK"
                )

        if data_dict.get("collectionTankSensorOk") is True and collection_pct is not None and 0 <= float(collection_pct) <= 100:
            collection_pct = float(collection_pct)
            crossed_high = (previous_collection is None and collection_pct >= collection_threshold) or (
                previous_collection is not None and float(previous_collection) < collection_threshold - hysteresis and collection_pct >= collection_threshold
            )
            if crossed_high:
                severity = "CRITICAL" if collection_pct >= min(100.0, collection_threshold + 7.0) else "WARNING"
                database.insert_notification(
                    title="Water Collection Tank Almost Full",
                    message=f"Water collection tank is at {collection_pct:.1f}%, at or above the {collection_threshold:.1f}% warning threshold. Check the tank and overflow route.",
                    severity=severity,
                    category="WATER_TANK"
                )

        # 1. Safety Checks: Open-circuit probe check (ADC 4095)
        if data_dict.get("soilMoistureRaw", 0) >= 4090:
            database.insert_notification(
                title="Soil Sensor Open-Circuit Detected",
                message="ADC reported 4095 saturation limit. Open circuit or probe disconnected.",
                severity="CRITICAL",
                category="HARDWARE"
            )
            if data_dict.get("pumpState"):
                database.queue_command("PUMP_OFF", duration_seconds=0, ttl_seconds=60)

        # 2. Safety Checks: Rain detected while pump is running
        settings = database.get_all_settings()
        automation_conf = settings.get("automation", {})
        rain_inhibit = automation_conf.get("rainInhibitionEnabled", True)
        if rain_inhibit and data_dict.get("rainDetected") and data_dict.get("pumpState"):
            database.insert_notification(
                title="Rain Inhibit Activated",
                message="Surface wetness detected during irrigation. Pump shutoff command queued.",
                severity="WARNING",
                category="IRRIGATION"
            )
            database.queue_command("PUMP_OFF", duration_seconds=0, ttl_seconds=60)

        # 3. Authenticated ESP32 claims pending commands (Defect 2)
        pending = database.claim_pending_command_for_esp32()

        response: Dict[str, Any] = {
            "status": "received",
            "id": row_id,
            "source": "ESP32_HARDWARE",
            "server_time": datetime.utcnow().isoformat()
        }

        if pending:
            response["command"] = {
                "command_id": pending["command_id"],
                "type": pending["command_type"],
                "duration_seconds": pending["duration_seconds"],
                "expires_at": pending["expires_at"]
            }

        return response
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process telemetry: {str(e)}")

# ------------------------------------------------------------------------------
# Dedicated Simulator Endpoint (Defect 9)
# ------------------------------------------------------------------------------
@router.post("/simulator/telemetry")
@router.post("/telemetry/simulate")
def inject_simulator_telemetry(payload: SimulatorTelemetryPayload, _auth=Depends(verify_dashboard_control)):
    """
    Dedicated endpoint for testing simulation readings.
    Cannot masquerade as physical ESP32 telemetry; strictly recorded as is_simulated=True.
    Does NOT claim or dispatch physical ESP32 pump commands.
    """
    try:
        data_dict = payload.model_dump()
        data_dict["isSimulated"] = True
        row_id = database.insert_reading(data_dict)

        return {
            "status": "simulated_reading_recorded",
            "id": row_id,
            "source": "SIMULATOR",
            "server_time": datetime.utcnow().isoformat(),
            "note": "Simulator telemetry is visually segregated from physical research telemetry."
        }
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/telemetry/latest")
def get_latest(include_simulated: bool = Query(True)):
    try:
        latest = database.get_latest_reading(include_simulated=include_simulated)
        if not latest:
            return {
                "id": None,
                "timestamp": None,
                "temperature": None,
                "humidity": None,
                "soil_moisture_raw": None,
                "soil_moisture_percent": None,
                "pressure": None,
                "wind_speed": None,
                "lux": None,
                "rain_detected": False,
                "pump_state": False,
                "is_simulated": False,
                "source": "NONE",
                "is_stale": True,
                "age_seconds": None,
                "message": "No telemetry readings recorded yet. Awaiting physical ESP32 upload."
            }

        created_at = datetime.fromisoformat(latest["timestamp"].replace("Z", "+00:00")) if isinstance(latest["timestamp"], str) else latest["timestamp"]
        if created_at.tzinfo:
            created_at = created_at.astimezone(datetime.utcnow().tzinfo).replace(tzinfo=None)
        age_seconds = (datetime.utcnow() - created_at).total_seconds()
        latest["is_stale"] = age_seconds > 900
        latest["age_seconds"] = int(age_seconds)
        latest["source"] = "SIMULATOR" if latest.get("is_simulated") else "ESP32_HARDWARE"
        return latest
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/telemetry/history")
def get_history(limit: int = Query(50, ge=1, le=500), include_simulated: bool = Query(True)):
    try:
        rows = database.get_recent_readings(limit=limit, include_simulated=include_simulated)
        for r in rows:
            r["source"] = "SIMULATOR" if r.get("is_simulated") else "ESP32_HARDWARE"
        return rows
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# ESP32 Command Flow & Hardware Relay Lifecycle (Defect 2)
# ------------------------------------------------------------------------------
@router.post("/pump/control")
def control_pump(payload: PumpControlPayload, _auth=Depends(verify_dashboard_control)):
    """
    Submits a remote pump command (PUMP_ON, PUMP_OFF, EMERGENCY_STOP).
    Generates a unique command ID, verifies safety rules, and queues for ESP32 dispatch.
    """
    try:
        cmd = payload.command.upper()
        if cmd not in ["PUMP_ON", "PUMP_OFF", "EMERGENCY_STOP"]:
            raise HTTPException(status_code=400, detail="Invalid command type")

        settings = database.get_all_settings()
        automation_conf = settings.get("automation", {})

        # Interlock: Check if emergency stop is active
        if automation_conf.get("emergencyStop", False) and cmd == "PUMP_ON":
            raise HTTPException(status_code=403, detail="Cannot energize pump: Emergency Stop latch is engaged")

        # Interlock: Check rain condition
        latest = database.get_latest_reading()
        if cmd == "PUMP_ON" and automation_conf.get("rainInhibitionEnabled", True) and latest and latest.get("rain_detected"):
            raise HTTPException(status_code=403, detail="Cannot energize pump: Rain surface wetness detected")

        # Interlock: Check sensor fault
        if cmd == "PUMP_ON" and latest and (latest.get("soil_moisture_raw") or 0) >= 4090:
            raise HTTPException(status_code=403, detail="Cannot energize pump: Soil sensor probe is disconnected (ADC 4095)")

        duration_sec = (payload.durationMinutes or 5) * 60
        max_runtime_min = automation_conf.get("maxRuntimeMinutes", 15)
        duration_sec = min(duration_sec, max_runtime_min * 60)

        queued = database.queue_command(cmd, duration_seconds=duration_sec, ttl_seconds=120)

        database.insert_event({
            "eventType": "START" if cmd == "PUMP_ON" else "STOP" if cmd == "PUMP_OFF" else "EMERGENCY_STOP",
            "triggerReason": f"{payload.reason} (Queued: {queued['command_id']})",
            "commandSource": "MANUAL_USER",
            "pumpReportedState": 1 if cmd == "PUMP_ON" else 0
        })

        return {
            "status": "command_queued",
            "command": queued
        }
    except HTTPException:
        raise
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pump/status")
def get_pump_status():
    """
    Polling endpoint returning verified physical relay state and inspecting the command queue.
    CRITICAL (Defect 2): Uses peek_active_command so polling NEVER consumes or dispatches pending commands!
    """
    try:
        latest = database.get_latest_reading()
        is_running = bool(latest.get("pump_state")) if latest else False
        pending = database.peek_active_command()

        return {
            "actualPumpRunning": is_running,
            "relayPin": "GPIO17",
            "relayPolarity": "Active-LOW (LOW=ON, HIGH=OFF)",
            "pendingCommand": pending,
            "lastUpdated": latest["timestamp"] if latest else None
        }
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pump/acknowledge")
def acknowledge_pump(payload: PumpAcknowledgePayload, _auth=Depends(verify_device_token)):
    """
    Callback endpoint where the physical ESP32 confirms relay state transition on GPIO17.
    """
    try:
        updated = database.acknowledge_command(
            command_id=payload.command_id,
            actual_state=payload.actual_state,
            success=payload.success,
            ack_message=payload.error_message or "Physical relay verified on GPIO17"
        )

        if not updated:
            raise HTTPException(status_code=404, detail="Command ID not found or already in terminal state")

        database.insert_event({
            "eventType": "START" if payload.actual_state else "STOP",
            "triggerReason": f"ESP32 Acknowledged command {payload.command_id}",
            "commandSource": "ESP32_TELEMETRY",
            "pumpReportedState": 1 if payload.actual_state else 0
        })

        return {
            "status": "acknowledged",
            "command_id": payload.command_id,
            "actual_state": payload.actual_state
        }
    except HTTPException:
        raise
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# FAO-56 Penman-Monteith with Strict Diurnal Data Sufficiency (Defect 5)
# ------------------------------------------------------------------------------
@router.get("/fao56/calculate")
def get_fao_calculation(
    lat: float = Query(14.5995, description="Site latitude in decimal degrees"),
    elevation: float = Query(25.0, description="Elevation in meters ASL"),
    k_rs: float = Query(0.16, description="Hargreaves radiation coefficient"),
    date: Optional[str] = Query(None, description="Target calendar date (YYYY-MM-DD). Defaults to UTC today."),
    allow_instantaneous: bool = Query(False, description="Explicitly permit instantaneous approximation if daily coverage is incomplete")
):
    """
    Calculates reference crop evapotranspiration (ET₀) via FAO-56 Penman-Monteith.
    Defect 5: Aggregates genuine measurements by date and enforces adequate diurnal coverage (>= 4 hours span).
    Never calculates ET₀ from instantaneous samples collected over seconds without explicit approximation labeling.
    Never fabricates synthetic weather data.
    """
    try:
        target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
        readings = database.get_readings_by_day(target_date, include_simulated=False)

        if not readings:
            # Check recent readings if date filter returned empty
            recent = database.get_recent_readings(limit=100, include_simulated=False)
            if not recent:
                return {
                    "isAvailable": False,
                    "isSufficient": False,
                    "status": "NO_TELEMETRY",
                    "et0": None,
                    "reason": "No genuine physical sensor readings recorded in database. Awaiting physical ESP32 telemetry.",
                    "sampleCount": 0,
                    "coverageHours": 0.0,
                    "targetDate": target_date
                }
            readings = recent

        # Compute temporal span across genuine readings
        def parse_ts(r):
            ts = r.get("timestamp")
            if isinstance(ts, datetime):
                return ts
            try:
                return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except Exception:
                return datetime.utcnow()

        timestamps = [parse_ts(r) for r in readings]
        min_ts = min(timestamps)
        max_ts = max(timestamps)
        time_span_hours = (max_ts - min_ts).total_seconds() / 3600.0

        temps = [float(r["temperature"]) for r in readings if r.get("temperature") is not None]
        humids = [float(r["humidity"]) for r in readings if r.get("humidity") is not None]
        winds = [float(r["wind_speed"]) for r in readings if r.get("wind_speed") is not None]

        # Scientific Diurnal Sufficiency Criteria:
        # At least 12 samples spanning at least 4.0 hours across daytime/nighttime to capture Tmin and Tmax extremes.
        is_sufficient = (len(readings) >= 12 and time_span_hours >= 4.0)

        if not is_sufficient and not allow_instantaneous:
            return {
                "isAvailable": False,
                "isSufficient": False,
                "status": "INSUFFICIENT_DIURNAL_COVERAGE",
                "et0": None,
                "reason": (
                    f"Insufficient diurnal temporal coverage: genuine measurements span {round(time_span_hours, 1)} "
                    f"hours with {len(readings)} samples on {target_date}. Full-day FAO-56 Penman-Monteith requires "
                    f"at least 4.0 hours of diurnal coverage spanning daytime and nighttime/morning extremes to evaluate "
                    f"daily Tmin and Tmax accurately."
                ),
                "sampleCount": len(readings),
                "coverageHours": round(time_span_hours, 1),
                "targetDate": target_date,
                "methodLimitations": [
                    "Full-day ET0 requires authentic diurnal temperature extremes (Tmin and Tmax).",
                    "GY-302 measures lux, not W/m2. Solar radiation Rs estimated via FAO-56 Hargreaves temperature-range method.",
                    "Rain sensor detects conductive wetness surface only and does not quantify rainfall depth in mm."
                ]
            }

        # Compute diurnal extrema from real observations
        t_min = min(temps)
        t_max = max(temps)
        rh_min = min(humids)
        rh_max = max(humids)
        wind = sum(winds) / len(winds) if winds else 1.5

        result = compute_fao56(t_min, t_max, rh_min, rh_max, wind, elevation=elevation, lat=lat, k_rs=k_rs)
        result["isAvailable"] = True
        result["isSufficient"] = is_sufficient
        result["calculationType"] = "FULL_DAY_DIURNAL_FAO56" if is_sufficient else "INSTANTANEOUS_APPROXIMATION"
        result["sampleCount"] = len(readings)
        result["coverageHours"] = round(time_span_hours, 1)
        result["targetDate"] = target_date
        result["methodLimitations"] = [
            "GY-302 measures lux, not W/m2. Solar radiation Rs estimated via FAO-56 Hargreaves temperature-range method.",
            "Rain sensor detects conductive wetness surface only and does not quantify rainfall depth in mm.",
            "Daily soil heat flux G is assumed to be 0 MJ/m2/day for 24-hr periods."
        ]
        return result
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/crop/demand")
def calculate_crop_demand(payload: CropDemandRequest):
    try:
        fao = get_fao_calculation(allow_instantaneous=True)
        et0 = fao.get("et0") or 4.5
        etc = round(et0 * payload.kc, 2)
        net_liters = round(etc * payload.area_sqm, 1)
        efficiency = max(0.3, min(1.0, payload.efficiency))
        gross_liters = round(net_liters / efficiency, 1)
        flow_rate = max(0.5, payload.pump_flow_rate_lpm)
        runtime_min = round(gross_liters / flow_rate, 1)

        return {
            "et0": et0,
            "kc": payload.kc,
            "etc_mm_day": etc,
            "net_water_liters": net_liters,
            "gross_water_liters": gross_liters,
            "estimated_pump_runtime_minutes": runtime_min,
            "irrigated_area_sqm": payload.area_sqm,
            "application_efficiency": efficiency
        }
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# Prediction Engine
# ------------------------------------------------------------------------------
@router.get("/predictions")
def get_predictions(dry_threshold: float = Query(35.0)):
    try:
        readings = database.get_recent_readings(limit=25)
        valid = [r for r in readings if r.get("soil_moisture_raw") is not None and 10 < int(r["soil_moisture_raw"]) < 4090]

        if len(valid) < 5:
            curr = float(valid[-1]["soil_moisture_percent"]) if valid else 0.0
            return {
                "isAvailable": False,
                "confidence": "UNAVAILABLE",
                "reason": f"Insufficient readings ({len(valid)}/5 samples collected)",
                "currentMoisture": curr,
                "dryingVelocityPerHour": 0.0,
                "projected30Min": curr,
                "projected60Min": curr,
                "hoursUntilDryThreshold": None
            }

        latest = valid[-1]
        curr_m = float(latest["soil_moisture_percent"])

        def parse_ts(ts_val):
            if isinstance(ts_val, datetime):
                return ts_val.timestamp()
            try:
                return datetime.fromisoformat(str(ts_val).replace("Z", "+00:00")).timestamp()
            except Exception:
                return 0.0

        t0 = parse_ts(valid[0]["timestamp"])
        points = []
        for r in valid:
            t_sec = parse_ts(r["timestamp"])
            x_hours = (t_sec - t0) / 3600.0
            y_m = float(r["soil_moisture_percent"])
            points.append((x_hours, y_m))

        n = len(points)
        sum_x = sum(p[0] for p in points)
        sum_y = sum(p[1] for p in points)
        sum_xy = sum(p[0] * p[1] for p in points)
        sum_x2 = sum(p[0] ** 2 for p in points)

        denom = (n * sum_x2 - sum_x ** 2)
        slope = (n * sum_xy - sum_x * sum_y) / denom if abs(denom) > 1e-6 else 0.0

        drying_velocity = max(0.0, round(-slope, 3))
        proj_30 = max(0.0, min(100.0, round(curr_m + (slope * 0.5), 1)))
        proj_60 = max(0.0, min(100.0, round(curr_m + (slope * 1.0), 1)))

        hours_until = None
        if drying_velocity > 0.05 and curr_m > dry_threshold:
            deficit = curr_m - dry_threshold
            hours_until = round(deficit / drying_velocity, 1)

        confidence = "HIGH" if n >= 12 else "MEDIUM" if n >= 8 else "LOW"

        return {
            "isAvailable": True,
            "confidence": confidence,
            "reason": f"Linear trajectory computed from {n} verified telemetry samples",
            "currentMoisture": curr_m,
            "dryingVelocityPerHour": drying_velocity,
            "projected30Min": proj_30,
            "projected60Min": proj_60,
            "hoursUntilDryThreshold": hours_until
        }
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# Consistent Settings Persistence (Defect 4)
# ------------------------------------------------------------------------------
@router.get("/settings")
def get_settings():
    try:
        return database.get_all_settings()
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/settings")
def update_settings(payload: SettingsPayload, _auth=Depends(verify_dashboard_control)):
    try:
        data = payload.model_dump(exclude_unset=True)
        updated = database.update_structured_settings(data)
        return {"status": "saved", "settings": updated}
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# Notifications & Audit
# ------------------------------------------------------------------------------
@router.get("/notifications")
def get_notifications(limit: int = 50):
    try:
        return database.get_notifications(limit=limit)
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/notifications/{notification_id}/acknowledge")
def acknowledge_notif(notification_id: int):
    try:
        success = database.acknowledge_notification(notification_id)
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"status": "acknowledged", "id": notification_id}
    except HTTPException:
        raise
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ------------------------------------------------------------------------------
# CSV Export
# ------------------------------------------------------------------------------
@router.get("/export/csv")
def export_csv():
    try:
        readings = database.get_recent_readings(limit=1000)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "id", "timestamp_iso", "temperature_c", "relative_humidity_percent",
            "soil_moisture_raw_adc", "soil_moisture_calibrated_percent", "barometric_pressure_hpa",
            "wind_speed_ms", "illuminance_lux", "rain_surface_detected", "pump_reported_state",
            "supply_tank_distance_cm", "supply_tank_fill_percent", "supply_tank_sensor_ok",
            "collection_tank_distance_cm", "collection_tank_fill_percent", "collection_tank_sensor_ok", "is_simulated"
        ])
        for r in readings:
            writer.writerow([
                r.get("id"), r.get("timestamp"), r.get("temperature"), r.get("humidity"),
                r.get("soil_moisture_raw"), r.get("soil_moisture_percent"), r.get("pressure"),
                r.get("wind_speed"), r.get("lux"), r.get("rain_detected"), r.get("pump_state"),
                r.get("supply_tank_distance_cm"), r.get("supply_tank_percent"), r.get("supply_tank_sensor_ok"),
                r.get("collection_tank_distance_cm"), r.get("collection_tank_percent"), r.get("collection_tank_sensor_ok"),
                r.get("is_simulated", False)
            ])
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=aquagreen_research_dataset_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"}
        )
    except database.DatabaseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount both with /api prefix and root for universal Vercel/reverse-proxy compatibility
app.include_router(router, prefix="/api")
app.include_router(router)

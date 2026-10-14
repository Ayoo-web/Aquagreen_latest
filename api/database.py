"""
AquaGreen Smart Irrigation System - Universal Production Database Layer
Connects to Supabase PostgreSQL in production or local SQLite for offline development.
Strictly prohibits silent fallback in production environments.
"""

import os
import sqlite3
import json
import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# ------------------------------------------------------------------------------
# Environment & Production Enforcement
# ------------------------------------------------------------------------------
IS_PRODUCTION = bool(
    os.getenv("VERCEL") or 
    os.getenv("ENVIRONMENT") in ("production", "prod") or
    os.getenv("NODE_ENV") == "production"
)

POSTGRES_URL = (
    os.getenv("DATABASE_URL") or 
    os.getenv("SUPABASE_DATABASE_URL") or 
    os.getenv("POSTGRES_URL")
)

IS_POSTGRES = bool(POSTGRES_URL)

SQLITE_DIR = os.path.join(os.path.dirname(__file__), "..", "server", "data")
SQLITE_PATH = os.path.join(SQLITE_DIR, "agriculture.db")

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None

# Custom Exception Classes
class DatabaseError(Exception):
    pass

class DatabaseConnectionError(DatabaseError):
    pass

class DatabaseConfigurationError(DatabaseError):
    pass

def sanitize_url(url: Optional[str]) -> str:
    if not url:
        return ""
    if "@" in url:
        return url.split("@")[-1]
    return url[:12] + "..."

def get_connection():
    """
    Returns an active database connection.
    In production: REQUIRES Supabase PostgreSQL. Never falls back to SQLite silently.
    In development: Uses Supabase PostgreSQL if configured; otherwise uses local SQLite.
    """
    if IS_PRODUCTION:
        if not POSTGRES_URL:
            raise DatabaseConfigurationError(
                "Production environment requires Supabase PostgreSQL. "
                "The DATABASE_URL environment variable is not configured."
            )
        if not psycopg2:
            raise DatabaseConfigurationError(
                "psycopg2-binary is required for production Supabase connection."
            )
        try:
            conn = psycopg2.connect(POSTGRES_URL, connect_timeout=8)
            return conn
        except Exception as e:
            host_info = sanitize_url(POSTGRES_URL)
            raise DatabaseConnectionError(
                f"Failed to connect to production Supabase PostgreSQL ({host_info}): {str(e)}"
            )

    # Local development mode
    if POSTGRES_URL and psycopg2:
        try:
            conn = psycopg2.connect(POSTGRES_URL, connect_timeout=5)
            return conn
        except Exception as e:
            raise DatabaseConnectionError(
                f"Failed to connect to PostgreSQL in development: {str(e)}"
            )
    else:
        os.makedirs(SQLITE_DIR, exist_ok=True)
        conn = sqlite3.connect(SQLITE_PATH, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

def init_db():
    """
    Initializes database tables, constraints, and indexes.
    """
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS readings (
            id BIGSERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            temperature NUMERIC(5, 2) NOT NULL,
            humidity NUMERIC(5, 2) NOT NULL,
            soil_moisture_raw INTEGER NOT NULL,
            soil_moisture_percent NUMERIC(5, 2) NOT NULL,
            pressure NUMERIC(7, 2) NOT NULL,
            wind_speed NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
            lux NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
            rain_detected BOOLEAN NOT NULL DEFAULT FALSE,
            pump_state BOOLEAN NOT NULL DEFAULT FALSE,
            is_soil_fault BOOLEAN NOT NULL DEFAULT FALSE,
            is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
            supply_tank_distance_cm NUMERIC(7, 2),
            supply_tank_percent NUMERIC(5, 2) CHECK (supply_tank_percent IS NULL OR (supply_tank_percent >= 0 AND supply_tank_percent <= 100)),
            supply_tank_sensor_ok BOOLEAN,
            collection_tank_distance_cm NUMERIC(7, 2),
            collection_tank_percent NUMERIC(5, 2) CHECK (collection_tank_percent IS NULL OR (collection_tank_percent >= 0 AND collection_tank_percent <= 100)),
            collection_tank_sensor_ok BOOLEAN,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_reading_timestamp_source UNIQUE (timestamp, is_simulated)
        );
        """)
        # Safe migration for existing Supabase tables; full SQL migration is also provided.
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_distance_cm NUMERIC(7,2);")
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_percent NUMERIC(5,2);")
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS supply_tank_sensor_ok BOOLEAN;")
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_distance_cm NUMERIC(7,2);")
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_percent NUMERIC(5,2);")
        cursor.execute("ALTER TABLE readings ADD COLUMN IF NOT EXISTS collection_tank_sensor_ok BOOLEAN;")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS command_queue (
            id BIGSERIAL PRIMARY KEY,
            command_id VARCHAR(64) UNIQUE NOT NULL,
            command_type VARCHAR(32) NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 300,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            dispatched_at TIMESTAMPTZ,
            acknowledged_at TIMESTAMPTZ,
            dispatch_attempts INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
            ack_state BOOLEAN,
            ack_message TEXT
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS irrigation_events (
            id BIGSERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            event_type VARCHAR(32) NOT NULL,
            trigger_reason TEXT NOT NULL,
            duration_seconds INTEGER DEFAULT 0,
            estimated_volume_liters NUMERIC(8, 2) DEFAULT 0.0,
            soil_moisture_before NUMERIC(5, 2),
            soil_moisture_after NUMERIC(5, 2),
            command_source VARCHAR(32) NOT NULL,
            pump_reported_state BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(64) PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id BIGSERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            severity VARCHAR(16) NOT NULL,
            title VARCHAR(128) NOT NULL,
            message TEXT NOT NULL,
            category VARCHAR(32) NOT NULL,
            acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """)
        conn.commit()
    else:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            temperature REAL NOT NULL,
            humidity REAL NOT NULL,
            soil_moisture_raw INTEGER NOT NULL,
            soil_moisture_percent REAL NOT NULL,
            pressure REAL NOT NULL,
            wind_speed REAL NOT NULL DEFAULT 0.0,
            lux REAL NOT NULL DEFAULT 0.0,
            rain_detected INTEGER NOT NULL DEFAULT 0,
            pump_state INTEGER NOT NULL DEFAULT 0,
            is_soil_fault INTEGER NOT NULL DEFAULT 0,
            is_simulated INTEGER NOT NULL DEFAULT 0,
            supply_tank_distance_cm REAL,
            supply_tank_percent REAL,
            supply_tank_sensor_ok INTEGER,
            collection_tank_distance_cm REAL,
            collection_tank_percent REAL,
            collection_tank_sensor_ok INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(timestamp, is_simulated)
        );
        """)
        # SQLite does not support ADD COLUMN IF NOT EXISTS on every installed version.
        for column_sql in (
            "ALTER TABLE readings ADD COLUMN supply_tank_distance_cm REAL",
            "ALTER TABLE readings ADD COLUMN supply_tank_percent REAL",
            "ALTER TABLE readings ADD COLUMN supply_tank_sensor_ok INTEGER",
            "ALTER TABLE readings ADD COLUMN collection_tank_distance_cm REAL",
            "ALTER TABLE readings ADD COLUMN collection_tank_percent REAL",
            "ALTER TABLE readings ADD COLUMN collection_tank_sensor_ok INTEGER",
        ):
            try:
                cursor.execute(column_sql)
            except Exception:
                pass  # already present
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS command_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            command_id TEXT UNIQUE NOT NULL,
            command_type TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 300,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            dispatched_at TEXT,
            acknowledged_at TEXT,
            dispatch_attempts INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING',
            ack_state INTEGER,
            ack_message TEXT
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS irrigation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            trigger_reason TEXT NOT NULL,
            duration_seconds INTEGER DEFAULT 0,
            estimated_volume_liters REAL DEFAULT 0.0,
            soil_moisture_before REAL,
            soil_moisture_after REAL,
            command_source TEXT NOT NULL,
            pump_reported_state INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            category TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """)
        # Safe schema migration for existing SQLite databases
        try:
            cursor.execute("ALTER TABLE command_queue ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0;")
        except Exception:
            pass
        conn.commit()

    conn.close()

# ------------------------------------------------------------------------------
# Default Settings
# ------------------------------------------------------------------------------
DEFAULT_SETTINGS: Dict[str, Dict[str, Any]] = {
    "calibration": {
        "soilDryAdc": 3200,
        "soilWetAdc": 1400,
        "latitude": 14.5995,
        "elevation": 25.0,
        "anemometerHeight": 1.0,
        "anemometerFactor": 0.0875,
        "kRs": 0.16,
        "pumpFlowRate": 12.0,
        "relayActiveLow": True
    },
    "automation": {
        "enabled": True,
        "mode": "AUTO",
        "dryThresholdPercent": 35,
        "targetWetPercent": 65,
        "maxRuntimeMinutes": 15,
        "minIntervalHours": 4,
        "cooldownMinutes": 30,
        "rainInhibitionEnabled": True,
        "dailyMaxVolumeLiters": 150,
        "emergencyStop": False
    },
    "crop": {
        "cropName": "Generic Research Crop",
        "stage": "mid",
        "kcInitial": 0.50,
        "kcMid": 1.05,
        "kcEnd": 0.65,
        "irrigatedAreaSqM": 20.0,
        "irrigationEfficiency": 0.85
    },
    "waterTanks": {
        "supplyLowThresholdPercent": 20,
        "collectionHighThresholdPercent": 90,
        "alertHysteresisPercent": 5
    }
}

# ------------------------------------------------------------------------------
# Readings CRUD
# ------------------------------------------------------------------------------
def insert_reading(data: Dict[str, Any]) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)

    # Timestamp handling: Use provided hardware/RTC timestamp or server UTC
    raw_ts = data.get("timestamp") or data.get("rtcTimestamp")
    if not raw_ts:
        ts = datetime.utcnow().isoformat()
    elif isinstance(raw_ts, datetime):
        ts = raw_ts.isoformat()
    else:
        ts = str(raw_ts)

    # Strictly enforce boolean is_simulated
    is_sim = bool(data.get("isSimulated", False) or data.get("is_simulated", False))

    if is_pg:
        query = """
        INSERT INTO readings (
            timestamp, temperature, humidity, soil_moisture_raw, soil_moisture_percent,
            pressure, wind_speed, lux, rain_detected, pump_state, is_soil_fault, is_simulated,
            supply_tank_distance_cm, supply_tank_percent, supply_tank_sensor_ok,
            collection_tank_distance_cm, collection_tank_percent, collection_tank_sensor_ok
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (timestamp, is_simulated) DO NOTHING
        RETURNING id;
        """
        cursor.execute(query, (
            ts,
            float(data.get("temperature", 0.0)),
            float(data.get("humidity", 0.0)),
            int(data.get("soilMoistureRaw", data.get("soil_moisture_raw", 0))),
            float(data.get("soilMoisturePercent", data.get("soil_moisture_percent", 0.0))),
            float(data.get("pressure", 1013.25)),
            float(data.get("windSpeed", data.get("wind_speed", 0.0))),
            float(data.get("lux", 0.0)),
            bool(data.get("rainDetected", data.get("rain_detected", False))),
            bool(data.get("pumpState", data.get("pump_state", False))),
            bool(data.get("isSoilFault", data.get("is_soil_fault", False))),
            is_sim,
            float(data["supplyTankDistanceCm"]) if data.get("supplyTankDistanceCm") is not None else None,
            float(data["supplyTankPercent"]) if data.get("supplyTankPercent") is not None else None,
            bool(data["supplyTankSensorOk"]) if data.get("supplyTankSensorOk") is not None else None,
            float(data["collectionTankDistanceCm"]) if data.get("collectionTankDistanceCm") is not None else None,
            float(data["collectionTankPercent"]) if data.get("collectionTankPercent") is not None else None,
            bool(data["collectionTankSensorOk"]) if data.get("collectionTankSensorOk") is not None else None
        ))
        row = cursor.fetchone()
        row_id = row[0] if row else 0
    else:
        query = """
        INSERT OR IGNORE INTO readings (
            timestamp, temperature, humidity, soil_moisture_raw, soil_moisture_percent,
            pressure, wind_speed, lux, rain_detected, pump_state, is_soil_fault, is_simulated,
            supply_tank_distance_cm, supply_tank_percent, supply_tank_sensor_ok,
            collection_tank_distance_cm, collection_tank_percent, collection_tank_sensor_ok
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        );
        """
        cursor.execute(query, (
            ts,
            float(data.get("temperature", 0.0)),
            float(data.get("humidity", 0.0)),
            int(data.get("soilMoistureRaw", data.get("soil_moisture_raw", 0))),
            float(data.get("soilMoisturePercent", data.get("soil_moisture_percent", 0.0))),
            float(data.get("pressure", 1013.25)),
            float(data.get("windSpeed", data.get("wind_speed", 0.0))),
            float(data.get("lux", 0.0)),
            1 if data.get("rainDetected", data.get("rain_detected", False)) else 0,
            1 if data.get("pumpState", data.get("pump_state", False)) else 0,
            1 if data.get("isSoilFault", data.get("is_soil_fault", False)) else 0,
            1 if is_sim else 0,
            float(data["supplyTankDistanceCm"]) if data.get("supplyTankDistanceCm") is not None else None,
            float(data["supplyTankPercent"]) if data.get("supplyTankPercent") is not None else None,
            (1 if data["supplyTankSensorOk"] else 0) if data.get("supplyTankSensorOk") is not None else None,
            float(data["collectionTankDistanceCm"]) if data.get("collectionTankDistanceCm") is not None else None,
            float(data["collectionTankPercent"]) if data.get("collectionTankPercent") is not None else None,
            (1 if data["collectionTankSensorOk"] else 0) if data.get("collectionTankSensorOk") is not None else None
        ))
        row_id = cursor.lastrowid or 0

    conn.commit()
    conn.close()
    return row_id

def get_latest_reading(include_simulated: bool = True) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    sim_filter_pg = "" if include_simulated else "WHERE is_simulated = FALSE"
    sim_filter_sqlite = "" if include_simulated else "WHERE is_simulated = 0"

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(f"SELECT * FROM readings {sim_filter_pg} ORDER BY id DESC LIMIT 1")
    else:
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM readings {sim_filter_sqlite} ORDER BY id DESC LIMIT 1")

    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    if isinstance(res.get("timestamp"), datetime):
        res["timestamp"] = res["timestamp"].isoformat()
    return res

def get_recent_readings(limit: int = 50, include_simulated: bool = True) -> List[Dict[str, Any]]:
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    sim_filter_pg = "" if include_simulated else "WHERE is_simulated = FALSE"
    sim_filter_sqlite = "" if include_simulated else "WHERE is_simulated = 0"

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(f"SELECT * FROM readings {sim_filter_pg} ORDER BY id DESC LIMIT %s", (limit,))
    else:
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM readings {sim_filter_sqlite} ORDER BY id DESC LIMIT ?", (limit,))

    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in reversed(rows):
        item = dict(r)
        if isinstance(item.get("timestamp"), datetime):
            item["timestamp"] = item["timestamp"].isoformat()
        res.append(item)
    return res

def get_readings_by_day(date_str: str, include_simulated: bool = False) -> List[Dict[str, Any]]:
    """
    Retrieves readings for a specific date (YYYY-MM-DD) for scientific daily aggregation.
    Defaults to genuine physical records only (include_simulated=False).
    """
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    start_ts = f"{date_str}T00:00:00Z"
    end_ts = f"{date_str}T23:59:59Z"

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        sim_cond = "AND is_simulated = FALSE" if not include_simulated else ""
        cursor.execute(f"""
            SELECT * FROM readings 
            WHERE timestamp >= %s AND timestamp <= %s {sim_cond}
            ORDER BY timestamp ASC
        """, (start_ts, end_ts))
    else:
        cursor = conn.cursor()
        sim_cond = "AND is_simulated = 0" if not include_simulated else ""
        cursor.execute(f"""
            SELECT * FROM readings 
            WHERE timestamp >= ? AND timestamp <= ? {sim_cond}
            ORDER BY timestamp ASC
        """, (start_ts, end_ts))

    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in rows:
        item = dict(r)
        if isinstance(item.get("timestamp"), datetime):
            item["timestamp"] = item["timestamp"].isoformat()
        res.append(item)
    return res

# ------------------------------------------------------------------------------
# Command Queue Operations (ESP32 Remote Command Lifecycle)
# ------------------------------------------------------------------------------
def queue_command(command_type: str, duration_seconds: int = 300, ttl_seconds: int = 120) -> Dict[str, Any]:
    """
    Queues a command for ESP32 execution.
    - Prevents duplicates if identical command is already pending.
    - Supersedes opposing pending commands (e.g., EMERGENCY_STOP supersedes PUMP_ON).
    """
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)

    now = datetime.utcnow()
    expires_at = now + timedelta(seconds=ttl_seconds)
    now_iso = now.isoformat()
    expires_iso = expires_at.isoformat()
    cmd_type_upper = command_type.upper()

    # Expire old pending commands
    if is_pg:
        cursor.execute("UPDATE command_queue SET status = 'EXPIRED' WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at < %s", (now_iso,))
    else:
        cursor.execute("UPDATE command_queue SET status = 'EXPIRED' WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at < ?", (now_iso,))

    # Check for identical active pending command (duplicate prevention)
    if is_pg:
        cursor.execute("""
            SELECT * FROM command_queue 
            WHERE status = 'PENDING' AND command_type = %s AND expires_at >= %s
            ORDER BY id DESC LIMIT 1
        """, (cmd_type_upper, now_iso))
    else:
        cursor.execute("""
            SELECT * FROM command_queue 
            WHERE status = 'PENDING' AND command_type = ? AND expires_at >= ?
            ORDER BY id DESC LIMIT 1
        """, (cmd_type_upper, now_iso))

    existing = cursor.fetchone()
    if existing:
        conn.close()
        return dict(existing)

    # Cancel/supersede conflicting pending commands
    if cmd_type_upper == "EMERGENCY_STOP":
        if is_pg:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING'", ())
        else:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING'", ())
    elif cmd_type_upper == "PUMP_OFF":
        if is_pg:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING' AND command_type = 'PUMP_ON'", ())
        else:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING' AND command_type = 'PUMP_ON'", ())
    elif cmd_type_upper == "PUMP_ON":
        if is_pg:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING' AND command_type = 'PUMP_OFF'", ())
        else:
            cursor.execute("UPDATE command_queue SET status = 'SUPERSEDED' WHERE status = 'PENDING' AND command_type = 'PUMP_OFF'", ())

    cmd_id = f"cmd_{uuid.uuid4().hex[:12]}"

    if is_pg:
        cursor.execute("""
        INSERT INTO command_queue (command_id, command_type, duration_seconds, created_at, expires_at, status, dispatch_attempts)
        VALUES (%s, %s, %s, %s, %s, 'PENDING', 0);
        """, (cmd_id, cmd_type_upper, duration_seconds, now_iso, expires_iso))
    else:
        cursor.execute("""
        INSERT INTO command_queue (command_id, command_type, duration_seconds, created_at, expires_at, status, dispatch_attempts)
        VALUES (?, ?, ?, ?, ?, 'PENDING', 0);
        """, (cmd_id, cmd_type_upper, duration_seconds, now_iso, expires_iso))

    conn.commit()
    conn.close()

    return {
        "command_id": cmd_id,
        "command_type": cmd_type_upper,
        "duration_seconds": duration_seconds,
        "created_at": now_iso,
        "expires_at": expires_iso,
        "status": "PENDING"
    }

def peek_active_command() -> Optional[Dict[str, Any]]:
    """
    Inspects active command without mutating its status.
    Called by /api/pump/status so dashboard polling NEVER consumes or dispatches commands!
    """
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)
    now_iso = datetime.utcnow().isoformat()

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT * FROM command_queue 
            WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at >= %s 
            ORDER BY id ASC LIMIT 1
        """, (now_iso,))
    else:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM command_queue 
            WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at >= ? 
            ORDER BY id ASC LIMIT 1
        """, (now_iso,))

    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    if isinstance(res.get("created_at"), datetime):
        res["created_at"] = res["created_at"].isoformat()
    if isinstance(res.get("expires_at"), datetime):
        res["expires_at"] = res["expires_at"].isoformat()
    return res

def claim_pending_command_for_esp32() -> Optional[Dict[str, Any]]:
    """
    Claims and dispatches a pending command.
    ONLY called by authenticated ESP32 requests.
    Supports retrying unacknowledged commands after 20 seconds.
    """
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)
    now = datetime.utcnow()
    now_iso = now.isoformat()
    retry_cutoff = (now - timedelta(seconds=20)).isoformat()

    # 1. Mark expired commands
    if is_pg:
        cursor.execute("UPDATE command_queue SET status = 'EXPIRED' WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at < %s", (now_iso,))
    else:
        cursor.execute("UPDATE command_queue SET status = 'EXPIRED' WHERE status IN ('PENDING', 'DISPATCHED') AND expires_at < ?", (now_iso,))

    # 2. Select oldest PENDING, or DISPATCHED needing retry
    if is_pg:
        cur_dict = conn.cursor(cursor_factory=RealDictCursor)
        cur_dict.execute("""
            SELECT * FROM command_queue 
            WHERE (
                (status = 'PENDING') OR 
                (status = 'DISPATCHED' AND dispatched_at < %s AND dispatch_attempts < 3)
            )
            AND expires_at >= %s 
            ORDER BY id ASC LIMIT 1
        """, (retry_cutoff, now_iso))
        row = cur_dict.fetchone()
    else:
        cursor.execute("""
            SELECT * FROM command_queue 
            WHERE (
                (status = 'PENDING') OR 
                (status = 'DISPATCHED' AND dispatched_at < ? AND dispatch_attempts < 3)
            )
            AND expires_at >= ? 
            ORDER BY id ASC LIMIT 1
        """, (retry_cutoff, now_iso))
        row = cursor.fetchone()

    if row:
        cmd = dict(row)
        attempts = cmd.get("dispatch_attempts", 0) + 1
        if is_pg:
            cursor.execute("""
                UPDATE command_queue 
                SET status = 'DISPATCHED', dispatched_at = %s, dispatch_attempts = %s
                WHERE command_id = %s
            """, (now_iso, attempts, cmd["command_id"]))
        else:
            cursor.execute("""
                UPDATE command_queue 
                SET status = 'DISPATCHED', dispatched_at = ?, dispatch_attempts = ?
                WHERE command_id = ?
            """, (now_iso, attempts, cmd["command_id"]))

        conn.commit()
        conn.close()
        cmd["status"] = "DISPATCHED"
        cmd["dispatch_attempts"] = attempts
        if isinstance(cmd.get("created_at"), datetime):
            cmd["created_at"] = cmd["created_at"].isoformat()
        if isinstance(cmd.get("expires_at"), datetime):
            cmd["expires_at"] = cmd["expires_at"].isoformat()
        return cmd

    conn.commit()
    conn.close()
    return None

# Backwards compatibility alias for existing test suite
get_active_pending_command = claim_pending_command_for_esp32

def acknowledge_command(command_id: str, actual_state: bool, success: bool = True, ack_message: str = "") -> bool:
    """
    Records physical ESP32 relay confirmation on GPIO17.
    Idempotent: succeeding on already acknowledged commands.
    """
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)
    now_iso = datetime.utcnow().isoformat()
    status = "ACKNOWLEDGED" if success else "REJECTED"

    if is_pg:
        cursor.execute("""
        UPDATE command_queue 
        SET status = %s, acknowledged_at = %s, ack_state = %s, ack_message = %s
        WHERE command_id = %s AND status IN ('DISPATCHED', 'PENDING', 'ACKNOWLEDGED')
        """, (status, now_iso, actual_state, ack_message, command_id))
    else:
        cursor.execute("""
        UPDATE command_queue 
        SET status = ?, acknowledged_at = ?, ack_state = ?, ack_message = ?
        WHERE command_id = ? AND status IN ('DISPATCHED', 'PENDING', 'ACKNOWLEDGED')
        """, (status, now_iso, 1 if actual_state else 0, ack_message, command_id))

    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated

def get_command_by_id(command_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM command_queue WHERE command_id = %s", (command_id,))
    else:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM command_queue WHERE command_id = ?", (command_id,))

    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    res = dict(row)
    if isinstance(res.get("created_at"), datetime):
        res["created_at"] = res["created_at"].isoformat()
    if isinstance(res.get("expires_at"), datetime):
        res["expires_at"] = res["expires_at"].isoformat()
    return res

# ------------------------------------------------------------------------------
# Consistent Settings Persistence (Calibration, Automation, Crop)
# ------------------------------------------------------------------------------
def get_all_settings() -> Dict[str, Any]:
    """
    Retrieves all settings, returning a consistent schema:
    { "calibration": {...}, "automation": {...}, "crop": {...} }
    """
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT key, value FROM settings")
    else:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM settings")

    rows = cursor.fetchall()
    conn.close()

    raw_data = {}
    for r in rows:
        key = r["key"]
        val = r["value"]
        if isinstance(val, (dict, list)):
            raw_data[key] = val
        else:
            try:
                raw_data[key] = json.loads(val)
            except Exception:
                raw_data[key] = val

    # Merge with default schema
    merged = {
        "calibration": {**DEFAULT_SETTINGS["calibration"], **(raw_data.get("calibration") if isinstance(raw_data.get("calibration"), dict) else {})},
        "automation": {**DEFAULT_SETTINGS["automation"], **(raw_data.get("automation") if isinstance(raw_data.get("automation"), dict) else {})},
        "crop": {**DEFAULT_SETTINGS["crop"], **(raw_data.get("crop") if isinstance(raw_data.get("crop"), dict) else {})},
        "waterTanks": {**DEFAULT_SETTINGS["waterTanks"], **(raw_data.get("waterTanks") if isinstance(raw_data.get("waterTanks"), dict) else {})}
    }

    # Also fold in any legacy top-level keys
    for k, v in raw_data.items():
        if k in merged["calibration"]:
            merged["calibration"][k] = v
        elif k in merged["automation"]:
            merged["automation"][k] = v
        elif k in merged["crop"]:
            merged["crop"][k] = v
        elif k not in ("calibration", "automation", "crop", "waterTanks"):
            merged[k] = v

    return merged

def save_setting(key: str, value: Any) -> None:
    """
    Persists a single key into settings.
    """
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)
    val_str = json.dumps(value) if not isinstance(value, str) else value

    if is_pg:
        cursor.execute("""
        INSERT INTO settings (key, value, updated_at) VALUES (%s, %s::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
        """, (key, val_str))
    else:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, val_str))

    conn.commit()
    conn.close()

def get_setting(key: str, default: Any = None) -> Any:
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
    else:
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))

    row = cursor.fetchone()
    conn.close()
    if not row:
        return default
    val = row[0] if isinstance(row, tuple) else row["value"]
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return val

def update_structured_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Intelligently persists nested or flat settings updates to ensure
    consistent 'calibration', 'automation', and 'crop' records in Supabase.
    """
    current = get_all_settings()

    # 1. Update nested groups if provided
    if "calibration" in payload and isinstance(payload["calibration"], dict):
        current["calibration"].update(payload["calibration"])
    if "automation" in payload and isinstance(payload["automation"], dict):
        current["automation"].update(payload["automation"])
    if "crop" in payload and isinstance(payload["crop"], dict):
        current["crop"].update(payload["crop"])
    if "waterTanks" in payload and isinstance(payload["waterTanks"], dict):
        current["waterTanks"].update(payload["waterTanks"])

    # 2. Route any flat properties to their respective category
    for k, v in payload.items():
        if k in ("calibration", "automation", "crop", "waterTanks"):
            continue
        if k in current["calibration"]:
            current["calibration"][k] = v
        elif k in current["automation"]:
            current["automation"][k] = v
        elif k in current["crop"]:
            current["crop"][k] = v
        elif k in current["waterTanks"]:
            current["waterTanks"][k] = v
        else:
            # Store miscellaneous keys directly
            save_setting(k, v)

    # Persist the canonical categories
    save_setting("calibration", current["calibration"])
    save_setting("automation", current["automation"])
    save_setting("crop", current["crop"])
    save_setting("waterTanks", current["waterTanks"])

    return current

# ------------------------------------------------------------------------------
# Irrigation Events & Notifications
# ------------------------------------------------------------------------------
def insert_event(data: Dict[str, Any]) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)
    ts = data.get("timestamp") or datetime.utcnow().isoformat()

    if is_pg:
        cursor.execute("""
        INSERT INTO irrigation_events (
            timestamp, event_type, trigger_reason, duration_seconds, estimated_volume_liters,
            soil_moisture_before, soil_moisture_after, command_source, pump_reported_state
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) RETURNING id;
        """, (
            ts,
            data.get("eventType", "STATUS"),
            data.get("triggerReason", "Routine"),
            int(data.get("durationSeconds", 0)),
            float(data.get("estimatedVolumeLiters", 0.0)),
            data.get("soilMoistureBefore"),
            data.get("soilMoistureAfter"),
            data.get("commandSource", "UNKNOWN"),
            bool(data.get("pumpReportedState", False))
        ))
        row = cursor.fetchone()
        row_id = row[0] if row else 1
    else:
        cursor.execute("""
        INSERT INTO irrigation_events (
            timestamp, event_type, trigger_reason, duration_seconds, estimated_volume_liters,
            soil_moisture_before, soil_moisture_after, command_source, pump_reported_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            ts,
            data.get("eventType", "STATUS"),
            data.get("triggerReason", "Routine"),
            int(data.get("durationSeconds", 0)),
            float(data.get("estimatedVolumeLiters", 0.0)),
            data.get("soilMoistureBefore"),
            data.get("soilMoistureAfter"),
            data.get("commandSource", "UNKNOWN"),
            1 if data.get("pumpReportedState", False) else 0
        ))
        row_id = cursor.lastrowid or 1

    conn.commit()
    conn.close()
    return row_id

def get_recent_events(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM irrigation_events ORDER BY id DESC LIMIT %s", (limit,))
    else:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM irrigation_events ORDER BY id DESC LIMIT ?", (limit,))

    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in rows:
        item = dict(r)
        if isinstance(item.get("timestamp"), datetime):
            item["timestamp"] = item["timestamp"].isoformat()
        res.append(item)
    return res

def insert_notification(title: str, message: str, severity: str = "INFO", category: str = "SYSTEM") -> int:
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)
    ts = datetime.utcnow().isoformat()

    if is_pg:
        cursor.execute("""
        INSERT INTO notifications (timestamp, severity, title, message, category, acknowledged)
        VALUES (%s, %s, %s, %s, %s, FALSE)
        RETURNING id;
        """, (ts, severity, title, message, category))
        row = cursor.fetchone()
        row_id = row[0] if row else 1
    else:
        cursor.execute("""
        INSERT INTO notifications (timestamp, severity, title, message, category, acknowledged)
        VALUES (?, ?, ?, ?, ?, 0)
        """, (ts, severity, title, message, category))
        row_id = cursor.lastrowid or 1

    conn.commit()
    conn.close()
    return row_id

def get_notifications(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT %s", (limit,))
    else:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT ?", (limit,))

    rows = cursor.fetchall()
    conn.close()
    res = []
    for r in rows:
        item = dict(r)
        if isinstance(item.get("timestamp"), datetime):
            item["timestamp"] = item["timestamp"].isoformat()
        res.append(item)
    return res

def acknowledge_notification(notification_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    is_pg = not isinstance(conn, sqlite3.Connection)

    if is_pg:
        cursor.execute("UPDATE notifications SET acknowledged = TRUE WHERE id = %s", (notification_id,))
    else:
        cursor.execute("UPDATE notifications SET acknowledged = 1 WHERE id = ?", (notification_id,))

    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated

# Initialize default SQLite schema in development
if not IS_PRODUCTION:
    try:
        init_db()
    except Exception as e:
        print(f"[WARN] Local init_db error: {e}")

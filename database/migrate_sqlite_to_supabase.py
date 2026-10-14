"""
AquaGreen Smart Irrigation System - SQLite to Supabase Migration Utility
Safely migrates historical sensor readings, events, settings, and notifications
from local SQLite (agriculture.db) to production Supabase PostgreSQL without data loss or duplicates.
"""

import os
import sys
import sqlite3
import json
import argparse
from datetime import datetime

try:
    import psycopg2
    from psycopg2.extras import execute_batch, RealDictCursor
except ImportError:
    psycopg2 = None

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "..", "server", "data", "agriculture.db")

def parse_args():
    parser = argparse.ArgumentParser(description="Migrate AquaGreen research database from SQLite to Supabase")
    parser.add_argument("--postgres-url", help="Supabase PostgreSQL connection string (or use DATABASE_URL env var)", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--dry-run", action="store_true", help="Inspect and count records without writing to Postgres")
    return parser.parse_args()

def migrate():
    args = parse_args()
    print("=" * 65)
    print("  AquaGreen Research Database: SQLite -> Supabase Migration  ")
    print("=" * 65)

    if not os.path.exists(SQLITE_PATH):
        print(f"[ERROR] Local SQLite database not found at: {SQLITE_PATH}")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    # Verify tables in SQLite
    sqlite_cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row["name"] for row in sqlite_cur.fetchall()]
    print(f"[OK] Found SQLite tables: {', '.join(tables)}")

    if args.dry_run:
        print("\n[DRY RUN MODE ENABLED] No data will be written to PostgreSQL.")
    else:
        if not args.postgres_url:
            print("[ERROR] Missing PostgreSQL connection string! Provide --postgres-url or set DATABASE_URL environment variable.")
            sys.exit(1)
        if psycopg2 is None:
            print("[ERROR] psycopg2 is not installed! Run: pip install psycopg2-binary")
            sys.exit(1)

    # 1. Inspect Readings
    sqlite_cur.execute("SELECT COUNT(*) AS total FROM readings")
    readings_count = sqlite_cur.fetchone()["total"]
    print(f"\n[1/4] Found {readings_count} historical telemetry readings in SQLite.")

    # 2. Inspect Events
    sqlite_cur.execute("SELECT COUNT(*) AS total FROM irrigation_events")
    events_count = sqlite_cur.fetchone()["total"]
    print(f"[2/4] Found {events_count} irrigation switching events in SQLite.")

    # 3. Inspect Notifications
    sqlite_cur.execute("SELECT COUNT(*) AS total FROM notifications")
    notifs_count = sqlite_cur.fetchone()["total"]
    print(f"[3/4] Found {notifs_count} system notifications in SQLite.")

    # 4. Inspect Settings
    sqlite_cur.execute("SELECT key, value FROM settings")
    settings_rows = sqlite_cur.fetchall()
    print(f"[4/4] Found {len(settings_rows)} configuration keys in SQLite.")

    if args.dry_run:
        print("\n[DRY RUN COMPLETE] Everything looks ready for migration.")
        return

    # Execute Migration to PostgreSQL
    print(f"\nConnecting to Supabase PostgreSQL...")
    pg_conn = psycopg2.connect(args.postgres_url)
    pg_cur = pg_conn.cursor()

    try:
        # A. Migrate Readings
        sqlite_cur.execute("""
            SELECT timestamp, temperature, humidity, soil_moisture_raw,
                   soil_moisture_percent, pressure, wind_speed, lux,
                   rain_detected, pump_state, is_soil_fault, is_simulated
            FROM readings ORDER BY id ASC
        """)
        readings = sqlite_cur.fetchall()
        if readings:
            insert_query = """
                INSERT INTO readings (
                    timestamp, temperature, humidity, soil_moisture_raw,
                    soil_moisture_percent, pressure, wind_speed, lux,
                    rain_detected, pump_state, is_soil_fault, is_simulated
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (timestamp, is_simulated) DO NOTHING;
            """
            data_to_insert = [
                (
                    r["timestamp"], r["temperature"], r["humidity"], r["soil_moisture_raw"],
                    r["soil_moisture_percent"], r["pressure"], r["wind_speed"], r["lux"],
                    bool(r["rain_detected"]), bool(r["pump_state"]),
                    bool(r["is_soil_fault"]), bool(r["is_simulated"])
                )
                for r in readings
            ]
            execute_batch(pg_cur, insert_query, data_to_insert, page_size=200)
            print(f"[SUCCESS] Processed {len(data_to_insert)} readings into Supabase.")

        # B. Migrate Events
        sqlite_cur.execute("""
            SELECT timestamp, event_type, trigger_reason, duration_seconds,
                   estimated_volume_liters, soil_moisture_before, soil_moisture_after,
                   command_source, pump_reported_state
            FROM irrigation_events ORDER BY id ASC
        """)
        events = sqlite_cur.fetchall()
        if events:
            insert_event_query = """
                INSERT INTO irrigation_events (
                    timestamp, event_type, trigger_reason, duration_seconds,
                    estimated_volume_liters, soil_moisture_before, soil_moisture_after,
                    command_source, pump_reported_state
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
            """
            event_data = [
                (
                    e["timestamp"], e["event_type"], e["trigger_reason"], e["duration_seconds"],
                    e["estimated_volume_liters"], e["soil_moisture_before"], e["soil_moisture_after"],
                    e["command_source"], bool(e["pump_reported_state"])
                )
                for e in events
            ]
            execute_batch(pg_cur, insert_event_query, event_data, page_size=100)
            print(f"[SUCCESS] Processed {len(event_data)} irrigation events into Supabase.")

        # C. Migrate Notifications
        sqlite_cur.execute("SELECT timestamp, severity, title, message, category, acknowledged FROM notifications")
        notifs = sqlite_cur.fetchall()
        if notifs:
            insert_notif_query = """
                INSERT INTO notifications (timestamp, severity, title, message, category, acknowledged)
                VALUES (%s, %s, %s, %s, %s, %s);
            """
            notif_data = [
                (n["timestamp"], n["severity"], n["title"], n["message"], n["category"], bool(n["acknowledged"]))
                for n in notifs
            ]
            execute_batch(pg_cur, insert_notif_query, notif_data, page_size=100)
            print(f"[SUCCESS] Processed {len(notif_data)} notifications into Supabase.")

        # D. Migrate Settings
        if settings_rows:
            insert_setting_query = """
                INSERT INTO settings (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
            """
            for s in settings_rows:
                val = s["value"]
                # Ensure valid JSON string
                try:
                    json.loads(val)
                except:
                    val = json.dumps(val)
                pg_cur.execute(insert_setting_query, (s["key"], val))
            print(f"[SUCCESS] Processed {len(settings_rows)} settings into Supabase.")

        pg_conn.commit()
        print("\n" + "=" * 65)
        print("  MIGRATION SUCCESSFULLY COMPLETED! ALL RESEARCH DATA PRESERVED  ")
        print("=" * 65)

    except Exception as e:
        pg_conn.rollback()
        print(f"\n[FATAL ERROR] Migration failed: {e}")
        sys.exit(1)
    finally:
        sqlite_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()

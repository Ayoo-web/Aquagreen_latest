"""
AquaGreen Smart Irrigation System - Database Module (Canonical Re-export)
Re-exports the universal production database layer from api.database,
providing seamless unified support for Supabase PostgreSQL and local SQLite.
"""

import sys
import os

# Ensure project root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.database import (
    get_connection,
    init_db,
    insert_reading,
    get_latest_reading,
    get_recent_readings,
    insert_event,
    get_recent_events,
    queue_command,
    get_active_pending_command,
    acknowledge_command,
    get_command_by_id,
    save_setting,
    get_setting,
    get_all_settings,
    insert_notification,
    get_notifications,
    acknowledge_notification,
    IS_POSTGRES,
    SQLITE_PATH
)

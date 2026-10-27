import sqlite3
import os
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.core.config import settings

DB_PATH = settings.DATABASE_URL.replace("sqlite:///", "")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create tables
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        phone_number TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fcm_token TEXT NOT NULL,
        platform TEXT DEFAULT 'android',
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guardian_invites (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        note TEXT,
        expires_at TIMESTAMP NOT NULL,
        accepted_by TEXT,
        used_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guardian_links (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        guardian_id TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        consented_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP,
        UNIQUE(owner_id, guardian_id)
    );

    CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        client_event_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        alert_status TEXT NOT NULL DEFAULT 'queued',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TIMESTAMP,
        resolved_at TIMESTAMP,
        latitude REAL,
        longitude REAL,
        accuracy_m REAL,
        UNIQUE(owner_id, client_event_id)
    );

    CREATE TABLE IF NOT EXISTS incident_locations (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy_m REAL,
        captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alert_jobs (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        guardian_id TEXT NOT NULL,
        channel TEXT DEFAULT 'fcm',
        stage INTEGER DEFAULT 1,
        state TEXT DEFAULT 'queued',
        provider_ref TEXT,
        attempt_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS acknowledgements (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        guardian_id TEXT NOT NULL,
        note TEXT,
        acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(incident_id, guardian_id)
    );

    CREATE TABLE IF NOT EXISTS journeys (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        destination_label TEXT NOT NULL,
        eta_at TIMESTAMP NOT NULL,
        grace_seconds INTEGER DEFAULT 300,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Seed default user and guardian if not exists
    cursor.execute("SELECT COUNT(*) FROM profiles WHERE id = ?", (settings.DEFAULT_USER_ID,))
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO profiles (id, email, display_name, phone_number) VALUES (?, ?, ?, ?)",
            (settings.DEFAULT_USER_ID, "victim@sheildai.org", "Safety App User", "+919876543210")
        )

    cursor.execute("SELECT COUNT(*) FROM profiles WHERE id = ?", (settings.DEFAULT_GUARDIAN_ID,))
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO profiles (id, email, display_name, phone_number) VALUES (?, ?, ?, ?)",
            (settings.DEFAULT_GUARDIAN_ID, "guardian@sheildai.org", "Primary Guardian", "+919123456789")
        )

    # Seed default guardian link
    cursor.execute(
        "INSERT OR IGNORE INTO guardian_links (id, owner_id, guardian_id, priority) VALUES (?, ?, ?, ?)",
        ("link-1", settings.DEFAULT_USER_ID, settings.DEFAULT_GUARDIAN_ID, 1)
    )

    conn.commit()
    conn.close()

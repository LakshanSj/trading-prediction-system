"""
admin_logger.py — Centralized structured activity logger for the Trading Prediction System.

Writes JSON-lines activity log to: logs/admin_activity.jsonl
Each log entry contains: timestamp, event_type, user, details, ip_address, success flag.
"""

import os
import json
import threading
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────────────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LOG_DIR      = os.path.join(PROJECT_ROOT, 'logs')
LOG_FILE     = os.path.join(LOG_DIR, 'admin_activity.jsonl')

# Thread-safe write lock
_lock = threading.Lock()

# ── Event type constants ─────────────────────────────────────────────────────
class EventType:
    ADMIN_LOGIN       = "ADMIN_LOGIN"
    ADMIN_LOGIN_FAIL  = "ADMIN_LOGIN_FAIL"
    ADMIN_LOGOUT      = "ADMIN_LOGOUT"
    TRAIN_START       = "TRAIN_START"
    TRAIN_COMPLETE    = "TRAIN_COMPLETE"
    TRAIN_FAILED      = "TRAIN_FAILED"
    PREDICT_FETCH     = "PREDICT_FETCH"
    EXPLAIN_FETCH     = "EXPLAIN_FETCH"
    WFV_RUN           = "WFV_RUN"
    MONITOR_RUN       = "MONITOR_RUN"
    LOGS_CLEARED      = "LOGS_CLEARED"
    SYSTEM_START      = "SYSTEM_START"
    TICKER_STATUS     = "TICKER_STATUS"

# ── Core writer ──────────────────────────────────────────────────────────────
def write_log(
    event_type: str,
    details: dict,
    user: str = "system",
    ip_address: str = "unknown",
    success: bool = True
) -> dict:
    """
    Write one structured log entry to the JSONL log file.
    Returns the entry dict so callers can forward it.
    """
    os.makedirs(LOG_DIR, exist_ok=True)

    entry = {
        "id": _generate_id(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "timestamp_local": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "event_type": event_type,
        "user": user,
        "ip_address": ip_address,
        "success": success,
        "details": details
    }

    with _lock:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')

    return entry


def read_logs(limit: int = 500, event_filter: str = None) -> list:
    """
    Read all log entries from the JSONL file.
    Returns a list of dicts, newest-first.
    Optionally filter by event_type prefix.
    """
    if not os.path.exists(LOG_FILE):
        return []

    entries = []
    with _lock:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if event_filter and event_type_filter(entry.get('event_type', ''), event_filter):
                        continue
                    entries.append(entry)
                except json.JSONDecodeError:
                    continue

    # Newest first, capped at limit
    entries.reverse()
    return entries[:limit]


def event_type_filter(event_type: str, filter_str: str) -> bool:
    """Returns True if entry should be EXCLUDED (doesn't match filter)."""
    if filter_str.lower() == 'all':
        return False
    return not event_type.lower().startswith(filter_str.lower())


def clear_logs() -> int:
    """Clears all activity logs. Returns count of removed entries."""
    if not os.path.exists(LOG_FILE):
        return 0

    with _lock:
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            count = sum(1 for line in f if line.strip())
        # Overwrite with empty
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            f.write('')

    return count


def get_stats() -> dict:
    """Compute summary statistics from the activity log."""
    entries = read_logs(limit=10000)

    if not entries:
        return {
            "total_events": 0,
            "training_runs": 0,
            "successful_trainings": 0,
            "failed_trainings": 0,
            "prediction_fetches": 0,
            "wfv_runs": 0,
            "monitor_runs": 0,
            "admin_logins": 0,
            "failed_logins": 0,
            "unique_tickers": [],
            "last_event": None,
            "first_event": None,
        }

    training_starts     = [e for e in entries if e['event_type'] == EventType.TRAIN_START]
    training_completes  = [e for e in entries if e['event_type'] == EventType.TRAIN_COMPLETE]
    training_failures   = [e for e in entries if e['event_type'] == EventType.TRAIN_FAILED]
    predict_fetches     = [e for e in entries if e['event_type'] == EventType.PREDICT_FETCH]
    wfv_runs            = [e for e in entries if e['event_type'] == EventType.WFV_RUN]
    monitor_runs        = [e for e in entries if e['event_type'] == EventType.MONITOR_RUN]
    admin_logins        = [e for e in entries if e['event_type'] == EventType.ADMIN_LOGIN]
    failed_logins       = [e for e in entries if e['event_type'] == EventType.ADMIN_LOGIN_FAIL]

    # Collect unique tickers touched
    tickers = set()
    for e in entries:
        ticker = e.get('details', {}).get('ticker')
        if ticker:
            tickers.add(ticker)

    return {
        "total_events": len(entries),
        "training_runs": len(training_starts),
        "successful_trainings": len(training_completes),
        "failed_trainings": len(training_failures),
        "prediction_fetches": len(predict_fetches),
        "wfv_runs": len(wfv_runs),
        "monitor_runs": len(monitor_runs),
        "admin_logins": len(admin_logins),
        "failed_logins": len(failed_logins),
        "unique_tickers": sorted(list(tickers)),
        "last_event": entries[0]["timestamp_local"] if entries else None,
        "first_event": entries[-1]["timestamp_local"] if entries else None,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────
_counter = 0
_counter_lock = threading.Lock()

def _generate_id() -> str:
    """Thread-safe monotonically increasing ID."""
    global _counter
    with _counter_lock:
        _counter += 1
        return f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{_counter:05d}"


# Write a startup log when the module is first imported
write_log(
    EventType.SYSTEM_START,
    {"message": "Backend API server started"},
    user="system"
)

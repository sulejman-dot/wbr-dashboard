#!/usr/bin/env python3
"""
WBR Data Capture — Self-contained script for GitHub Actions.
Fetches all historical WBR data from Google Sheets and writes wbr_history.json.
"""

import json
import os
import sys
import tempfile
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

# ── Configuration ──────────────────────────────────────────
SPREADSHEET_ID = "161qbyJ5nQsgDEaudZ5O1C4zldUIBbeDiYMYyCgldG40"
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "wbr_history.json")

SHEET_NAMES = [
    "WBR - created/auto/data #",
    "WBR - due/done #",
    "WBR - new kpis #",
    "planning for week W - hrs",
]


def get_client():
    """Authenticate with Google Sheets using env var or local file."""
    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

    # Prefer env var (GitHub Actions), fall back to local file
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if sa_json:
        # Write to temp file for gspread
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        tmp.write(sa_json)
        tmp.close()
        creds = Credentials.from_service_account_file(tmp.name, scopes=scopes)
        os.unlink(tmp.name)
    else:
        # Local development — look for service_account.json in parent workspace
        repo_root = os.path.dirname(os.path.dirname(__file__))
        sa_candidates = [
            os.path.join(repo_root, "service_account.json"),
            os.path.join(os.path.dirname(repo_root), "service_account.json"),
        ]
        sa_file = next((f for f in sa_candidates if os.path.exists(f)), None)
        if not sa_file:
            raise FileNotFoundError(f"service_account.json not found. Checked: {sa_candidates}")
        creds = Credentials.from_service_account_file(sa_file, scopes=scopes)

    return gspread.authorize(creds)


def to_num(val):
    """Convert a string to int, or 0."""
    if val is None:
        return 0
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def to_float(val):
    """Convert a string to float, or 0."""
    if val is None:
        return 0.0
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def capture_all():
    """Fetch all historical WBR data from all sheets."""
    print("🔌 Connecting to Google Sheets...")
    client = get_client()
    sh = client.open_by_key(SPREADSHEET_ID)

    # ── Sheet 1: created/auto/data ──
    print("📊 Reading: WBR - created/auto/data #")
    s1 = sh.worksheet(SHEET_NAMES[0])
    s1_data = s1.get_all_values()

    # Discover weeks from sheet 1 (column A, skip header)
    weeks = []
    week_s1 = {}
    for i in range(1, len(s1_data)):
        row = s1_data[i]
        if row and row[0] and row[0].strip().startswith("W"):
            w = row[0].strip()
            weeks.append(w)
            week_s1[w] = {
                "total_tasks": to_num(row[1] if len(row) > 1 else 0),
                "auto_tasks": to_num(row[2] if len(row) > 2 else 0),
                "data_tasks": to_num(row[4] if len(row) > 4 else 0),
            }

    print(f"   Found {len(weeks)} weeks: {weeks[0]} → {weeks[-1]}")

    # ── Sheet 2: due/done ──
    print("📊 Reading: WBR - due/done #")
    s2 = sh.worksheet(SHEET_NAMES[1])
    s2_data = s2.get_all_values()
    week_s2 = {}
    for i in range(2, len(s2_data)):  # header rows = 2
        row = s2_data[i]
        if row and row[0] and row[0].strip().startswith("W"):
            w = row[0].strip()
            week_s2[w] = {
                "created": to_num(row[1] if len(row) > 1 else 0),
                "auto": to_num(row[2] if len(row) > 2 else 0),
                "data": to_num(row[3] if len(row) > 3 else 0),
                "total_due": to_num(row[4] if len(row) > 4 else 0),
                "total_done": to_num(row[5] if len(row) > 5 else 0),
            }

    # ── Sheet 3: new kpis ──
    print("📊 Reading: WBR - new kpis #")
    s3 = sh.worksheet(SHEET_NAMES[2])
    s3_data = s3.get_all_values()
    week_s3 = {}
    for i in range(1, len(s3_data)):
        row = s3_data[i]
        if row and row[0] and row[0].strip().startswith("W"):
            w = row[0].strip()
            week_s3[w] = {
                "critical_over_sla": to_num(row[1] if len(row) > 1 else 0),
                "returned": to_num(row[2] if len(row) > 2 else 0),
                "repeating": row[3].strip() if len(row) > 3 else "-",
                "new_launches": row[4].strip() if len(row) > 4 else "-",
            }

    # ── Sheet 4: planning hours ──
    print("📊 Reading: planning for week W - hrs")
    s4 = sh.worksheet(SHEET_NAMES[3])
    s4_data = s4.get_all_values()
    week_s4 = {}
    for i in range(2, len(s4_data)):  # header rows = 2
        row = s4_data[i]
        if row and row[0] and row[0].strip().startswith("W"):
            w = row[0].strip()
            week_s4[w] = {
                "created_est": row[1].strip() if len(row) > 1 else "-",
                "new_debt": row[2].strip() if len(row) > 2 else "-",
                "planned": row[3].strip() if len(row) > 3 else "-",
                "debt": row[4].strip() if len(row) > 4 else "-",
            }

    # ── Build records ──
    print("🔧 Building history records...")
    reviews = []
    for w in weeks:
        cad = week_s1.get(w, {})
        dd = week_s2.get(w, {})
        kpi = week_s3.get(w, {})
        plan = week_s4.get(w, {})

        total_due = dd.get("total_due", 0)
        total_done = dd.get("total_done", 0)
        completion_rate = round((total_done / total_due) * 100, 1) if total_due > 0 else 0

        reviews.append({
            "week": w,
            "captured_at": datetime.now().isoformat(),
            "total_tasks": cad.get("total_tasks", 0),
            "auto_tasks": cad.get("auto_tasks", 0),
            "data_tasks": cad.get("data_tasks", 0),
            "created": dd.get("created", 0),
            "auto_done": dd.get("auto", 0),
            "data_done": dd.get("data", 0),
            "total_due": total_due,
            "total_done": total_done,
            "critical_over_sla": kpi.get("critical_over_sla", 0),
            "returned": kpi.get("returned", 0),
            "repeating": kpi.get("repeating", "-"),
            "new_launches": kpi.get("new_launches", "-"),
            "created_est_hrs": to_float(plan.get("created_est", 0)),
            "new_debt_hrs": to_float(plan.get("new_debt", 0)),
            "planned_hrs": to_float(plan.get("planned", 0)),
            "debt_hrs": to_float(plan.get("debt", 0)),
            "completion_rate": completion_rate,
        })

    history = {
        "reviews": reviews,
        "last_updated": datetime.now().isoformat(),
    }

    # ── Write output ──
    with open(OUTPUT_FILE, "w") as f:
        json.dump(history, f, indent=2)

    print(f"✅ Saved {len(reviews)} weeks to {OUTPUT_FILE}")
    return True


if __name__ == "__main__":
    try:
        capture_all()
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)

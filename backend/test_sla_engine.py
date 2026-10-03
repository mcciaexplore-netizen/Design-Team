import pytest
import datetime
import pytz
from sla_engine import calculate_due_date

@pytest.fixture
def base_schedule():
    return {
        0: {'is_working': True, 'start': 10, 'end': 19}, # Mon
        1: {'is_working': True, 'start': 10, 'end': 19}, # Tue
        2: {'is_working': True, 'start': 10, 'end': 19}, # Wed
        3: {'is_working': True, 'start': 10, 'end': 19}, # Thu
        4: {'is_working': True, 'start': 10, 'end': 19}, # Fri
        5: {'is_working': True, 'start': 10, 'end': 19}, # Sat
        6: {'is_working': False, 'start': 10, 'end': 19},# Sun
    }

def test_created_after_hours(base_schedule):
    ist = pytz.timezone("Asia/Kolkata")
    # Friday 8 PM IST
    start_time = ist.localize(datetime.datetime(2026, 10, 2, 20, 0, 0)).astimezone(pytz.UTC)
    holidays = set()
    # 4 hours SLA -> Should push to Saturday 2 PM IST
    due_date = calculate_due_date(start_time, 4, base_schedule, holidays)
    expected_due = ist.localize(datetime.datetime(2026, 10, 3, 14, 0, 0)).astimezone(pytz.UTC)
    assert due_date == expected_due

def test_over_weekend(base_schedule):
    ist = pytz.timezone("Asia/Kolkata")
    # Saturday 5 PM IST (2 hours left in day)
    start_time = ist.localize(datetime.datetime(2026, 10, 3, 17, 0, 0)).astimezone(pytz.UTC)
    holidays = set()
    # 4 hours SLA -> Uses 2 hrs Sat, skips Sun, uses 2 hrs Mon -> Mon 12 PM IST
    due_date = calculate_due_date(start_time, 4, base_schedule, holidays)
    expected_due = ist.localize(datetime.datetime(2026, 10, 5, 12, 0, 0)).astimezone(pytz.UTC)
    assert due_date == expected_due

def test_spanning_holidays(base_schedule):
    ist = pytz.timezone("Asia/Kolkata")
    # Wednesday 5 PM IST
    start_time = ist.localize(datetime.datetime(2026, 10, 7, 17, 0, 0)).astimezone(pytz.UTC)
    holidays = {datetime.date(2026, 10, 8), datetime.date(2026, 10, 9)} # Thu, Fri
    # 4 hours SLA -> Uses 2 hrs Wed, skips Thu/Fri, uses 2 hrs Sat -> Sat 12 PM IST
    due_date = calculate_due_date(start_time, 4, base_schedule, holidays)
    expected_due = ist.localize(datetime.datetime(2026, 10, 10, 12, 0, 0)).astimezone(pytz.UTC)
    assert due_date == expected_due

def test_pause_resume(base_schedule):
    ist = pytz.timezone("Asia/Kolkata")
    # Monday 10 AM IST
    start_time = ist.localize(datetime.datetime(2026, 10, 5, 10, 0, 0)).astimezone(pytz.UTC)
    holidays = set()
    # 9 hours SLA normally finishes Monday 7 PM.
    # Paused for 5 hours (18000 seconds) -> Finishes Tuesday 3 PM IST (since Mon 7PM + 5 hrs)
    # Wait, paused seconds adds to remaining seconds directly, effectively extending it.
    due_date = calculate_due_date(start_time, 9, base_schedule, holidays, paused_seconds=18000)
    expected_due = ist.localize(datetime.datetime(2026, 10, 6, 15, 0, 0)).astimezone(pytz.UTC)
    assert due_date == expected_due

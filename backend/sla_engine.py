import datetime
import pytz

def calculate_due_date(
    start_time: datetime.datetime, 
    sla_hours: int, 
    working_schedules: list, 
    holidays: set, 
    paused_seconds: int = 0
) -> datetime.datetime:
    """
    Pure function to calculate due time.
    start_time: UTC aware datetime
    sla_hours: Integer (e.g. 36)
    working_schedules: Dict mapping weekday (0-6) to {'is_working': bool, 'start': int, 'end': int}
    holidays: Set of dates (datetime.date)
    paused_seconds: Int representing time spent in "Waiting on Requester"
    """
    if not start_time.tzinfo:
        raise ValueError("start_time must be timezone aware")
        
    ist = pytz.timezone("Asia/Kolkata")
    current_time = start_time.astimezone(ist)
    
    # Adjust remaining seconds based on what we already used or SLA
    remaining_seconds = (sla_hours * 3600) + paused_seconds
    
    while remaining_seconds > 0:
        day_of_week = current_time.weekday()
        current_date = current_time.date()
        
        schedule = working_schedules.get(day_of_week)
        
        # If not a working day or it's a holiday, skip to midnight next day
        if not schedule or not schedule['is_working'] or current_date in holidays:
            # Advance to start of next day
            next_day = current_time + datetime.timedelta(days=1)
            current_time = ist.localize(datetime.datetime(next_day.year, next_day.month, next_day.day, 0, 0, 0))
            continue
            
        start_hour = schedule['start']
        end_hour = schedule['end']
        
        # If before working hours, jump to start
        if current_time.hour < start_hour:
            current_time = current_time.replace(hour=start_hour, minute=0, second=0, microsecond=0)
            
        # If after working hours, jump to next day midnight
        if current_time.hour >= end_hour:
            next_day = current_time + datetime.timedelta(days=1)
            current_time = ist.localize(datetime.datetime(next_day.year, next_day.month, next_day.day, 0, 0, 0))
            continue
            
        # We are within working hours. Calculate how much time left today
        end_of_day = current_time.replace(hour=end_hour, minute=0, second=0, microsecond=0)
        seconds_left_today = (end_of_day - current_time).total_seconds()
        
        if remaining_seconds <= seconds_left_today:
            # We can finish today
            current_time = current_time + datetime.timedelta(seconds=remaining_seconds)
            remaining_seconds = 0
        else:
            # Exhaust today's hours and jump to next day
            remaining_seconds -= seconds_left_today
            next_day = current_time + datetime.timedelta(days=1)
            current_time = ist.localize(datetime.datetime(next_day.year, next_day.month, next_day.day, 0, 0, 0))

    return current_time.astimezone(pytz.UTC)

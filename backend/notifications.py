import datetime
import pytz
from models import Notification, NotificationLog, UserPreference, RoleEnum

class NotificationChannel:
    def send(self, db, user, content, event_type, ticket_id=None):
        raise NotImplementedError

class InAppChannel(NotificationChannel):
    def send(self, db, user, content, event_type, ticket_id=None):
        notif = Notification(user_id=user.id, content=content, type=event_type)
        db.add(notif)

class EmailChannel(NotificationChannel):
    def send(self, db, user, content, event_type, ticket_id=None):
        # Stub for actual email sending logic
        # e.g., sendgrid.send(user.email, content)
        pass

class SlackWebhookChannel(NotificationChannel):
    def send(self, db, user, content, event_type, ticket_id=None):
        # In a real scenario, you'd fetch the slack URL from the environment or settings.
        # import requests
        # import os
        # webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
        # if webhook_url:
        #    requests.post(webhook_url, json={"text": f"[{event_type}] {content}"})
        pass

CHANNELS = [InAppChannel(), EmailChannel(), SlackWebhookChannel()]

def is_quiet_hours(prefs: UserPreference):
    if prefs.quiet_hours_start is None or prefs.quiet_hours_end is None:
        return False
    now_hour = datetime.datetime.now(pytz.timezone("Asia/Kolkata")).hour
    if prefs.quiet_hours_start <= prefs.quiet_hours_end:
        return prefs.quiet_hours_start <= now_hour < prefs.quiet_hours_end
    else: # Crosses midnight
        return now_hour >= prefs.quiet_hours_start or now_hour < prefs.quiet_hours_end

def notify_user(db, user, content, event_type, ticket_id=None):
    # Deduplication check
    if ticket_id:
        exists = db.query(NotificationLog).filter_by(ticket_id=ticket_id, event_type=event_type).first()
        if exists:
            return False # Already sent
            
    prefs = db.query(UserPreference).filter_by(user_id=user.id).first()
    
    in_app_enabled = prefs.in_app_enabled if prefs else True
    email_enabled = prefs.email_enabled if prefs else True
    quiet = is_quiet_hours(prefs) if prefs else False

    # Send through channels
    if in_app_enabled:
        CHANNELS[0].send(db, user, content, event_type, ticket_id)
    if email_enabled and not quiet:
        CHANNELS[1].send(db, user, content, event_type, ticket_id)
        
    if ticket_id:
        log = NotificationLog(ticket_id=ticket_id, event_type=event_type)
        db.add(log)
        
    db.commit()
    return True

def handle_overdue_escalations(db, ticket, working_hours_overdue):
    # Escalation Ladder
    # Designer: Immediate (0) and every 4 hours -> event: OVERDUE_DESIGNER_{cycle}
    # Lead: After 4 hours -> event: OVERDUE_LEAD
    # Admin: After 12 hours -> event: OVERDUE_ADMIN
    
    cycle = working_hours_overdue // 4
    
    notify_user(db, ticket.assignee, f"Ticket {ticket.ticket_number} is OVERDUE", f"OVERDUE_DESIGNER_{cycle}", ticket.id)
    
    if working_hours_overdue >= 4:
        from models import User
        lead = db.query(User).filter_by(role=RoleEnum.DESIGN_LEAD).first()
        if lead:
            notify_user(db, lead, f"Ticket {ticket.ticket_number} is 4+ hrs overdue", "OVERDUE_LEAD", ticket.id)
            
    if working_hours_overdue >= 12:
        from models import User
        admin = db.query(User).filter_by(role=RoleEnum.ADMIN).first()
        if admin:
            notify_user(db, admin, f"Ticket {ticket.ticket_number} is 12+ hrs overdue!", "OVERDUE_ADMIN", ticket.id)

import httpx
import os
from sqlalchemy.orm import Session
from models import Ticket, User, TicketStatus
import logging

logger = logging.getLogger(__name__)

# Mock settings
JIRA_API_URL = "https://your-domain.atlassian.net/rest/api/3"
JIRA_API_TOKEN = "mock_token"

async def push_status_to_jira(ticket_id: int, db: Session):
    """
    Called when a DesignDesk ticket changes status.
    If it's linked to a Jira issue, it pushes the state change to Jira.
    """
    # In a real system, you would look up an ExternalLink table
    # to find the linked Jira Issue ID for this DesignDesk Ticket ID.
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        return
    
    # Mocking external HTTP call
    logger.info(f"Syncing Ticket {ticket.ticket_number} status '{ticket.status}' to Jira/Asana.")
    return True

# --- Slack Integration ---
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX")

async def notify_slack_high_priority_ticket(ticket: Ticket):
    """Push a message to Slack when a high-priority ticket is created."""
    if not SLACK_WEBHOOK_URL:
        return
        
    payload = {
        "text": f"🚨 *New High Priority Ticket created!* 🚨\n*Ticket:* {ticket.ticket_number} - {ticket.title}\n*Assignee:* {ticket.assignee_id or 'Unassigned'}\n*Status:* {ticket.status.value}"
    }
    
    logger.info(f"Sending Slack notification for high priority ticket {ticket.ticket_number}")
    # async with httpx.AsyncClient() as client:
    #     await client.post(SLACK_WEBHOOK_URL, json=payload)
    return True

async def notify_slack_sla_breach(ticket: Ticket):
    """Push a message to Slack when an SLA is about to breach."""
    if not SLACK_WEBHOOK_URL:
        return
        
    payload = {
        "text": f"⚠️ *SLA Breach Warning!* ⚠️\n*Ticket:* {ticket.ticket_number} - {ticket.title}\n*Due At:* {ticket.due_at}"
    }
    
    logger.info(f"Sending Slack notification for SLA breach warning on ticket {ticket.ticket_number}")
    # async with httpx.AsyncClient() as client:
    #     await client.post(SLACK_WEBHOOK_URL, json=payload)
    return True

async def notify_slack_last_minute_change(ticket: Ticket):
    """Push a message to Slack when a last-minute change is requested."""
    if not SLACK_WEBHOOK_URL:
        return
        
    payload = {
        "text": f"🚨 *Last-Minute Change Alert!* 🚨\n*Ticket:* {ticket.ticket_number} - {ticket.title}\n*Due At:* {ticket.due_at}\nA revision was requested within 12 hours of the deadline!"
    }
    
    logger.info(f"Sending Slack notification for last-minute change on ticket {ticket.ticket_number}")
    # async with httpx.AsyncClient() as client:
    #     await client.post(SLACK_WEBHOOK_URL, json=payload)
    return True

async def handle_incoming_jira_webhook(payload: dict, db: Session):
    """
    Called by an external webhook (e.g. from Jira).
    If a Jira issue is created with the label "DesignNeeded", create a DesignDesk ticket.
    """
    issue = payload.get("issue", {})
    fields = issue.get("fields", {})
    labels = fields.get("labels", [])
    
    if "DesignNeeded" in labels:
        # Create a new Ticket in our DB
        title = fields.get("summary", "Incoming Jira Task")
        brief = fields.get("description", "No description provided.")
        
        logger.info(f"Creating new DesignDesk ticket from Jira Issue {issue.get('key')}")
        
        # We would create the ticket here:
        # new_ticket = Ticket(title=title, brief=brief, status=TicketStatus.NEW, ...)
        # db.add(new_ticket)
        # db.commit()
        return {"status": "created"}
        
    return {"status": "ignored"}

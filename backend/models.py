from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Enum, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base

class RoleEnum(str, enum.Enum):
    REQUESTER = "Requester"
    DESIGNER = "Designer"
    DESIGN_LEAD = "Design Lead"
    ADMIN = "Admin"

class TicketPriority(str, enum.Enum):
    LOW = "Low"
    NORMAL = "Normal"
    HIGH = "High"
    URGENT = "Urgent"

class TicketStatus(str, enum.Enum):
    NEW = "New"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    WAITING_ON_REQUESTER = "Waiting on Requester"
    IN_REVIEW = "In Review"
    DELIVERED = "Delivered"
    CLOSED = "Closed"
    CLOSED_WITHOUT_APPROVAL = "Closed without approval"

# Replaces hardcoded TicketStatus enum for custom pipelines
class WorkflowStage(Base):
    __tablename__ = "workflow_stages"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False) # e.g. "Ideation", "Wireframing"
    order_index = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True)

class AutomationRule(Base):
    __tablename__ = "automation_rules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    condition_logic = Column(JSON, nullable=False) # e.g. {"status": "Review", "time_gt": 48}
    action_type = Column(String, nullable=False) # e.g. "escalate", "send_email"
    action_payload = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)

class WebhookIntegration(Base):
    __tablename__ = "webhook_integrations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    events = Column(JSON, nullable=False) # Array of events: ["ticket.created", "ticket.escalated"]
    is_active = Column(Boolean, default=True)


class SystemSettings(Base):
    __tablename__ = "system_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    edit_window_hours = Column(Integer, default=12, nullable=False)
    edit_window_uses_working_hours = Column(Boolean, default=True, nullable=False)
    max_free_revisions = Column(Integer, default=2, nullable=False)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(RoleEnum), default=RoleEnum.REQUESTER, nullable=False)
    daily_capacity_hours = Column(Integer, default=8, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class DesignType(Base):
    __tablename__ = "design_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False) # e.g. banner, social post
    default_sla_hours = Column(Integer, default=24, nullable=False)
    required_fields = Column(JSON, nullable=False) # List of required field definitions
    is_active = Column(Boolean, default=True)

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    ticket_number = Column(String, unique=True, index=True)
    title = Column(String, nullable=False)
    brief = Column(Text, nullable=False)
    
    design_type_id = Column(Integer, ForeignKey("design_types.id"), nullable=False)
    design_type = relationship("DesignType")
    
    type_specific_fields = Column(JSON, nullable=False)
    priority = Column(Enum(TicketPriority), default=TicketPriority.NORMAL, nullable=False)
    status = Column(Enum(TicketStatus), default=TicketStatus.NEW, nullable=False)
    workflow_stage_id = Column(Integer, ForeignKey("workflow_stages.id"), nullable=True) # Custom pipeline stage
    figma_url = Column(String, nullable=True) # Figma embed integration
    
    due_at = Column(DateTime(timezone=True), nullable=True)
    paused_at = Column(DateTime(timezone=True), nullable=True)
    total_paused_seconds = Column(Integer, default=0, nullable=False)
    is_overdue = Column(Boolean, default=False, nullable=False)
    escalated_to_lead = Column(Boolean, default=False, nullable=False)
    
    # Batch 3 Delivery & Revisions
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    edit_window_ends_at = Column(DateTime(timezone=True), nullable=True)
    revision_count = Column(Integer, default=0, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)
    parent_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    version_number = Column(Integer, default=1, nullable=False)
    reason_for_change = Column(Text, nullable=True) # If this is a child ticket
    revision_category = Column(String, nullable=True) # "Missing Asset", "Scope Change", "Design Error"
    flagged_for_reassignment = Column(Boolean, default=False, nullable=False)
    
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    requester = relationship("User", foreign_keys=[requester_id])

    
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assignee = relationship("User", foreign_keys=[assignee_id])
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    tags = Column(JSON, default=list) # Array of strings

    # Time tracking
    timer_started_at = Column(DateTime(timezone=True), nullable=True)
    time_spent_seconds = Column(Integer, default=0, nullable=False)
    
    subtasks = relationship("Subtask", backref="ticket", cascade="all, delete-orphan")

class Subtask(Base):
    __tablename__ = "subtasks"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    title = Column(String, nullable=False)
    is_completed = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    file_name = Column(String, nullable=False)
    file_url = Column(String, nullable=False) # MinIO URL
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
class PinpointComment(Base):
    __tablename__ = "pinpoint_comments"
    
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    image_url = Column(String, nullable=False)
    x_pct = Column(String, nullable=False) # e.g. "45.5"
    y_pct = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    is_resolved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False) # e.g., 'Status Changed'
    details = Column(JSON, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

class HolidayType(str, enum.Enum):
    NATIONAL = "National"
    COMPANY = "Company"
    OPTIONAL = "Optional"

class Holiday(Base):
    __tablename__ = "holidays"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime(timezone=False), unique=True, index=True, nullable=False) # Date of the holiday
    name = Column(String, nullable=False)
    type = Column(Enum(HolidayType), default=HolidayType.NATIONAL, nullable=False)

class WorkingSchedule(Base):
    __tablename__ = "working_schedules"
    
    id = Column(Integer, primary_key=True, index=True)
    day_of_week = Column(Integer, nullable=False, unique=True) # 0=Mon, 6=Sun
    is_working_day = Column(Boolean, default=True, nullable=False)
    start_hour = Column(Integer, default=10, nullable=False) # 10:00
    end_hour = Column(Integer, default=19, nullable=False) # 19:00

# Batch 4 Notifications & Leaves
class UserPreference(Base):
    __tablename__ = "user_preferences"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    in_app_enabled = Column(Boolean, default=True, nullable=False)
    email_enabled = Column(Boolean, default=True, nullable=False)
    quiet_hours_start = Column(Integer, nullable=True) # e.g. 22 for 10 PM
    quiet_hours_end = Column(Integer, nullable=True) # e.g. 8 for 8 AM
    digest_enabled = Column(Boolean, default=False, nullable=False)

class UserLeave(Base):
    __tablename__ = "user_leaves"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_date = Column(DateTime(timezone=False), nullable=False)
    end_date = Column(DateTime(timezone=False), nullable=False)

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(String, nullable=False)
    type = Column(String, nullable=False) # e.g. 'ASSIGNED', 'WARNING'
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class NotificationLog(Base):
    __tablename__ = "notification_logs"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    event_type = Column(String, nullable=False) # e.g. 'OVERDUE_ESCALATION_LEAD'
    sent_at = Column(DateTime(timezone=True), server_default=func.now())

# Batch 5 Library & CDR
class Folder(Base):
    __tablename__ = "folders"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    parent_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class FolderPermission(Base):
    __tablename__ = "folder_permissions"
    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=False)
    role_or_user_id = Column(String, nullable=False) # E.g., 'ROLE_DESIGN_LEAD' or 'USER_5'
    permission = Column(String, nullable=False) # VIEW, UPLOAD, MANAGE

class LibraryItem(Base):
    __tablename__ = "library_items"
    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=False)
    name = Column(String, nullable=False)
    ticket_source_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    tags = Column(JSON, default=list)
    
    # Brand Kit properties
    is_approved_final = Column(Boolean, default=False, nullable=False)
    expiry_date = Column(DateTime(timezone=True), nullable=True)
    usage_rights_note = Column(Text, nullable=True)
    
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class LibraryItemVersion(Base):
    __tablename__ = "library_item_versions"
    id = Column(Integer, primary_key=True, index=True)
    library_item_id = Column(Integer, ForeignKey("library_items.id"), nullable=False)
    version_number = Column(Integer, nullable=False)
    file_url = Column(String, nullable=False)
    preview_url = Column(String, nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

class CdrRequestStatus(str, enum.Enum):
    REQUESTED = "Requested"
    APPROVED = "Approved"
    DECLINED = "Declined"
    UPLOADED = "Uploaded"

class CdrRequest(Base):
    __tablename__ = "cdr_requests"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    library_item_id = Column(Integer, ForeignKey("library_items.id"), nullable=True)
    
    status = Column(Enum(CdrRequestStatus), default=CdrRequestStatus.REQUESTED, nullable=False)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Private storage path (not a public URL)
    s3_object_key = Column(String, nullable=True)
    preview_url = Column(String, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class CdrDownloadLog(Base):
    __tablename__ = "cdr_download_logs"
    id = Column(Integer, primary_key=True, index=True)
    cdr_request_id = Column(Integer, ForeignKey("cdr_requests.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    downloaded_at = Column(DateTime(timezone=True), server_default=func.now())

# Batch 6 Visual Review
class PinComment(Base):
    __tablename__ = "pin_comments"
    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    version_number = Column(Integer, nullable=False) # Which revision this pin is for
    
    x_pos = Column(Integer, nullable=False) # Percentage or pixel
    y_pos = Column(Integer, nullable=False)
    
    content = Column(Text, nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    is_resolved = Column(Boolean, default=False, nullable=False)
    parent_id = Column(Integer, ForeignKey("pin_comments.id"), nullable=True) # Threaded replies
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())



from datetime import timezone
from typing import Annotated
from pydantic import AfterValidator, BaseModel, EmailStr, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from models import RoleEnum, TicketPriority, TicketStatus
from common import parse_figma_url


UTCDateTime = Annotated[datetime, AfterValidator(lambda v: v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v)]


def _check_figma(v):
    if v and not parse_figma_url(v):
        raise ValueError('Must be a figma.com file, design, prototype or board link')
    return v or None

# User Schemas
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: RoleEnum

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    created_at: UTCDateTime
    class Config:
        from_attributes = True

# Design Type Schemas
class DesignTypeBase(BaseModel):
    name: str
    default_sla_hours: int
    required_fields: List[Dict[str, Any]] # e.g. [{"name": "size", "type": "string"}]
    is_active: bool = True

class DesignTypeCreate(DesignTypeBase):
    pass

class DesignTypeResponse(DesignTypeBase):
    id: int
    class Config:
        from_attributes = True

# Ticket Schemas
class TicketBase(BaseModel):
    title: str
    brief: str
    design_type_id: int
    type_specific_fields: Dict[str, Any]
    priority: TicketPriority = TicketPriority.NORMAL
    tags: List[str] = []
    figma_url: Optional[str] = None
    workflow_stage_id: Optional[int] = None

    _figma = field_validator('figma_url')(_check_figma)

class TicketCreate(TicketBase):
    estimate_hours: Optional[float] = None

class TicketUpdate(BaseModel):
    title: Optional[str] = None
    brief: Optional[str] = None
    type_specific_fields: Optional[Dict[str, Any]] = None
    priority: Optional[TicketPriority] = None
    status: Optional[TicketStatus] = None
    assignee_id: Optional[int] = None
    tags: Optional[List[str]] = None
    figma_url: Optional[str] = None
    workflow_stage_id: Optional[int] = None
    estimate_hours: Optional[float] = None

    _figma = field_validator('figma_url')(_check_figma)

class TicketResponse(TicketBase):
    id: int
    ticket_number: str
    status: TicketStatus
    requester_id: int
    assignee_id: Optional[int]
    created_at: UTCDateTime
    updated_at: UTCDateTime
    timer_started_at: Optional[UTCDateTime] = None
    time_spent_seconds: int = 0
    due_at: Optional[UTCDateTime] = None
    is_overdue: bool = False
    escalated_to_lead: bool = False
    parent_id: Optional[int] = None
    version_number: int = 1
    reason_for_change: Optional[str] = None
    revision_count: int = 0
    is_locked: bool = False
    client_org: Optional[str] = None
    estimate_hours: Optional[float] = None
    comment_count: int = 0

    requester: UserResponse
    assignee: Optional[UserResponse]
    design_type: DesignTypeResponse
    subtasks: List['SubtaskResponse'] = []

    class Config:
        from_attributes = True

class TicketCommentBase(BaseModel):
    content: str

class TicketCommentCreate(TicketCommentBase):
    pass

class TicketCommentResponse(TicketCommentBase):
    id: int
    ticket_id: int
    author_id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Pinpoint Comment Schemas
class PinpointCommentBase(BaseModel):
    image_url: str
    x_pct: str
    y_pct: str
    content: str
    is_resolved: bool = False

class PinpointCommentCreate(PinpointCommentBase):
    pass

class PinpointCommentResponse(PinpointCommentBase):
    id: int
    ticket_id: int
    author_id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Subtask Schemas
class SubtaskBase(BaseModel):
    title: str
    is_completed: bool = False

class SubtaskCreate(SubtaskBase):
    pass

class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None

class SubtaskResponse(SubtaskBase):
    id: int
    ticket_id: int
    created_at: datetime

    class Config:
        from_attributes = True

TicketResponse.update_forward_refs()

/* Shared Ticket type — the UI shape of a ticket returned by the API (see contexts/TicketsContext) */
export interface TicketComment {
  id:        string;
  author:    string;
  text:      string;
  createdAt: string;
}

export interface Subtask {
  id:           number;
  title:        string;
  is_completed: boolean;
}

export interface Ticket {
  id:                 string;
  number:             string;
  title:              string;
  status:             string;
  priority:           string;
  assignee:           string;
  due_at:             string;
  created_at?:        string;
  timer_started_at:   string | null;
  time_spent_seconds: number;
  subtasks:           Subtask[];
  comments:           TicketComment[];
  tags:               string[];
  description:        string;
  figma_url?:         string;
  parent_id?:         string;
  version_number?:    number;
  reason_for_change?: string;
  revision_category?: string;
  info_score?:        number;
  /* Fields below come from the API */
  assignee_id?:       number | null;
  requester_id?:      number;
  requester_name?:    string;
  client_org?:        string | null;
  revision_count?:    number;
  is_overdue?:        boolean;
  is_locked?:         boolean;
  estimate_hours?:    number | null;
  comment_count?:     number;
  design_type?:       string;
  type_specific_fields?: Record<string, unknown>;
}

export const STATUSES = [
  'New', 'Assigned', 'In Progress',
  'Waiting on Requester', 'In Review', 'Delivered', 'Closed',
];

/** Statuses that mean the work is finished (hidden from open-work lists). */
export const DONE_STATUSES = ['Delivered', 'Closed', 'Closed without approval', 'Revision Requested'];

export const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];

export const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
  Urgent: { background: 'rgba(239,68,68,0.07)',  borderColor: 'rgba(239,68,68,0.22)',  color: '#EF4444' },
  High:   { background: 'rgba(249,115,22,0.07)', borderColor: 'rgba(249,115,22,0.22)', color: '#f97316' },
  Normal: { background: 'white' },
  Low:    { background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)',  color: '#059669' },
};

export const DEFAULT_WIP_LIMITS: Record<string, number> = {
  'In Progress': 3,
  'In Review':   2,
};

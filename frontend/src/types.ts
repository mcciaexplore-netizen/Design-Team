/* Shared Ticket type — imported by KanbanBoard, TicketSlideOver, TicketDetailPage */
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
}

export const STATUSES = [
  'New', 'Assigned', 'In Progress',
  'Waiting on Requester', 'In Review', 'Delivered', 'Closed',
];

export const DESIGNERS = ['Unassigned', 'Alice', 'Bob', 'Charlie'];

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

/** Seed data shared across pages */
export const SEED_TICKETS: Ticket[] = [
  {
    id: '1', number: 'DF-0001', title: 'Spring Sale Homepage Banner',
    status: 'New', priority: 'Normal', assignee: 'Alice',
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    timer_started_at: null, time_spent_seconds: 0, subtasks: [],
    comments: [{ id: 'c1', author: 'Alice', text: 'Starting this tomorrow.', createdAt: new Date().toISOString() }],
    tags: ['Marketing', 'Social'],
    description: 'Design a homepage banner for the spring sale campaign.',
  },
  {
    id: '2', number: 'DF-0002', title: 'Social Media Q3 Graphics',
    status: 'In Progress', priority: 'High', assignee: 'Bob',
    due_at: new Date(Date.now() + 3_600_000).toISOString(),
    timer_started_at: new Date(Date.now() - 900_000).toISOString(),
    time_spent_seconds: 3600,
    subtasks: [
      { id: 1, title: 'Draft concepts',   is_completed: true  },
      { id: 2, title: 'Finalize colors',  is_completed: false },
    ],
    comments: [],
    tags: ['Social', 'Urgent Fix'],
    description: 'Q3 social media graphics for Instagram, Facebook, and LinkedIn.',
  },
  {
    id: '3', number: 'DF-0003-V1', title: 'Brand Guidelines Update',
    status: 'Delivered', priority: 'Low', assignee: 'Alice',
    due_at: new Date(Date.now() - 172_800_000).toISOString(),
    timer_started_at: null, time_spent_seconds: 7200,
    subtasks: [],
    comments: [],
    tags: ['Internal'],
    description: 'Update the MCCIA brand guidelines document with new color palette and typography rules.',
    version_number: 1
  },
  {
    id: '3_v2', number: 'DF-0003-V2', title: 'Brand Guidelines Update',
    status: 'In Review', priority: 'Low', assignee: 'Alice',
    due_at: new Date(Date.now() + 172_800_000).toISOString(),
    timer_started_at: null, time_spent_seconds: 1800,
    subtasks: [],
    comments: [
      { id: 'c2', author: 'Bob',   text: 'Looks good, minor font fix needed.',  createdAt: new Date(Date.now() - 3_600_000).toISOString() },
      { id: 'c3', author: 'Alice', text: 'Fixed — ready for final approval.',   createdAt: new Date().toISOString() },
    ],
    tags: ['Internal', 'Last-Minute Change'],
    description: 'Update the MCCIA brand guidelines document with new color palette and typography rules.',
    parent_id: '3',
    version_number: 2,
    reason_for_change: 'The font size on the cover page was too small.'
  },
  {
    id: '4', number: 'DF-0004', title: 'Q4 Email Campaign Header',
    status: 'Assigned', priority: 'Urgent', assignee: 'Charlie',
    due_at: new Date(Date.now() + 7_200_000).toISOString(),
    timer_started_at: null, time_spent_seconds: 0,
    subtasks: [{ id: 3, title: 'Initial sketch', is_completed: false }],
    comments: [],
    tags: ['Marketing'],
    description: 'Email header design for the Q4 campaign — must match new brand guidelines.',
  },
  {
    id: '5', number: 'DF-0005', title: 'Product Launch Poster',
    status: 'In Progress', priority: 'High', assignee: 'Bob',
    due_at: new Date(Date.now() + 14_400_000).toISOString(),
    timer_started_at: null, time_spent_seconds: 1800,
    subtasks: [],
    comments: [],
    tags: ['Marketing'],
    description: 'A3 poster design for the upcoming product launch event.',
  },
];

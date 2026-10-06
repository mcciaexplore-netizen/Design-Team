import { useMemo, useState } from 'react';
import { DONE_STATUSES } from '../types';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventInput } from '@fullcalendar/core';
import { useTickets } from '../contexts/TicketsContext';

const DONE = DONE_STATUSES;
const HOUR = 3_600_000;

type Health = 'overdue' | 'at-risk' | 'on-track' | 'done';
const COLOR: Record<Health, { bg: string; fg: string; label: string }> = {
  overdue:    { bg: '#b91c1c', fg: '#ffffff', label: 'Overdue' },
  'at-risk':  { bg: '#b45309', fg: '#ffffff', label: 'Due within 24h' },
  'on-track': { bg: '#18181b', fg: '#ffffff', label: 'On track' },
  done:       { bg: '#047857', fg: '#ffffff', label: 'Delivered' },
};

export default function CalendarPage() {
  const { tickets, loading, error, refresh } = useTickets();
  const navigate = useNavigate();
  const [showDone, setShowDone] = useState(false);
  const narrow = useMemo(() => window.matchMedia('(max-width: 767px)').matches, []);

  const events = useMemo<EventInput[]>(() => {
    const now = Date.now();
    return tickets
      .filter(t => t.due_at && (showDone || !DONE.includes(t.status)))
      .map(t => {
        const due = new Date(t.due_at).getTime();
        const start = t.created_at ? new Date(t.created_at).getTime() : due - 4 * HOUR;
        const health: Health = DONE.includes(t.status) ? 'done' : t.is_overdue || due < now ? 'overdue' : due - now <= 24 * HOUR ? 'at-risk' : 'on-track';
        const c = COLOR[health];
        return {
          id: t.id,
          // The bar spans created → due: that is the SLA window. Zero/negative spans collapse to a short block at the due time.
          title: `${t.number} ${t.title}`,
          start: new Date(Math.min(start, due - HOUR)).toISOString(),
          end: new Date(due).toISOString(),
          backgroundColor: c.bg, textColor: c.fg, borderColor: c.bg,
          extendedProps: { health, status: t.status, assignee: t.assignee },
        } satisfies EventInput;
      });
  }, [tickets, showDone]);

  const onClick = (arg: EventClickArg) => { arg.jsEvent.preventDefault(); void navigate(`/tickets/${arg.event.id}`); };

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: '1rem' }}>
        <ul aria-label="Legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, listStyle: 'none', margin: 0, padding: 0 }}>
          {(Object.keys(COLOR) as Health[]).filter(h => showDone || h !== 'done').map(h => (
            <li key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-soft)', fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: COLOR[h].bg }} /> {COLOR[h].label}
            </li>
          ))}
        </ul>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-strong)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ accentColor: '#18181b' }} /> Show delivered
        </label>
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.85rem', marginBottom: 12 }}>{error} <button type="button" className="chip" onClick={() => void refresh()}>Retry</button></p>}
      {loading && tickets.length === 0 && <p role="status" style={{ color: 'var(--text-hint)' }}>Loading…</p>}

      <div className="glass-card" style={{ padding: '1rem' }}>
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView={narrow ? 'dayGridWeek' : 'dayGridMonth'}
          headerToolbar={narrow ? { left: 'prev,next', center: 'title', right: 'dayGridMonth,dayGridWeek' } : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week' }}
          events={events}
          eventClick={onClick}
          eventDidMount={info => {
            const p = info.event.extendedProps as { health: Health; status: string; assignee: string };
            info.el.title = `${info.event.title}\n${COLOR[p.health].label} · ${p.status}${p.assignee ? ` · ${p.assignee}` : ''}`;
            info.el.setAttribute('role', 'link');
          }}
          dayMaxEvents={3}
          height="auto"
          nowIndicator
          firstDay={1}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        />
      </div>
      {!loading && events.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-soft)', fontSize: '0.85rem', marginTop: 16 }}>No tickets with a due date{showDone ? '' : ' in progress'}.</p>
      )}
    </div>
  );
}

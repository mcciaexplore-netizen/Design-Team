import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin   from '@fullcalendar/daygrid';
import timeGridPlugin  from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';
import { useTickets } from '../contexts/TicketsContext';

const DONE = ['Delivered', 'Closed', 'Closed without approval'];

const CalendarPage = () => {
  const { tickets, loading } = useTickets();
  const navigate = useNavigate();

  const events = useMemo(() => tickets
    .filter(t => t.due_at)
    .map(t => {
      const done = DONE.includes(t.status);
      const overdue = !done && new Date(t.due_at).getTime() < Date.now();
      const color = done ? '#94a3b8' : overdue ? '#EF4444' : t.priority === 'Urgent' ? '#dc2626' : t.priority === 'High' ? '#f97316' : '#003F8A';
      return {
        id: t.id,
        title: `${t.number}: ${t.title}${t.assignee ? ` · ${t.assignee}` : ''}`,
        start: t.due_at,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { status: t.status },
      };
    }), [tickets]);

  const handleEventClick = (info: EventClickArg) => navigate(`/tickets/${info.event.id}`);

  return (
    <div className="glass-card" style={{ height: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>Deadlines</h2>
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', fontSize: '0.72rem', color: '#64748b' }} aria-label="Colour key">
          {[['#003F8A', 'Normal'], ['#f97316', 'High'], ['#dc2626', 'Urgent'], ['#EF4444', 'Overdue'], ['#94a3b8', 'Done']].map(([c, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{l}</span>
          ))}
        </div>
      </div>
      {loading && tickets.length === 0 && <p role="status" style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Loading deadlines…</p>}
      <div style={{ flex: 1, minHeight: 420 }}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          eventClick={handleEventClick}
          height="100%"
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          noEventsText="No deadlines in this range"
        />
      </div>
    </div>
  );
};

export default CalendarPage;

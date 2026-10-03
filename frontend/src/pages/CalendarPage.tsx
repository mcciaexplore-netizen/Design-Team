import FullCalendar from '@fullcalendar/react';
import dayGridPlugin   from '@fullcalendar/daygrid';
import timeGridPlugin  from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

const CalendarPage = () => {
  const events = [
    {
      id: '1',
      title: 'DF-0001: Spring Sale Homepage Banner',
      start: new Date(Date.now() + 86400000).toISOString(),
      backgroundColor: '#003F8A',
      borderColor:     '#0056B3',
      extendedProps: { priority: 'Normal', status: 'New' }
    },
    {
      id: '2',
      title: 'DF-0002: Social Media Q3 Graphics',
      start: new Date(Date.now() + 172800000).toISOString(),
      backgroundColor: '#EF4444',
      borderColor:     '#dc2626',
      extendedProps: { priority: 'High', status: 'In Progress' }
    }
  ];

  const handleEventClick = (info: any) => {
    alert('Clicked: ' + info.event.title);
  };

  return (
    <div
      className="glass-card"
      style={{ height: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}
    >
      <h2 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '1rem', letterSpacing: '-0.01em' }}>SLA Calendar</h2>
      <div style={{ flex: 1 }}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left:   'prev,next today',
            center: 'title',
            right:  'dayGridMonth,timeGridWeek,timeGridDay'
          }}
          events={events}
          eventClick={handleEventClick}
          height="100%"
        />
      </div>
    </div>
  );
};

export default CalendarPage;

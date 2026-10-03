import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Users, CheckCircle2 } from 'lucide-react';

interface ForecastData {
  designer_id:                   number;
  designer_name:                 string;
  daily_capacity_hours:          number;
  is_overloaded_next_7_days:     boolean;
  overload_date:                 string | null;
  projected_capacity_percentage: number;
}

const ForecastingWidget = () => {
  const [forecasts, setForecasts] = useState<ForecastData[]>([]);

  useEffect(() => {
    setTimeout(() => {
      setForecasts([
        {
          designer_id: 1, designer_name: 'Alice',
          daily_capacity_hours: 8,
          is_overloaded_next_7_days: true,
          overload_date: '2026-10-02',
          projected_capacity_percentage: 115,
        },
        {
          designer_id: 2, designer_name: 'Bob',
          daily_capacity_hours: 8,
          is_overloaded_next_7_days: false,
          overload_date: null,
          projected_capacity_percentage: 75,
        },
      ]);
    }, 500);
  }, []);

  return (
    <div className="glass-card" style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.5rem' }}>
        <div className="icon-tile icon-tile-green">
          <TrendingUp size={18} />
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#0F172A', letterSpacing: '-0.02em' }}>
            7-Day Capacity Forecast
          </h3>
          <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>Predictive algorithm analysis</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {forecasts.map(f => {
          const overloaded = f.is_overloaded_next_7_days;
          const pct = Math.min(f.projected_capacity_percentage, 100);

          return (
            <div
              key={f.designer_id}
              style={{
                padding:      '1rem 1.1rem',
                borderRadius: 'var(--radius-md)',
                border:       `1px solid ${overloaded ? 'rgba(239,68,68,0.15)' : 'rgba(226,232,240,0.85)'}`,
                background:   overloaded ? 'rgba(239,68,68,0.04)' : 'rgba(0,63,138,0.02)',
                transition:   'all 0.2s',
              }}
            >
              {/* Name + percentage */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 'var(--radius-btn)', flexShrink: 0,
                    background: overloaded ? 'rgba(239,68,68,0.08)' : 'rgba(0,63,138,0.06)',
                    border:     `1px solid ${overloaded ? 'rgba(239,68,68,0.15)' : 'rgba(0,63,138,0.12)'}`,
                    display:    'flex', alignItems: 'center', justifyContent: 'center',
                    color:      overloaded ? '#EF4444' : '#003F8A',
                  }}>
                    <Users size={13} />
                  </div>
                  {f.designer_name}
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: overloaded ? '#EF4444' : '#059669', fontFamily: 'var(--font-heading)' }}>
                  {f.projected_capacity_percentage}% Booked
                </span>
              </div>

              {/* Progress bar */}
              <div style={{
                width: '100%', height: 6, borderRadius: 99,
                background: 'rgba(226,232,240,0.7)', overflow: 'hidden',
                marginBottom: overloaded ? '0.6rem' : 0,
              }}>
                <div style={{
                  height:     '100%', width: `${pct}%`,
                  borderRadius: 99,
                  background: overloaded
                    ? 'linear-gradient(90deg,#EF4444,#f87171)'
                    : 'linear-gradient(90deg,#059669,#10B981)',
                  transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                }} />
              </div>

              {overloaded && (
                <p style={{ fontSize: '0.72rem', color: '#EF4444', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
                  <AlertTriangle size={12} />
                  Bottleneck predicted on {f.overload_date}. Reassign tasks.
                </p>
              )}

              {!overloaded && (
                <p style={{ fontSize: '0.72rem', color: '#059669', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, marginTop: '0.4rem', fontFamily: 'var(--font-body)' }}>
                  <CheckCircle2 size={12} />
                  On track — capacity available.
                </p>
              )}
            </div>
          );
        })}

        {forecasts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.82rem' }}>
            Loading forecast data…
          </div>
        )}
      </div>
    </div>
  );
};

export default ForecastingWidget;

import { useEffect, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, AreaChart, Area
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';

const slaData = [
  { name: 'Mon', breached: 2, met: 15 },
  { name: 'Tue', breached: 1, met: 18 },
  { name: 'Wed', breached: 0, met: 22 },
  { name: 'Thu', breached: 4, met: 14 },
  { name: 'Fri', breached: 1, met: 20 },
];

const workloadData = [
  { name: 'Alice (UI/UX)',    tasks: 8,  capacity: 10 },
  { name: 'Bob (Graphic)',    tasks: 12, capacity: 10 },
  { name: 'Charlie (Video)',  tasks: 3,  capacity: 8  },
];

const adherenceData = [
  { period: 'Last 30 Days', met: 94, breached: 6 },
  { period: 'Last 60 Days', met: 89, breached: 11 },
  { period: 'Last 90 Days', met: 85, breached: 15 },
];

const velocityData = [
  { type: 'Landing Page', avgHrs: 18.5 },
  { type: 'Social Media', avgHrs: 3.2 },
  { type: 'Video Promo', avgHrs: 22.0 },
  { type: 'Display Ads', avgHrs: 4.5 },
];

const cfdData = [
  { day: 'Mon', 'New': 10, 'Designing': 5, 'In Review': 2, 'Done': 1 },
  { day: 'Tue', 'New': 12, 'Designing': 7, 'In Review': 4, 'Done': 2 },
  { day: 'Wed', 'New': 15, 'Designing': 8, 'In Review': 8, 'Done': 5 },
  { day: 'Thu', 'New': 16, 'Designing': 6, 'In Review': 12, 'Done': 10 },
  { day: 'Fri', 'New': 18, 'Designing': 5, 'In Review': 15, 'Done': 14 },
];

/* ── Animated counter ─────────────────────────── */
function useCountUp(target: number, duration = 1800, deps: any[] = []) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  const start = useRef<number | undefined>(undefined);

  useEffect(() => {
    start.current = undefined;
    const step = (timestamp: number) => {
      if (!start.current) start.current = timestamp;
      const prog = Math.min((timestamp - start.current) / duration, 1);
      const eased = 1 - Math.pow(1 - prog, 3);
      setVal(Math.round(eased * target));
      if (prog < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return val;
}

function StatCard({
  label, rawValue, unit = '', suffix = '', icon: Icon, trend, trendLabel, trendTone = 'positive', color = '#003F8A', delay = 0,
}: {
  label: string; rawValue: number; unit?: string; suffix?: string;
  icon: any; trend: 'up' | 'down'; trendLabel: string;
  trendTone?: 'positive' | 'negative'; color?: string; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const count = useCountUp(rawValue, 1800, [visible]);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const isPositive = trendTone === 'positive';
  const TrendIcon = trend === 'up' ? TrendingUp : TrendingDown;

  return (
    <div
      ref={ref}
      className="dashboard-stat-card glass-card animate-fade-in-up"
      style={{
        padding: '1.25rem',
        animationDelay: `${delay}ms`, animationFillMode: 'both',
      }}
    >
      <div className="dashboard-stat-icon">
        <div className="icon-tile" style={{ background: `${color}10`, borderColor: `${color}20`, color }}>
          <Icon size={18} />
        </div>
      </div>
      <p className="section-label dashboard-stat-label">{label}</p>
      <p className="kpi-number dashboard-stat-number" style={{ color }}>
        {unit}{visible ? count.toLocaleString('en-IN') : 0}{suffix}
      </p>
      <p className="dashboard-stat-trend" style={{ color: isPositive ? '#047857' : '#B91C1C' }}>
        <TrendIcon size={12} aria-hidden="true" />
        {trendLabel}
      </p>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { borderRadius: 'var(--radius-sm)', border: '1px solid rgba(226,232,240,0.85)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', boxShadow: '0 4px 12px rgba(0,63,138,0.06)' },
};

const Dashboard = () => (
  <div className="dashboard-page">
    <div className="dashboard-intro">
      <h1>Performance at a glance</h1>
      <p>Weekly workload, delivery pace, and SLA health in one place.</p>
    </div>
    {/* KPI Row */}
    <div className="dashboard-kpis">
      <StatCard label="Tasks this week" rawValue={59} icon={CheckCircle2} trend="up" trendLabel="12% from last week" color="#003F8A" delay={0} />
      <StatCard label="Avg. completion" rawValue={4} suffix=" hrs" unit="" icon={Clock} trend="down" trendLabel="0.5 hrs faster" color="#047857" delay={80} />
      <StatCard label="SLA breach rate" rawValue={8} suffix=".2%" unit="" icon={AlertTriangle} trend="up" trendTone="negative" trendLabel="1.2% this week" color="#B91C1C" delay={160} />
    </div>

    {/* Charts */}
    <div className="dashboard-chart-grid">
      {/* SLA Trend */}
      <div
        className="dashboard-chart-card glass-card animate-fade-in-up stagger-3"
        style={{ padding: '1.5rem', animationFillMode: 'both' }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '1rem' }}>SLA Performance Trends</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={slaData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.6)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem' }} />
              <Line type="monotone" dataKey="met"      stroke="#10B981" strokeWidth={2.5} name="SLA Met"      dot={{ r: 4, fill: '#10B981' }} />
              <Line type="monotone" dataKey="breached" stroke="#EF4444" strokeWidth={2.5} name="SLA Breached" dot={{ r: 4, fill: '#EF4444' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Designer Workload */}
      <div
        className="dashboard-chart-card glass-card animate-fade-in-up stagger-4"
        style={{ padding: '1.5rem', animationFillMode: 'both' }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '1rem' }}>Designer Workload</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={workloadData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.6)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: '#64748B' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem' }} />
              <Bar dataKey="tasks"    fill="#003F8A" name="Active Tasks"  radius={[6, 6, 0, 0]} />
              <Bar dataKey="capacity" fill="rgba(0,63,138,0.15)" name="Max Capacity" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
    <div className="dashboard-chart-grid dashboard-chart-grid-secondary">
      {/* SLA Adherence Dashboard */}
      <div
        className="dashboard-chart-card glass-card animate-fade-in-up stagger-5"
        style={{ padding: '1.5rem', animationFillMode: 'both' }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '1rem' }}>SLA Adherence (30/60/90 Days)</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={adherenceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.6)" />
              <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <Tooltip {...tooltipStyle} formatter={(val) => `${val}%`} />
              <Legend wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem' }} />
              <Bar dataKey="met" stackId="a" fill="#10B981" name="SLA Met (%)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="breached" stackId="a" fill="#EF4444" name="SLA Breached (%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Designer Velocity Metrics */}
      <div
        className="dashboard-chart-card glass-card animate-fade-in-up stagger-5"
        style={{ padding: '1.5rem', animationFillMode: 'both' }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '1rem' }}>Designer Velocity Metrics</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={velocityData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(226,232,240,0.6)" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <YAxis dataKey="type" type="category" axisLine={false} tickLine={false} width={100} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <Tooltip {...tooltipStyle} formatter={(val) => `${val} hrs`} />
              <Bar dataKey="avgHrs" fill="#8B5CF6" name="Avg. Time Invested (Hrs)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>

    {/* Cumulative Flow Diagram */}
    <div className="dashboard-chart-grid-full">
      <div
        className="dashboard-chart-card glass-card animate-fade-in-up stagger-6"
        style={{ padding: '1.5rem', animationFillMode: 'both' }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '0.5rem' }}>Cumulative Flow Diagram (CFD)</h3>
        <p style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '1.5rem' }}>Visualizes bottlenecks by plotting the total volume of tickets in each stage over time. (Notice how "In Review" spikes on Thu/Fri).</p>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cfdData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.6)" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: 'var(--font-body)', fontSize: 11, fill: '#64748B' }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem' }} />
              <Area type="monotone" dataKey="Done" stackId="1" stroke="#10B981" fill="#10B981" />
              <Area type="monotone" dataKey="In Review" stackId="1" stroke="#F59E0B" fill="#F59E0B" />
              <Area type="monotone" dataKey="Designing" stackId="1" stroke="#3B82F6" fill="#3B82F6" />
              <Area type="monotone" dataKey="New" stackId="1" stroke="#94A3B8" fill="#94A3B8" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>

    {/* Capacity Heatmap */}
    <CapacityHeatmap />
  </div>
);

/* ── Capacity Heatmap ─────────────────────── */
const DESIGNERS_HEATMAP = ['Alice (UI/UX)', 'Bob (Graphic)', 'Charlie (Video)'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const HEATMAP_DATA: Record<string, number[]> = {
  'Alice (UI/UX)':   [6, 8, 5, 9, 7],
  'Bob (Graphic)':   [10, 11, 8, 12, 9],
  'Charlie (Video)': [3, 4, 7, 5, 6],
};
const CAPACITIES: Record<string, number> = {
  'Alice (UI/UX)': 8, 'Bob (Graphic)': 10, 'Charlie (Video)': 8,
};

function heatColor(load: number, capacity: number): { bg: string; color: string; label: string } {
  const pct = load / capacity;
  if (pct >= 1)    return { bg: 'rgba(239,68,68,0.12)',    color: '#b91c1c',  label: 'Overloaded' };
  if (pct >= 0.8)  return { bg: 'rgba(249,115,22,0.12)',   color: '#c2410c',  label: 'High'       };
  if (pct >= 0.5)  return { bg: 'rgba(234,179,8,0.12)',    color: '#854d0e',  label: 'Medium'     };
  return                  { bg: 'rgba(16,185,129,0.1)',    color: '#065f46',  label: 'Low'        };
}

function CapacityHeatmap() {
  return (
    <div className="dashboard-chart-grid-full" style={{ marginTop: '1rem' }}>
      <div className="dashboard-chart-card glass-card animate-fade-in-up" style={{ padding: '1.5rem', animationFillMode: 'both' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A', marginBottom: '0.35rem' }}>
          Capacity Heatmap — This Week
        </h3>
        <p style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '1.25rem' }}>
          Hours allocated per designer per day vs. their daily capacity. Red = overloaded, green = available bandwidth.
        </p>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {[['Low (&lt;50%)', 'rgba(16,185,129,0.12)', '#065f46'], ['Medium (50–79%)', 'rgba(234,179,8,0.12)', '#854d0e'], ['High (80–99%)', 'rgba(249,115,22,0.12)', '#c2410c'], ['Overloaded (≥100%)', 'rgba(239,68,68,0.12)', '#b91c1c']].map(([label, bg, color]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', fontWeight: 600, color }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: bg, border: `1px solid ${color}30`, display: 'inline-block' }} />
              <span dangerouslySetInnerHTML={{ __html: label }} />
            </span>
          ))}
        </div>

        {/* Grid */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '4px', fontFamily: 'var(--font-body)' }}>
            <thead>
              <tr>
                <th style={{ width: 130, textAlign: 'left', fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', paddingBottom: 6 }}>Designer</th>
                {DAYS.map(d => (
                  <th key={d} style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', paddingBottom: 6, textAlign: 'center', minWidth: 72 }}>{d}</th>
                ))}
                <th style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', paddingBottom: 6, textAlign: 'center', minWidth: 60 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {DESIGNERS_HEATMAP.map(designer => {
                const hours    = HEATMAP_DATA[designer];
                const capacity = CAPACITIES[designer];
                const total    = hours.reduce((a, b) => a + b, 0);
                const weekCap  = capacity * 5;
                const { bg: totalBg, color: totalColor } = heatColor(total, weekCap);
                return (
                  <tr key={designer}>
                    <td style={{ fontSize: '0.75rem', fontWeight: 700, color: '#374151', paddingRight: 8, whiteSpace: 'nowrap' }}>{designer}</td>
                    {hours.map((h, i) => {
                      const { bg, color, label } = heatColor(h, capacity);
                      return (
                        <td key={i} title={`${h}h / ${capacity}h — ${label}`}
                          style={{ background: bg, border: `1px solid ${color}20`, borderRadius: 8, padding: '0.5rem 0.25rem', textAlign: 'center', cursor: 'default' }}
                        >
                          <div style={{ fontSize: '0.82rem', fontWeight: 800, color, lineHeight: 1 }}>{h}h</div>
                          <div style={{ fontSize: '0.58rem', color, opacity: 0.7, marginTop: 2 }}>/ {capacity}h</div>
                        </td>
                      );
                    })}
                    <td title={`${total}h / ${weekCap}h weekly`}
                      style={{ background: totalBg, border: `1px solid ${totalColor}20`, borderRadius: 8, padding: '0.5rem 0.25rem', textAlign: 'center' }}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 800, color: totalColor, lineHeight: 1 }}>{total}h</div>
                      <div style={{ fontSize: '0.58rem', color: totalColor, opacity: 0.7, marginTop: 2 }}>{Math.round(total / weekCap * 100)}%</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;

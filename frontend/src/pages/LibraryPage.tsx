import React, { useState } from 'react';
import { Folder, Image as ImageIcon, Search, Tag, MoreVertical, Upload } from 'lucide-react';

const LibraryPage = () => {
  const [activeTag, setActiveTag] = useState('');

  const folders = [
    { id: 1, name: 'Logos & Branding',       items: 12 },
    { id: 2, name: 'Social Media Templates', items: 45 },
    { id: 3, name: 'Website Assets',         items: 28 },
  ];

  const assets = [
    { id: 1, name: 'Primary_Logo.eps',           type: 'vector',   tags: ['#logo', '#brand'],        date: 'Oct 12, 2026', size: '2.4 MB' },
    { id: 2, name: 'Summer_Sale_IG.jpg',          type: 'image',    tags: ['#social', '#summer_sale'], date: 'Oct 14, 2026', size: '1.1 MB' },
    { id: 3, name: 'Brand_Guidelines.pdf',        type: 'document', tags: ['#guidelines', '#brand'],   date: 'Sep 30, 2026', size: '5.6 MB' },
    { id: 4, name: 'Secondary_Logo_White.png',    type: 'image',    tags: ['#logo', '#brand'],        date: 'Oct 12, 2026', size: '0.8 MB' },
  ];

  const popularTags = ['#brand', '#social', '#logo', '#summer_sale', '#website'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'clamp(1.2rem,2.5vw,1.6rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          Brand Asset Library
        </h2>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={15} />
            <input
              className="input-field"
              type="text"
              placeholder="Search assets or #tags…"
              style={{ paddingLeft: '2.2rem', width: 220 }}
            />
          </div>
          <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '0.6rem 1rem' }}>
            <Upload size={14} /> Upload
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div
          className="glass-card"
          style={{ width: 210, flexShrink: 0, padding: '1.25rem 1rem', overflowY: 'auto', borderRadius: 'var(--radius-lg)' }}
        >
          <p className="section-label" style={{ marginBottom: '0.6rem' }}>Folders</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li>
              <button
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.6rem',
                  background: 'rgba(0,63,138,0.06)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                  color: '#003F8A', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600,
                }}
              >
                <Folder size={16} /> All Assets
              </button>
            </li>
            {folders.map(f => (
              <li key={f.id}>
                <button
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '0.5rem 0.6rem', background: 'none', borderRadius: 'var(--radius-sm)', border: 'none',
                    cursor: 'pointer', color: '#475569', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,63,138,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Folder size={15} style={{ color: '#94a3b8' }} />
                    {f.name}
                  </span>
                  <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>{f.items}</span>
                </button>
              </li>
            ))}
          </ul>

          <p className="section-label" style={{ marginBottom: '0.6rem' }}>Popular Tags</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {popularTags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                className="chip"
                style={activeTag === tag ? { background: 'rgba(0,63,138,0.06)', borderColor: 'rgba(0,63,138,0.2)', color: '#003F8A' } : {}}
              >
                <Tag size={10} style={{ display: 'inline', marginRight: 2 }} />{tag}
              </button>
            ))}
          </div>
        </div>

        {/* Asset Grid */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.875rem' }}>
            {assets.map((asset, i) => (
              <div
                key={asset.id}
                className="glass-card animate-fade-in-up"
                style={{ overflow: 'hidden', padding: 0, animationDelay: `${i * 60}ms`, animationFillMode: 'both', cursor: 'pointer' }}
              >
                <div style={{ height: 110, background: 'rgba(0,63,138,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <ImageIcon size={28} style={{ color: 'rgba(0,63,138,0.25)' }} />
                  <button
                    style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 6, background: 'white', border: '1px solid rgba(226,232,240,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B', opacity: 0, transition: 'opacity 0.2s' }}
                    className="asset-menu"
                  >
                    <MoreVertical size={13} />
                  </button>
                </div>
                <div style={{ padding: '0.75rem' }}>
                  <h4 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{asset.name}</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8', marginBottom: 6 }}>
                    <span>{asset.date}</span>
                    <span>{asset.size}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {asset.tags.map(tag => (
                      <span key={tag} className="chip" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LibraryPage;

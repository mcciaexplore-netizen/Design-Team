import React, { useState, useRef, useEffect } from 'react';
import { authFetch } from '../api';
import { Send, MapPin, X, MessageCircle } from 'lucide-react';

interface Pin {
  id:        string;
  x:         number; // percentage 0–100
  y:         number;
  comment:   string;
  author:    string;
  createdAt: string;
  imageUrl:  string;
}

interface DesignProoferProps {
  ticketId: string;
  imageUrls: string[];
}

const DesignProofer: React.FC<DesignProoferProps> = ({ ticketId, imageUrls }) => {
  const [activeVersionIdx, setActiveVersionIdx] = useState(0);
  const [pins,            setPins]            = useState<Pin[]>([]);
  const [activePinDraft,  setActivePinDraft]  = useState<{ x: number; y: number } | null>(null);
  const [draftComment,    setDraftComment]    = useState('');
  const [selectedPinId,   setSelectedPinId]   = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    authFetch(`/api/tickets/${ticketId}/pinpoints`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPins(data.map((p: any) => ({
            id: p.id.toString(),
            x: parseFloat(p.x_pct),
            y: parseFloat(p.y_pct),
            comment: p.content,
            author: `User ${p.author_id}`,
            createdAt: p.created_at,
            imageUrl: p.image_url
          })));
        }
      })
      .catch(err => console.error("Failed to load pinpoints:", err));
  }, [ticketId]);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return;
    if (selectedPinId) { setSelectedPinId(null); return; }

    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left)  / rect.width)  * 100;
    const y = ((e.clientY - rect.top)   / rect.height) * 100;
    setActivePinDraft({ x, y });
    setDraftComment('');
  };

  const handleSavePin = async () => {
    if (!activePinDraft || !draftComment.trim()) return;
    
    const payload = {
      image_url: imageUrls[activeVersionIdx],
      x_pct: activePinDraft.x.toString(),
      y_pct: activePinDraft.y.toString(),
      content: draftComment
    };

    try {
      const res = await authFetch(`/api/tickets/${ticketId}/pinpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      const newPin: Pin = {
        id:        data.id.toString(),
        x:         parseFloat(data.x_pct),
        y:         parseFloat(data.y_pct),
        comment:   data.content,
        author:    `User ${data.author_id}`,
        createdAt: data.created_at,
        imageUrl:  data.image_url
      };
      
      setPins([...pins, newPin]);
      setActivePinDraft(null);
      setDraftComment('');
      setSelectedPinId(newPin.id);
    } catch (err) {
      console.error("Failed to save pin", err);
    }
  };

  return (
    <div
      className="glass-card"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: 0 }}
    >
      {/* Header */}
      <div style={{
        padding:      '0.875rem 1.25rem',
        borderBottom: '1px solid rgba(226,232,240,0.85)',
        background:   '#F8FAFC',
        display:      'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: '#0F172A' }}>Visual Proofing</h3>
          <select
            value={activeVersionIdx}
            onChange={(e) => {
              setActiveVersionIdx(Number(e.target.value));
              setPins([]); // Clear pins when switching versions for demo simplicity
              setSelectedPinId(null);
            }}
            style={{
              padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(226,232,240,0.85)',
              fontSize: '0.72rem', fontWeight: 600, fontFamily: 'var(--font-body)', background: 'white'
            }}
          >
            {imageUrls.map((_, idx) => (
              <option key={idx} value={idx}>Version {idx + 1}</option>
            ))}
          </select>
        </div>
        <span style={{
          fontSize: '0.68rem', fontWeight: 600, color: '#64748B',
          background: 'rgba(0,63,138,0.04)', border: '1px solid rgba(226,232,240,0.85)',
          borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.6rem',
          fontFamily: 'var(--font-body)',
        }}>
          Click image to drop a pin
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas area */}
        <div style={{
          flex:       1, overflow: 'auto',
          background: 'rgba(0,63,138,0.03)',
          display:    'flex', alignItems: 'center', justifyContent: 'center',
          padding:    '2rem',
        }}>
          <div style={{ position: 'relative', display: 'inline-block', boxShadow: 'var(--shadow-card-hover)', borderRadius: 'var(--radius-md)' }}>
            <img
              ref={imageRef}
              src={imageUrls[activeVersionIdx]}
              alt="Design Proof"
              style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', cursor: 'crosshair', objectFit: 'contain', borderRadius: 'var(--radius-md)' }}
              onClick={handleImageClick}
              draggable={false}
            />

            {/* Saved pins */}
            {pins.filter(pin => pin.imageUrl === imageUrls[activeVersionIdx]).map((pin, index) => {
              const active = selectedPinId === pin.id;
              return (
                <div
                  key={pin.id}
                  onClick={e => { e.stopPropagation(); setSelectedPinId(pin.id); setActivePinDraft(null); }}
                  style={{
                    position:      'absolute',
                    left:          `${pin.x}%`, top: `${pin.y}%`,
                    transform:     'translate(-50%, -50%)',
                    width:         26, height: 26,
                    borderRadius:  '99px',
                    background:    active ? '#003F8A' : 'white',
                    border:        `2px solid ${active ? '#003F8A' : '#003F8A'}`,
                    color:         active ? 'white' : '#003F8A',
                    fontSize:      '0.7rem', fontWeight: 800,
                    display:       'flex', alignItems: 'center', justifyContent: 'center',
                    cursor:        'pointer', zIndex: active ? 20 : 10,
                    boxShadow:     active ? '0 0 0 3px rgba(0,63,138,0.2)' : '0 2px 8px rgba(0,63,138,0.15)',
                    transition:    'all 0.2s',
                    fontFamily:    'var(--font-body)',
                  }}
                >
                  {index + 1}
                </div>
              );
            })}

            {/* Draft pin */}
            {activePinDraft && (
              <div style={{
                position:   'absolute',
                left:       `${activePinDraft.x}%`, top: `${activePinDraft.y}%`,
                transform:  'translate(-50%, -50%)',
                width:      26, height: 26,
                borderRadius: '99px',
                background: 'linear-gradient(135deg,#f97316,#fb923c)',
                border:     '2px solid white',
                display:    'flex', alignItems: 'center', justifyContent: 'center',
                zIndex:     30, color: 'white',
                boxShadow:  '0 4px 12px rgba(249,115,22,0.35)',
                animation:  'pulse-dot 1.2s ease-in-out infinite',
              }}>
                <MapPin size={13} />
              </div>
            )}
          </div>
        </div>

        {/* Comments sidebar */}
        <div style={{
          width:        300, flexShrink: 0,
          background:   'white',
          borderLeft:   '1px solid rgba(226,232,240,0.85)',
          display:      'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding:      '0.875rem 1rem',
            borderBottom: '1px solid rgba(226,232,240,0.85)',
            background:   '#F8FAFC',
            display:      'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <MessageCircle size={14} style={{ color: '#003F8A' }} />
            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-heading)' }}>
              Feedback ({pins.length})
            </h4>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {pins.length === 0 && !activePinDraft && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8' }}>
                <MessageCircle size={28} style={{ margin: '0 auto 0.5rem', color: 'rgba(0,63,138,0.15)' }} />
                <p style={{ fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}>No feedback yet.<br />Click the image to start.</p>
              </div>
            )}

            {pins.filter(pin => pin.imageUrl === imageUrls[activeVersionIdx]).map((pin, index) => {
              const active = selectedPinId === pin.id;
              return (
                <div
                  key={pin.id}
                  onClick={() => setSelectedPinId(pin.id)}
                  style={{
                    padding:      '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border:       `1px solid ${active ? 'rgba(0,63,138,0.25)' : 'rgba(226,232,240,0.85)'}`,
                    background:   active ? 'rgba(0,63,138,0.04)' : 'white',
                    cursor:       'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '99px',
                      background: active ? '#003F8A' : 'rgba(0,63,138,0.06)',
                      border:     `1px solid ${active ? '#003F8A' : 'rgba(0,63,138,0.15)'}`,
                      color:      active ? 'white' : '#003F8A',
                      fontSize:   '0.65rem', fontWeight: 800,
                      display:    'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-body)',
                    }}>
                      {index + 1}
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>{pin.author}</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.55 }}>{pin.comment}</p>
                </div>
              );
            })}
          </div>

          {/* Draft input */}
          {activePinDraft && (
            <div style={{
              padding:      '0.875rem',
              background:   'rgba(249,115,22,0.04)',
              borderTop:    '1px solid rgba(249,115,22,0.12)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f97316', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)' }}>
                  <MapPin size={12} /> New Pin
                </span>
                <button
                  onClick={() => setActivePinDraft(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}
                >
                  <X size={14} />
                </button>
              </div>
              <textarea
                autoFocus
                value={draftComment}
                onChange={e => setDraftComment(e.target.value)}
                placeholder="Type your feedback here…"
                className="input-field"
                style={{ height: 80, resize: 'none', padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}
              />
              <button
                onClick={handleSavePin}
                disabled={!draftComment.trim()}
                className="btn-primary"
                style={{
                  width: '100%', justifyContent: 'center', marginTop: 8,
                  padding: '0.6rem',
                  background: draftComment.trim() ? 'linear-gradient(135deg,#f97316,#fb923c)' : 'rgba(249,115,22,0.3)',
                  boxShadow: draftComment.trim() ? '0 4px 12px rgba(249,115,22,0.25)' : 'none',
                  cursor: draftComment.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '0.82rem',
                }}
              >
                <Send size={13} /> Post Comment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignProofer;

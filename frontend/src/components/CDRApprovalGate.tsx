import React, { useState } from 'react';
import { CheckCircle, Lock, Download, AlertCircle } from 'lucide-react';

interface CDRApprovalGateProps {
  status:          'In Review' | 'Delivered' | 'Approved';
  previewImageUrls: string[];
  onApprove:       (selectedIndex: number) => void;
}

const CDRApprovalGate: React.FC<CDRApprovalGateProps> = ({ status, previewImageUrls, onApprove }) => {
  const [isHovering,     setIsHovering]     = useState(false);
  const [selectedIndex,  setSelectedIndex]  = useState(0);

  const images = previewImageUrls?.length > 0 ? previewImageUrls : [];
  const isApproved = status === 'Approved';

  return (
    <div
      className="glass-card"
      style={{ overflow: 'hidden', padding: 0 }}
    >
      {/* Header */}
      <div style={{
        padding:      '0.875rem 1.25rem',
        borderBottom: '1px solid rgba(226,232,240,0.85)',
        background:   '#F8FAFC',
        display:      'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A' }}>
          Final Deliverable Review
        </h3>
        <span className={isApproved ? 'badge-green' : 'badge-blue'}>
          {status}
        </span>
      </div>

      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Preview area */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <p className="section-label">Preview (Flattened .JPG)</p>
              {images.length > 1 && (
                <span className="badge-blue">Option {selectedIndex + 1} of {images.length}</span>
              )}
            </div>

            <div style={{
              background:   'rgba(24,24,27,0.03)',
              borderRadius: 'var(--radius-md)',
              border:       '1px solid rgba(226,232,240,0.85)',
              height:       240,
              overflow:     'hidden',
              position:     'relative',
            }}>
              <img
                src={images[selectedIndex] || ''}
                alt={`Design Preview Option ${selectedIndex + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />

              {/* Carousel dots */}
              {images.length > 1 && !isApproved && (
                <div style={{
                  position:   'absolute', bottom: 0, left: 0, right: 0,
                  padding:    '0.5rem',
                  background: 'linear-gradient(transparent, rgba(15,23,42,0.5))',
                  display:    'flex', justifyContent: 'center', gap: 6,
                }}>
                  {images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedIndex(idx)}
                      aria-label={`View Option ${idx + 1}`}
                      style={{
                        width:         idx === selectedIndex ? 20 : 8,
                        height:        8,
                        borderRadius:  99,
                        background:    idx === selectedIndex ? 'white' : 'rgba(255,255,255,0.5)',
                        border:        'none', cursor: 'pointer',
                        transition:    'all 0.2s',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {!isApproved && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#64748B', marginTop: 8 }}>
                <AlertCircle size={13} style={{ color: '#f97316', flexShrink: 0 }} />
                Review carefully. Approving will lock the design and generate the CDR link.
              </p>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(226,232,240,0.85)' }} />

          {/* Action panel */}
          <div style={{ textAlign: 'center' }}>
            {isApproved ? (
              <>
                <div style={{
                  width: 48, height: 48, borderRadius: 'var(--radius-btn)', margin: '0 auto 0.875rem',
                  background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669',
                }}>
                  <CheckCircle size={22} />
                </div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A', marginBottom: 4 }}>Design Approved</h4>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1.25rem' }}>Source files are now unlocked.</p>
                <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.7rem' }}>
                  <Download size={15} /> Download CDR File
                </button>
                <p style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 8 }}>Link expires in 24 hours.</p>
              </>
            ) : (
              <>
                <div style={{
                  width: 48, height: 48, borderRadius: 'var(--radius-btn)', margin: '0 auto 0.875rem',
                  background:  isHovering ? 'rgba(239,68,68,0.08)' : 'rgba(226,232,240,0.4)',
                  border:      `1px solid ${isHovering ? 'rgba(239,68,68,0.2)' : 'rgba(226,232,240,0.85)'}`,
                  display:     'flex', alignItems: 'center', justifyContent: 'center',
                  color:       isHovering ? '#EF4444' : '#94a3b8',
                  transition:  'all 0.2s',
                }}>
                  <Lock size={22} />
                </div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: '#0F172A', marginBottom: 4 }}>Source File Locked</h4>
                <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1.25rem' }}>The CDR file is secured behind the approval gate.</p>

                <button
                  onClick={() => onApprove(selectedIndex)}
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '0.7rem', borderRadius: 'var(--radius-btn)', border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #059669, #10B981)', color: 'white',
                    fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-body)',
                    boxShadow: '0 4px 12px rgba(16,185,129,0.25)', transition: 'all 0.2s',
                    marginBottom: 8,
                  }}
                >
                  <CheckCircle size={15} /> Approve & Unlock
                </button>

                <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center', padding: '0.65rem' }}>
                  Request Revision
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CDRApprovalGate;

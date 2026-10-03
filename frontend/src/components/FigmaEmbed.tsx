import React from 'react';
import { Link2 } from 'lucide-react';

interface FigmaEmbedProps {
  url: string;
}

const FigmaEmbed: React.FC<FigmaEmbedProps> = ({ url }) => {
  if (!url) {
    return (
      <div style={{
        padding:      '1.25rem',
        background:   'rgba(0,63,138,0.03)',
        border:       '1px dashed rgba(0,63,138,0.15)',
        borderRadius: 'var(--radius-md)',
        textAlign:    'center',
        color:        '#94a3b8',
        fontSize:     '0.82rem',
        fontFamily:   'var(--font-body)',
        display:      'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <Link2 size={16} style={{ color: 'rgba(0,63,138,0.3)' }} />
        No Figma link provided.
      </div>
    );
  }

  /* Never frame anything but a real figma.com link, whatever the stored value is. */
  let host = '';
  try { const u = new URL(url); host = u.protocol === 'https:' ? u.hostname : ''; } catch { /* invalid */ }
  if (host !== 'www.figma.com' && host !== 'figma.com') {
    return (
      <div role="alert" style={{ padding: '1rem', color: '#b91c1c', fontSize: '0.82rem', border: '1px dashed rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)' }}>
        This link is not a valid Figma link, so it can't be previewed.
      </div>
    );
  }
  const embedUrl = `https://www.figma.com/embed?embed_host=designdesk&url=${encodeURIComponent(url)}`;

  return (
    <div style={{
      width:        '100%',
      aspectRatio:  '16/9',
      borderRadius: 'var(--radius-md)',
      overflow:     'hidden',
      border:       '1px solid rgba(226,232,240,0.85)',
      boxShadow:    'var(--shadow-card-resting)',
      marginTop:    '0.75rem',
    }}>
      <iframe
        style={{ width: '100%', height: '100%', display: 'block', border: 'none' }}
        src={embedUrl}
        allowFullScreen
        title="Figma Preview"
      />
    </div>
  );
};

export default FigmaEmbed;

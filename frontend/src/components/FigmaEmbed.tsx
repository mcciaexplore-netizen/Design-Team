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

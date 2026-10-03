export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-blue': '#003F8A',
        'secondary-blue': '#0056B3',
        'accent-green': '#10B981',
        'text-green': '#059669',
        'error-red': '#EF4444',
        'accent-purple': '#8B5CF6',
        'text-main': '#0F172A',
        'text-muted': '#475569',
        'text-subtle': '#64748B',
        'bg-alt': '#F8FAFC',
        'dark-surface': '#060913',
      },
      fontFamily: {
        heading: ['"Bricolage Grotesque"', 'sans-serif'],
        body: ['"Outfit"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card-resting': '0 15px 40px -10px rgba(0,63,138,0.04)',
        'card-hover': '0 20px 40px rgba(0,63,138,0.08)',
        'btn-primary': '0 4px 15px rgba(0,63,138,0.15)',
        'btn-primary-hover': '0 8px 25px rgba(0,63,138,0.25)',
      },
      borderRadius: {
        'sm': '8px',
        'btn': '10px',
        'md': '12px',
        'lg': '20px',
        'pill': '99px',
      },
      backgroundImage: {
        'primary-gradient': 'linear-gradient(135deg, #003F8A 0%, #0056B3 100%)',
        'page-gradient': 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
      }
    },
  },
  plugins: [],
}

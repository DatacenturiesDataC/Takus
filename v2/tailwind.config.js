/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        takus: {
          bg:              '#06060f',
          surface:         'rgba(255,255,255,0.04)',
          border:          'rgba(255,255,255,0.08)',
          primary:         '#7c3aed',
          'primary-light': '#a78bfa',
          success:         '#10b981',
          danger:          '#f43f5e',
          warning:         '#f59e0b',
          info:            '#06b6d4',
          recording:       '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['14px', '20px'],
        base: ['16px', '24px'],
        lg: ['18px', '28px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0,0,0,0.3)',
        'glass-lg': '0 16px 50px rgba(0,0,0,0.6)',
        glow: '0 0 20px rgba(124,58,237,0.4)',
      },
      backdropBlur: {
        xs: '4px',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'pulse-record': 'pulseRecord 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseRecord: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};

import type { Config } from 'tailwindcss'

/*
 * Design tokens actually referenced by the markup.
 *
 * Most styling here goes through CSS custom properties (`var(--…)`) defined in
 * src/index.css, so only the tokens that appear in real utility classes are
 * declared below — everything else was pruned so dead tokens can't linger.
 * The color names are the exception: they exist so `text-danger`,
 * `bg-success/10`, `bg-navy-deep` etc. resolve without arbitrary values.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        'accent-blue': 'var(--accent-blue)',
        'accent-gold': 'var(--accent-gold)',
        'navy-deep': 'var(--navy-deep)',
        danger: 'var(--danger)',
        success: 'var(--success)',
      },
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        body: ['DM Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        manrope: ['Manrope', 'DM Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(32px, 4.5vw, 52px)', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-lg': ['clamp(28px, 3.5vw, 44px)', { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '700' }],
        'section': ['clamp(34px, 4.5vw, 52px)', { lineHeight: '1.08', letterSpacing: '-0.01em', fontWeight: '700' }],
        'section-xl': ['clamp(34px, 4.5vw, 52px)', { lineHeight: '1.08', letterSpacing: '-0.01em', fontWeight: '700' }],
        'section-lg': ['clamp(28px, 3vw, 36px)', { lineHeight: '1.2', letterSpacing: '0', fontWeight: '700' }],
        'body-lg': ['1.125rem', { lineHeight: '1.65', letterSpacing: '0', fontWeight: '400' }],
        'body': ['1rem', { lineHeight: '1.6', letterSpacing: '0', fontWeight: '400' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '400' }],
        'label': ['0.8125rem', { lineHeight: '1.4', letterSpacing: '0.01em', fontWeight: '600' }],
      },
      /* `widest` widens the Tailwind default (0.1em → 0.15em) for the
         uppercase micro-labels; the other names come from Tailwind itself. */
      letterSpacing: {
        widest: '0.15em',
      },
      lineHeight: {
        relaxed: '1.65',
      },
      boxShadow: {
        'focus-gold': '0 0 0 3px var(--focus-ring-gold)',
      },
      animation: {
        'marquee-left': 'marqueeLeft 40s linear infinite',
        'marquee-right': 'marqueeRight 35s linear infinite',
        shimmer: 'shimmerSweep 2.5s ease-in-out infinite',
        checkmark: 'checkmark 0.6s ease 0.3s both',
        'danger-pulse': 'dangerPulse 1.6s ease-in-out infinite',
        'slide-up': 'slideUp 0.4s ease forwards',
      },
      keyframes: {
        marqueeLeft: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        marqueeRight: {
          '0%': { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0)' },
        },
        checkmark: {
          '0%': { transform: 'scale(0) rotate(45deg)', opacity: '0' },
          '50%': { transform: 'scale(1.2) rotate(45deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(45deg)', opacity: '1' },
        },
        dangerPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config

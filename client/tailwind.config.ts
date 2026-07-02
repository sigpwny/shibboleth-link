import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{astro,html,js,ts,svelte}',
  ],
  theme: {
    extend: {
      colors: {
        primary: "rgba(var(--rgb-primary), 1.0)",
        secondary: "rgba(var(--rgb-secondary), 1.0)",
        surface: {
          "000": "rgba(var(--rgb-surface-000), 1.0)",
          "050": "rgba(var(--rgb-surface-050), 1.0)",
          "100": "rgba(var(--rgb-surface-100), 1.0)",
          "150": "rgba(var(--rgb-surface-150), 1.0)",
        },
        text: "rgba(var(--rgb-text), 1.0)",
      },
      container: {
        center: true,
      },
    },
  },
  plugins: [],
}
export default config

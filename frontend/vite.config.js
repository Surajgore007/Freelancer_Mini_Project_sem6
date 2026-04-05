import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tailwind removed: index.css now uses plain native CSS custom properties
// (the previous @import "tailwindcss" + @theme {} approach caused CSS variables
//  to never resolve as real var(--color-*) values in vanilla CSS).
export default defineConfig({
  plugins: [react()],
})

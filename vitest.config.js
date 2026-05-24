import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/lib/__tests__/setup.js'],
    include: [
      'src/**/__tests__/**/*.test.js',
      'netlify/functions/__tests__/**/*.test.js',
    ],
  },
});

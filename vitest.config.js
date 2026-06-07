import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 30000,
    fileParallelism: false,
    setupFiles: ['./src/lib/__tests__/setup.js'],
    include: [
      'src/**/__tests__/**/*.test.js',
      'netlify/functions/__tests__/**/*.test.js',
    ],
  },
});

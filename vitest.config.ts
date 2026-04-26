import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@content': path.resolve(__dirname, './src/content'),
      '@background': path.resolve(__dirname, './src/background'),
      '@storage': path.resolve(__dirname, './src/storage'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  }
});

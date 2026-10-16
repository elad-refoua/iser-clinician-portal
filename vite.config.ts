import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/web',
  base: process.env.PAGES_BASE || '/',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { fs: { allow: ['../..'] } },
});

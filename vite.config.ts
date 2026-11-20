import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:html` inlines everything (JS, CSS, Rapier's WebAssembly) into one dist/index.html
const single = process.env.SINGLE === '1';

export default defineConfig({
  plugins: [react(), single && viteSingleFile()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

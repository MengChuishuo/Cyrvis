import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Focused suite independent of the legacy workspace's missing setup file.
export default defineConfig({
  resolve: {
    alias: {
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/shared/companion.test.ts',
      'src/main/cyrvis/voice/qwen-omni.test.ts',
      'src/main/cyrvis/companion-voice-controls.test.ts',
      'src/shared/companion-skins.test.ts',
      'src/main/cyrvis/{controller,voice-brain,intent-gate,proactivity}.test.ts',
    ],
  },
});

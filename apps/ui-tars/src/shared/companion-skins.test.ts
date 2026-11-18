import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  codexAnimation,
  companionSkinImage,
  companionSkins,
  resolveCompanionSkin,
} from './companion-skins';
import type { CompanionState } from './companion';

const root = resolve(__dirname, '../../resources/cyrvis-companion');
const states: CompanionState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'working',
  'sleeping',
];

describe('companion skins', () => {
  it('recovers an unknown stored selection and resolves known selections', () => {
    expect(resolveCompanionSkin('removed').id).toBe('cyrvis');
    expect(resolveCompanionSkin(undefined).id).toBe('cyrvis');
    expect(resolveCompanionSkin('jarvis').format).toBe('gif');
    expect(new Set(companionSkins.map((s) => s.id)).size).toBe(
      companionSkins.length,
    );
  });
  it('has a local asset for every selectable skin and voice state', () => {
    for (const skin of companionSkins)
      for (const state of states) {
        expect(existsSync(resolve(root, companionSkinImage(skin, state)))).toBe(
          true,
        );
      }
  });
  it('preserves all downloaded image hashes', () => {
    const hashes: Record<string, string> = JSON.parse(
      readFileSync(resolve(root, 'skins/SHA256SUMS.json'), 'utf8'),
    );
    for (const [file, hash] of Object.entries(hashes)) {
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(root, 'skins', file)))
          .digest('hex'),
        file,
      ).toBe(hash);
    }
  });
  it('never animates into unused Codex cells and rests when sleeping', () => {
    const populated = [6, 8, 8, 4, 5, 8, 6, 6, 6];
    for (const state of states) {
      const { row, frames } = codexAnimation(state);
      expect(frames).toBeGreaterThan(0);
      expect(frames).toBeLessThanOrEqual(populated[row]);
    }
    expect(codexAnimation('sleeping').frames).toBe(1);
    expect(codexAnimation('speaking')).toEqual({ row: 3, frames: 4 });
  });
});

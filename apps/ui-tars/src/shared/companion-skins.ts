import type { CompanionState } from './companion';

export interface CompanionSkin {
  id: string;
  name: string;
  group: string;
  directory: string;
  format: 'poses' | 'codex' | 'gif';
  voice: string;
}

export const companionSkins: readonly CompanionSkin[] = [
  {
    id: 'cyrvis',
    name: 'Cyrvis Robot',
    group: 'Cyrvis',
    directory: '',
    format: 'poses',
    voice: 'Tina',
  },
  ...[
    ['capoo--lan-kehan', '猫猫虫咖波 · Bugcat Capoo', 'Ryan'],
    ['bubu--gbn666', 'Bubu 小熊', 'Theo Calm'],
    ['agumon--legeling', '亚古兽 · Agumon', 'Evan'],
  ].map(
    ([slug, name, voice]): CompanionSkin => ({
      id: `awesome-${slug}`,
      name,
      group: 'Awesome Codex Pet',
      directory: `skins/awesome/${slug}/`,
      format: 'codex',
      voice,
    }),
  ),
  {
    id: 'jarvis',
    name: 'Jarvis',
    group: 'Local Jarvis',
    directory: 'skins/jarvis/',
    format: 'gif',
    voice: 'Raymond',
  },
];

/** Stored selections may outlive a removed/renamed asset pack. */
export function resolveCompanionSkin(id: unknown): CompanionSkin {
  return companionSkins.find((skin) => skin.id === id) ?? companionSkins[0];
}

// Codex v1/v2 share rows 0–8. Trailing atlas cells are deliberately blank.
export function codexAnimation(state: CompanionState) {
  const rows = {
    idle: { row: 0, frames: 6 },
    listening: { row: 6, frames: 6 },
    thinking: { row: 8, frames: 6 },
    speaking: { row: 3, frames: 4 },
    working: { row: 7, frames: 6 },
    sleeping: { row: 0, frames: 1 },
  };
  return rows[state];
}

export function companionSkinImage(skin: CompanionSkin, state: CompanionState) {
  if (skin.format === 'codex') return `${skin.directory}spritesheet.webp`;
  if (skin.format === 'poses') return `robot-${state}.png`;
  const files: Record<CompanionState, string> = {
    idle: 'idle.gif',
    listening: 'normal.gif',
    thinking: 'course.gif',
    speaking: 'normal.gif',
    working: 'course.gif',
    sleeping: 'closed-eyes.gif',
  };
  return skin.directory + files[state];
}

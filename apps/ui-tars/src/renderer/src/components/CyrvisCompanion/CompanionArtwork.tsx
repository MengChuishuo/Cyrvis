import type { CSSProperties } from 'react';
import {
  codexAnimation,
  companionSkinImage,
  resolveCompanionSkin,
} from '@shared/companion-skins';
import type { CompanionState } from '@shared/companion';

const images = import.meta.glob(
  [
    '../../../../../resources/cyrvis-companion/robot-*.png',
    '../../../../../resources/cyrvis-companion/skins/awesome/*/spritesheet.webp',
    '../../../../../resources/cyrvis-companion/skins/jarvis/*.gif',
  ],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>;
const urls = Object.fromEntries(
  Object.entries(images).map(([path, url]) => [
    path.split('/cyrvis-companion/')[1],
    url,
  ]),
);

export function CompanionArtwork({
  skinId,
  state,
  label,
}: {
  skinId?: string;
  state: CompanionState;
  label: string;
  dragging: boolean;
}) {
  const skin = resolveCompanionSkin(skinId);
  const src = urls[companionSkinImage(skin, state)];
  if (skin.format === 'codex') {
    const { row, frames } = codexAnimation(state);
    return (
      <span
        className="companion-artwork companion-sprite"
        role="img"
        aria-label={`${skin.name} ${label}`}
        data-skin={skin.id}
        data-row={row}
        key={`${skin.id}-${state}`}
        style={
          {
            backgroundImage: `url("${src}")`,
            backgroundPositionY: `${-row * 208}px`,
            // steps(N) shows cells 0..N-1; the loop resets before the endpoint.
            '--sprite-end': `${-frames * 192}px`,
            '--sprite-frames': frames,
            '--sprite-duration': `${frames * 140}ms`,
            animationPlayState: frames === 1 ? 'paused' : 'running',
          } as CSSProperties
        }
      />
    );
  }
  return (
    <img
      className="companion-artwork"
      draggable={false}
      src={src}
      data-skin={skin.id}
      alt={`${skin.id === 'cyrvis' ? 'CYRVIS' : skin.name} ${label}`}
    />
  );
}

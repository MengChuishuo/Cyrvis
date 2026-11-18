import ElectronStore from 'electron-store';

interface CompanionSettings {
  position: { x: number; y: number };
  skinId: string;
}

let store: ElectronStore<CompanionSettings> | undefined;

/** Shared by the appearance menu and voice service so selection changes are observable. */
export function getCompanionStore(): ElectronStore<CompanionSettings> {
  return (store ??= new ElectronStore<CompanionSettings>({
    name: 'cyrvis-companion',
  }));
}

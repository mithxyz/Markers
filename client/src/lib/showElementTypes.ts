/** DJ Show Builder — element type definitions. Single source of truth for type keys, labels, colors, and icons. */
export interface ElementTypeDef {
  type: string;
  label: string;
  shortLabel: string;
  color: string;
  textColor: string; // contrasting text color for blocks
  emoji: string;
}

export const SHOW_ELEMENT_TYPES: ElementTypeDef[] = [
  { type: 'pyro',      label: 'Pyro / Fireworks', shortLabel: 'Pyro',      color: '#ef4444', textColor: '#fff',     emoji: '🎆' },
  { type: 'laser',     label: 'Lasers',            shortLabel: 'Laser',     color: '#22d3ee', textColor: '#0a0a0b',  emoji: '⚡' },
  { type: 'co2',       label: 'CO2 / Cryo',        shortLabel: 'CO2',       color: '#93c5fd', textColor: '#0a0a0b',  emoji: '❄️' },
  { type: 'flames',    label: 'Flames / Fire',     shortLabel: 'Flames',    color: '#f97316', textColor: '#fff',     emoji: '🔥' },
  { type: 'confetti',  label: 'Confetti',          shortLabel: 'Confetti',  color: '#ec4899', textColor: '#fff',     emoji: '🎊' },
  { type: 'lighting',  label: 'Lighting / Wash',  shortLabel: 'Lighting',  color: '#a855f7', textColor: '#fff',     emoji: '💡' },
  { type: 'haze',      label: 'Haze / Fog',        shortLabel: 'Haze',      color: '#94a3b8', textColor: '#0a0a0b',  emoji: '🌫️' },
  { type: 'video',     label: 'Video / LED',       shortLabel: 'Video',     color: '#6366f1', textColor: '#fff',     emoji: '📺' },
  { type: 'lyrics',    label: 'Lyrics / Title',   shortLabel: 'Lyrics',    color: '#eab308', textColor: '#0a0a0b',  emoji: '🎤' },
  { type: 'spotlight', label: 'Spotlight',         shortLabel: 'Spot',      color: '#e2e8f0', textColor: '#0a0a0b',  emoji: '🔦' },
  { type: 'fx',        label: 'FX / Special',     shortLabel: 'FX',        color: '#84cc16', textColor: '#0a0a0b',  emoji: '✨' },
];

export const ELEMENT_TYPE_MAP = new Map(SHOW_ELEMENT_TYPES.map((e) => [e.type, e]));

export function getElementType(type: string): ElementTypeDef {
  return ELEMENT_TYPE_MAP.get(type) ?? { type, label: type, shortLabel: type, color: '#6b7280', textColor: '#fff', emoji: '•' };
}

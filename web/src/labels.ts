export { SLOT_NAMES, STAT_NAMES, GEM_COLOR_NAMES, ItemSlot, GemColor } from '../../shared/wow';

export const QUALITY_CLASS: Record<number, string> = { 2: 'q2', 3: 'q3', 4: 'q4' };

export const SOCKET_CSS: Record<number, string> = {
	1: '#c9c9c9', // meta
	2: '#e04b4b', // red
	3: '#4b8ae0', // blue
	4: '#e0cc4b', // yellow
	8: '#d0a0e0', // prismatic
};

export const wowheadUrl = (id: number) => `https://www.wowhead.com/tbc/item=${id}`;

export function formatDelta(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

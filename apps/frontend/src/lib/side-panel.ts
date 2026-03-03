const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_EXPANDED_WIDTH = 288;

export const SIDEBAR_DELTA = SIDEBAR_EXPANDED_WIDTH - SIDEBAR_COLLAPSED_WIDTH;
export const SIDE_PANEL_MIN_WIDTH = 288;
export const SIDE_PANEL_ANIMATION_DURATION = 500;
export const SIDE_PANEL_DEFAULT_WIDTH_RATIO = 0.5;
export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'nao:side-panel-width-ratio';

export function loadPersistedWidthRatio(): number {
	try {
		const stored = localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY);
		if (stored) {
			const value = parseFloat(stored);
			if (Number.isFinite(value) && value > 0 && value < 1) {
				return value;
			}
		}
	} catch {
		/* localStorage unavailable */
	}
	return SIDE_PANEL_DEFAULT_WIDTH_RATIO;
}

export const SIDEBAR_COLLAPSED_WIDTH = 52;
export const SIDEBAR_EXPANDED_WIDTH = 288;

export const SIDEBAR_DELTA = SIDEBAR_EXPANDED_WIDTH - SIDEBAR_COLLAPSED_WIDTH;
export const SIDE_PANEL_MIN_WIDTH = 288;
export const CHAT_PANEL_MIN_WIDTH = 320;
/** Also applied to the sidebar so both move in lockstep and the chat column in between doesn't wobble. */
export const SIDE_PANEL_ANIMATION_DURATION = 300;
export const SIDE_PANEL_ANIMATION_EASING = 'cubic-bezier(0.5, 0.5, 0, 1)';
export const SIDE_PANEL_DEFAULT_WIDTH_RATIO = 0.5;
export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'nao:side-panel-width-ratio';

/** Keeps the side panel above its minimum width while leaving the chat column at least its own minimum. */
export function clampSidePanelWidth(width: number, containerWidth: number): number {
	const maxWidth = Math.max(SIDE_PANEL_MIN_WIDTH, containerWidth - CHAT_PANEL_MIN_WIDTH);
	return Math.min(Math.max(width, SIDE_PANEL_MIN_WIDTH), maxWidth);
}

export function loadPersistedWidthRatio(defaultRatio = SIDE_PANEL_DEFAULT_WIDTH_RATIO): number {
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
	return defaultRatio;
}

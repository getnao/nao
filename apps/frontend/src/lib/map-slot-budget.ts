/**
 * Browsers cap active WebGL contexts per page (16 in Chrome) and silently kill the oldest one beyond that.
 * Keeping in-app maps under this budget leaves room for the PNG export map and the settings map.
 */
export const MAX_LIVE_MAPS = 10;

export interface MapSlotBudget {
	acquire: (onGranted: () => void) => () => void;
	liveCount: () => number;
}

/** Hands out a limited number of map slots; requests beyond the limit wait in order until a slot is released. */
export function createMapSlotBudget(limit: number): MapSlotBudget {
	const holders = new Set<symbol>();
	const waiting = new Map<symbol, () => void>();

	const grantWaitingRequests = () => {
		for (const [token, onGranted] of waiting) {
			if (holders.size >= limit) {
				return;
			}
			waiting.delete(token);
			holders.add(token);
			onGranted();
		}
	};

	return {
		acquire: (onGranted) => {
			const token = Symbol('map-slot');
			waiting.set(token, onGranted);
			grantWaitingRequests();
			return () => {
				waiting.delete(token);
				if (holders.delete(token)) {
					grantWaitingRequests();
				}
			};
		},
		liveCount: () => holders.size,
	};
}

export const mapSlotBudget = createMapSlotBudget(MAX_LIVE_MAPS);

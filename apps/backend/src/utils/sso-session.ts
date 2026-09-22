/* @license Enterprise */

export function hasSsoSessionExceededMaxAge(createdAt: Date, maxAgeSeconds: number, now = new Date()): boolean {
	return now.getTime() >= createdAt.getTime() + maxAgeSeconds * 1000;
}

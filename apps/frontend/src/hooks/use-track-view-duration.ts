import { useEffect, useRef } from 'react';

import type { AnalyticsAssetType } from '@nao/shared/types';

interface TrackViewDurationOptions {
	assetType: AnalyticsAssetType;
	chatId?: string | null;
	storyId?: string | null;
	storySlug?: string | null;
	versionNumber?: number | null;
	enabled?: boolean;
}

const MIN_DURATION_MS = 1_000;

function buildViewKey(opts: TrackViewDurationOptions): string | null {
	if (opts.assetType === 'chat') {
		return opts.chatId ? `chat:${opts.chatId}` : null;
	}
	if (opts.chatId && opts.storySlug) {
		return `story:${opts.chatId}/${opts.storySlug}`;
	}
	if (opts.storyId) {
		return `story:${opts.storyId}`;
	}
	return null;
}

export function useTrackViewDuration({
	assetType,
	chatId,
	storyId,
	storySlug,
	versionNumber,
	enabled = true,
}: TrackViewDurationOptions) {
	const viewKey = buildViewKey({ assetType, chatId, storyId, storySlug });
	const isEnabled = enabled && viewKey !== null;

	const accumulatedMs = useRef(0);
	const visibleSince = useRef<number | null>(null);
	const segmentStartedAt = useRef<number | null>(null);

	useEffect(() => {
		if (!isEnabled) {
			return;
		}

		const segmentMeta = { assetType, chatId, storyId, storySlug, versionNumber };

		const now = Date.now();
		accumulatedMs.current = 0;
		visibleSince.current = document.hidden ? null : now;
		segmentStartedAt.current = document.hidden ? null : now;

		const handleVisibilityChange = () => {
			if (document.hidden) {
				closeVisiblePeriod();
				flushSegment();
			} else {
				const at = Date.now();
				visibleSince.current = at;
				if (segmentStartedAt.current === null) {
					segmentStartedAt.current = at;
				}
			}
		};

		const handlePageHide = () => {
			closeVisiblePeriod();
			flushSegment();
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('pagehide', handlePageHide);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('pagehide', handlePageHide);

			closeVisiblePeriod();
			flushSegment();
		};

		function closeVisiblePeriod() {
			if (visibleSince.current !== null) {
				accumulatedMs.current += Date.now() - visibleSince.current;
				visibleSince.current = null;
			}
		}

		function flushSegment() {
			if (accumulatedMs.current < MIN_DURATION_MS) {
				return;
			}

			const { assetType: at, chatId: cid, storyId: sid, storySlug: slug, versionNumber: ver } = segmentMeta;
			const payload = JSON.stringify({
				assetType: at,
				chatId: cid ?? undefined,
				storyId: sid ?? undefined,
				storySlug: slug ?? undefined,
				versionNumber: ver ?? undefined,
				durationMs: Math.round(accumulatedMs.current),
				startedAt: segmentStartedAt.current ?? Date.now(),
			});

			navigator.sendBeacon('/api/analytics/view-duration', new Blob([payload], { type: 'application/json' }));

			accumulatedMs.current = 0;
			segmentStartedAt.current = null;
		}
	}, [viewKey, isEnabled, assetType, chatId, storyId, storySlug, versionNumber]);
}

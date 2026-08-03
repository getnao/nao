import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { rememberFavicon, resolveFaviconCandidates } from '@/lib/favicon';

interface FaviconProps {
	url?: string | null;
	/** Shown while no candidate loads, so a service without an icon still has one. */
	fallback: ReactNode;
	className?: string;
}

export function Favicon({ url, fallback, className }: FaviconProps) {
	const [failed, setFailed] = useState<string[]>([]);

	const candidates = useMemo(() => resolveFaviconCandidates(url), [url]);
	const src = candidates.find((candidate) => !failed.includes(candidate));

	if (!src) {
		return fallback;
	}

	const markFailed = () => {
		const remaining = candidates.filter((candidate) => candidate !== src && !failed.includes(candidate));
		if (remaining.length === 0) {
			rememberFavicon(url, null);
		}
		setFailed((previous) => [...previous, src]);
	};

	return <img src={src} alt='' className={className} onError={markFailed} onLoad={() => rememberFavicon(url, src)} />;
}

import { useMemo, useState } from 'react';
import McpIcon from '@/components/icons/model-context-protocol.svg';
import { useMcpContext } from '@/contexts/mcp';
import { cn } from '@/lib/utils';

export const McpServerIcon = ({ server, className }: { server?: string | null; className?: string }) => {
	const { servers } = useMcpContext();
	const [failed, setFailed] = useState<string[]>([]);

	const url = server ? servers?.find((entry) => entry.name === server)?.url : undefined;
	const candidates = useMemo(() => getFaviconCandidates(url), [url]);
	const src = candidates.find((candidate) => !failed.includes(candidate));

	if (!src) {
		return <McpIcon className={cn('shrink-0', className)} />;
	}

	const markFailed = () => setFailed((prev) => [...prev, src]);

	return (
		<img
			src={src}
			alt=''
			className={cn('shrink-0 rounded-[3px]', className)}
			onError={markFailed}
			onLoad={(event) => {
				if (event.currentTarget.naturalWidth <= 16) {
					markFailed();
				}
			}}
		/>
	);
};

/**
 * Favicon lookups via Google's favicon service, trying the exact host first
 * (e.g. mcp.linear.app) then the apex domain (linear.app). A 16px response is
 * Google's "not found" placeholder, which the component treats as a failure.
 */
const getFaviconCandidates = (url?: string): string[] => {
	if (!url) {
		return [];
	}
	try {
		const host = new URL(url).hostname;
		const apex = host.split('.').slice(-2).join('.');
		const hosts = host === apex ? [host] : [host, apex];
		return hosts.map((entry) => `https://www.google.com/s2/favicons?domain=${entry}&sz=64`);
	} catch {
		return [];
	}
};

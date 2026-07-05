import { useMemo, useState } from 'react';
import McpIcon from '@/components/icons/model-context-protocol.svg';
import { useMcpContext } from '@/contexts/mcp';
import { getFaviconCandidates } from '@/lib/mcp-favicon';
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

	return <img src={src} alt='' className={cn('shrink-0 rounded-[3px]', className)} onError={markFailed} />;
};

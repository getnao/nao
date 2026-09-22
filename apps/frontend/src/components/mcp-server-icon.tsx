import McpIcon from '@/components/icons/model-context-protocol.svg';
import { Favicon } from '@/components/ui/favicon';
import { useMcpContext } from '@/contexts/mcp';
import { cn } from '@/lib/utils';

export const McpServerIcon = ({ server, className }: { server?: string | null; className?: string }) => {
	const { servers } = useMcpContext();
	const url = server ? servers?.find((entry) => entry.name === server)?.url : undefined;

	return (
		<Favicon
			url={url}
			className={cn('shrink-0 rounded-[3px]', className)}
			fallback={<McpIcon className={cn('shrink-0', className)} />}
		/>
	);
};

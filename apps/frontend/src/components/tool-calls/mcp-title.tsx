import type { ReactNode } from 'react';
import { McpServerIcon } from '@/components/mcp-server-icon';

export const McpTitle = ({ server, children }: { server?: string | null; children: ReactNode }) => (
	<span className='inline-flex items-center gap-1.5'>
		<McpServerIcon server={server} className='size-4' />
		{children}
	</span>
);

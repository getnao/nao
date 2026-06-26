import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { McpServerStatus } from '@nao/shared';
import { trpcClient } from '@/main';

interface McpContextValue {
	servers: McpServerStatus[] | undefined;
	refresh: () => Promise<void>;
}

const McpContext = createContext<McpContextValue | null>(null);

export function McpProvider({ children }: { children: ReactNode }) {
	const [servers, setServers] = useState<McpServerStatus[] | undefined>(undefined);

	const refresh = useCallback(async () => {
		const data = await trpcClient.mcp.getServers.query();
		setServers(data);
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return <McpContext.Provider value={{ servers, refresh }}>{children}</McpContext.Provider>;
}

export function useMcpContext() {
	const context = useContext(McpContext);
	if (!context) {
		throw new Error('useMcpContext must be used within McpProvider');
	}
	return context;
}

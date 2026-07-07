import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { McpServerStatus } from '@nao/shared';
import { trpcClient } from '@/main';

interface McpContextValue {
	servers: McpServerStatus[] | undefined;
	configError: string | null;
	refresh: () => Promise<void>;
}

const McpContext = createContext<McpContextValue | null>(null);

export function McpProvider({ children }: { children: ReactNode }) {
	const [servers, setServers] = useState<McpServerStatus[] | undefined>(undefined);
	const [configError, setConfigError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const [data, error] = await Promise.all([
			trpcClient.mcp.getServers.query(),
			trpcClient.mcp.getConfigError.query(),
		]);
		setServers(data);
		setConfigError(error);
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return <McpContext.Provider value={{ servers, configError, refresh }}>{children}</McpContext.Provider>;
}

export function useMcpContext() {
	const context = useContext(McpContext);
	if (!context) {
		throw new Error('useMcpContext must be used within McpProvider');
	}
	return context;
}

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { McpState } from '@nao/shared';
import { trpcClient } from '@/main';

interface McpContextValue {
	mcpState: McpState | undefined;
	fetchMcpState: () => Promise<void>;
}

const McpContext = createContext<McpContextValue | null>(null);

export function McpProvider({ children }: { children: ReactNode }) {
	const [mcpState, setMcpState] = useState<McpState | undefined>(undefined);

	const fetchMcpState = useCallback(async () => {
		const data = await trpcClient.mcp.getState.query();
		setMcpState(data);
	}, []);

	useEffect(() => {
		fetchMcpState();
	}, [fetchMcpState]);

	return <McpContext.Provider value={{ mcpState, fetchMcpState }}>{children}</McpContext.Provider>;
}

export function useMcpContext() {
	const context = useContext(McpContext);
	if (!context) {
		throw new Error('useMcpContext must be used within McpProvider');
	}
	return context;
}

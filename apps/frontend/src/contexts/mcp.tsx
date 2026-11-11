import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { McpServerStatus } from '@nao/shared';
import { trpc, trpcClient } from '@/main';
import { useMemoObject } from '@/hooks/useMemoObject';

interface McpContextValue {
	servers: McpServerStatus[] | undefined;
	configError: string | null;
	refresh: () => Promise<void>;
}

const McpContext = createContext<McpContextValue | null>(null);

export function McpProvider({ children }: { children: ReactNode }) {
	const [servers, setServers] = useState<McpServerStatus[] | undefined>(undefined);
	const [configError, setConfigError] = useState<string | null>(null);
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projectId = project.data?.id;
	const projectIdRef = useRef(projectId);
	const refreshIdRef = useRef(0);
	projectIdRef.current = projectId;

	const refresh = useCallback(async () => {
		const refreshId = ++refreshIdRef.current;
		if (!projectId) {
			setServers(undefined);
			setConfigError(null);
			return;
		}
		const [data, error] = await Promise.all([
			trpcClient.mcp.getServers.query(),
			trpcClient.mcp.getConfigError.query(),
		]);
		if (refreshId !== refreshIdRef.current || projectId !== projectIdRef.current) {
			return;
		}
		setServers(data);
		setConfigError(error);
	}, [projectId]);

	useEffect(() => {
		void refresh();
		return () => {
			refreshIdRef.current += 1;
		};
	}, [refresh]);

	const value = useMemoObject({ servers, configError, refresh });

	return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}

export function useMcpContext() {
	const context = useContext(McpContext);
	if (!context) {
		throw new Error('useMcpContext must be used within McpProvider');
	}
	return context;
}

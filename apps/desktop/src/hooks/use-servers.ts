import { useCallback, useEffect, useState } from 'react';

import { listServers } from '@/lib/commands';
import { describeCommandError, type Server } from '@/lib/servers';

export function useServers(reloadKey: string) {
	const [servers, setServers] = useState<Server[]>();
	const [error, setError] = useState<string>();

	const reload = useCallback(async () => {
		try {
			setServers(await listServers());
			setError(undefined);
		} catch (loadError) {
			setError(describeCommandError(loadError));
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload, reloadKey]);

	return { servers, error, reload };
}

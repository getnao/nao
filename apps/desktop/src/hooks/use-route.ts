import { useEffect, useMemo, useState } from 'react';

import { parseRoute, type Route } from '@/lib/routes';

export function useRoute(): Route {
	const [hash, setHash] = useState(() => window.location.hash);

	useEffect(() => {
		const updateHash = () => setHash(window.location.hash);
		window.addEventListener('hashchange', updateHash);
		return () => window.removeEventListener('hashchange', updateHash);
	}, []);

	return useMemo(() => parseRoute(hash), [hash]);
}

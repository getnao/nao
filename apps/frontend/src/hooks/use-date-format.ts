import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { DEFAULT_DATE_FORMAT_SETTINGS } from '@nao/shared/date';
import type { DateFormatSettings } from '@nao/shared/date';

import { trpc } from '@/main';

/**
 * Returns the project's date format settings, falling back to the European
 * default while the query is loading or when no project is selected.
 */
export function useDateFormat(): DateFormatSettings {
	const { data } = useQuery(trpc.project.getDisplaySettings.queryOptions());
	return useMemo(() => data?.dateFormat ?? { ...DEFAULT_DATE_FORMAT_SETTINGS }, [data?.dateFormat]);
}

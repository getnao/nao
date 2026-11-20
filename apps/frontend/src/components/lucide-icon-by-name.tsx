import { queryOptions, useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Renders any Lucide icon by name, loading only that icon's module; preloaded icons render on the first frame. */
export function LucideIconByName({
	name,
	fallback: Fallback,
	className,
}: {
	name: string | null;
	fallback: LucideIcon;
	className?: string;
}) {
	const icon = useQuery({ ...lucideIconQueryOptions(name ?? ''), enabled: name !== null });
	if (name === null || icon.data === null) {
		return <Fallback className={className} />;
	}
	if (!icon.data) {
		return <span aria-hidden className={cn('inline-block', className)} />;
	}
	const Icon = icon.data;
	return <Icon className={className} />;
}

export function lucideIconQueryOptions(name: string) {
	return queryOptions({
		queryKey: ['lucide-icon', name],
		queryFn: () => loadLucideIcon(name),
		staleTime: Infinity,
		gcTime: Infinity,
	});
}

async function loadLucideIcon(name: string): Promise<LucideIcon | null> {
	const { default: iconImports } = await import('lucide-react/dynamicIconImports');
	if (!Object.hasOwn(iconImports, name)) {
		return null;
	}
	const iconModule = await iconImports[name as keyof typeof iconImports]();
	return iconModule.default;
}

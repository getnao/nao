import { lazy, Suspense } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const DynamicLucideIcon = lazy(() => import('@/components/dynamic-lucide-icon'));

/** Renders any Lucide icon by name, loading the icon catalogue only when a name is given. */
export function LucideIconByName({
	name,
	fallback: Fallback,
	className,
}: {
	name: string | null;
	fallback: LucideIcon;
	className?: string;
}) {
	if (!name) {
		return <Fallback className={className} />;
	}
	return (
		<Suspense fallback={<span aria-hidden className={cn('inline-block', className)} />}>
			<DynamicLucideIcon name={name} fallback={Fallback} className={className} />
		</Suspense>
	);
}

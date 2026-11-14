import { DynamicIcon, iconNames } from 'lucide-react/dynamic';
import type { IconName } from 'lucide-react/dynamic';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const ICON_NAMES = new Set<string>(iconNames);

export default function DynamicLucideIcon({
	name,
	fallback: Fallback,
	className,
}: {
	name: string;
	fallback: LucideIcon;
	className?: string;
}) {
	if (!isLucideIconName(name)) {
		return <Fallback className={className} />;
	}
	return (
		<DynamicIcon
			name={name}
			className={className}
			fallback={() => <span aria-hidden className={cn('inline-block', className)} />}
		/>
	);
}

function isLucideIconName(name: string): name is IconName {
	return ICON_NAMES.has(name);
}

import { cn } from '@/lib/utils';
import { DEFAULT_BRAND_COLOR, useBranding } from '@/hooks/use-branding';

export function LastUsedPill({ className }: { className?: string }) {
	const branding = useBranding();
	const color = branding.enabled ? branding.brandColor : DEFAULT_BRAND_COLOR;
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-[10px] font-medium leading-none text-white ring-2 ring-background',
				className,
			)}
			style={{ backgroundColor: color ?? DEFAULT_BRAND_COLOR }}
		>
			Last used
		</span>
	);
}

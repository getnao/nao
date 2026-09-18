import { cn } from '@/lib/utils';
import { DEFAULT_BRAND_COLOR, useBranding } from '@/hooks/use-branding';

export function LastUsedPill({ className }: { className?: string }) {
	const branding = useBranding();
	const color = (branding.enabled ? branding.brandColor : DEFAULT_BRAND_COLOR) ?? DEFAULT_BRAND_COLOR;
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ring-2 ring-background',
				className,
			)}
			style={{ backgroundColor: color, color: chooseForeground(color) }}
		>
			Last used
		</span>
	);
}

/** Same WCAG relative-luminance contrast check used for the admin's brand color (see brand-color.tsx). */
function chooseForeground(bgHex: string): string {
	const bgLum = relativeLuminance(bgHex);
	const darkFgLum = 0.04;
	const whiteContrast = (1 + 0.05) / (bgLum + 0.05);
	const darkContrast = (bgLum + 0.05) / (darkFgLum + 0.05);
	return whiteContrast >= darkContrast ? '#ffffff' : 'oklch(0.21 0.008 270)';
}

function relativeLuminance(hex: string): number {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

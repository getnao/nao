import { Bug, X } from 'lucide-react';

import type { DevOverride } from '@/lib/dev-overrides';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { useDevOverrides } from '@/lib/dev-overrides';
import { cn } from '@/lib/utils';

export function DevOverridesPanel() {
	if (!import.meta.env.DEV) {
		return null;
	}

	return <DevOverridesControl />;
}

function DevOverridesControl() {
	const { license, cloud, panelExpanded, setLicense, setCloud, setPanelExpanded } = useDevOverrides();
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();
	const hasMultiProjectLicense = features.data?.['multi-project'] === true;
	const licenseValue =
		license === 'default' && features.isPending ? 'Loading' : hasMultiProjectLicense ? 'On' : 'Off';

	return (
		<div className='pointer-events-none fixed bottom-3 left-3 z-[100]'>
			{panelExpanded ? (
				<div className='pointer-events-auto w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl'>
					<div className='mb-3 flex items-center justify-between gap-2'>
						<div className='flex items-center gap-2'>
							<Bug className='size-4 text-amber-500' />
							<span className='text-sm font-semibold'>Dev UI overrides</span>
							<Badge variant='outline'>DEV</Badge>
						</div>
						<Button
							type='button'
							variant='ghost'
							size='icon-xs'
							aria-label='Collapse dev overrides'
							onClick={() => {
								setPanelExpanded(false);
							}}
						>
							<X />
						</Button>
					</div>

					<div className='flex flex-col gap-3'>
						<OverrideControl
							label='License (multi-project)'
							value={license}
							effectiveValue={licenseValue}
							onChange={setLicense}
						/>
						<OverrideControl
							label='Mode: cloud / self-hosted'
							value={cloud}
							effectiveValue={isCloud ? 'Cloud' : 'Self-hosted'}
							onChange={setCloud}
						/>
					</div>

					<p className='mt-3 text-xs text-muted-foreground'>Overrides only affect the UI, not the server.</p>
				</div>
			) : (
				<Button
					type='button'
					variant='outline'
					size='sm'
					className='pointer-events-auto bg-popover shadow-lg'
					onClick={() => {
						setPanelExpanded(true);
					}}
				>
					<Bug className='text-amber-500' />
					Dev UI
				</Button>
			)}
		</div>
	);
}

function OverrideControl({
	label,
	value,
	effectiveValue,
	onChange,
}: {
	label: string;
	value: DevOverride;
	effectiveValue: string;
	onChange: (value: DevOverride) => void;
}) {
	return (
		<div className='flex flex-col gap-1.5'>
			<div className='flex items-center justify-between gap-2'>
				<span className='text-xs font-medium'>{label}</span>
				<Badge variant={value === 'default' ? 'secondary' : 'admin'}>
					{value === 'default' ? 'Server' : 'Override'} · {effectiveValue}
				</Badge>
			</div>
			<div
				className='grid grid-cols-3 rounded-md border bg-muted/40 p-0.5'
				role='group'
				aria-label={`${label} override`}
			>
				{overrideOptions.map((option) => (
					<Button
						key={option.value}
						type='button'
						variant='ghost'
						size='sm'
						aria-pressed={value === option.value}
						className={cn(
							'h-6 px-2 text-xs shadow-none',
							value === option.value && 'bg-background shadow-xs',
						)}
						onClick={() => {
							onChange(option.value);
						}}
					>
						{option.label}
					</Button>
				))}
			</div>
		</div>
	);
}

const overrideOptions: Array<{ value: DevOverride; label: string }> = [
	{ value: 'default', label: 'Default' },
	{ value: 'on', label: 'On' },
	{ value: 'off', label: 'Off' },
];

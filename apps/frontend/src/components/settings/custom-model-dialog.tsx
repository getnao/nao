import { useEffect, useState } from 'react';
import type { CustomModelMetadata } from '@nao/backend/llm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface CustomModelDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	modelId: string;
	value: CustomModelMetadata | undefined;
	onSave: (metadata: CustomModelMetadata) => void;
}

type CostKey = 'inputNoCache' | 'inputCacheRead' | 'inputCacheWrite' | 'output';

const COST_FIELDS: { key: CostKey; label: string; hint: string }[] = [
	{ key: 'inputNoCache', label: 'Input', hint: 'Uncached input tokens' },
	{ key: 'output', label: 'Output', hint: 'Generated tokens' },
	{ key: 'inputCacheRead', label: 'Cache read', hint: 'Cached input tokens read' },
	{ key: 'inputCacheWrite', label: 'Cache write', hint: 'Cached input tokens written' },
];

export function CustomModelDialog({ open, onOpenChange, modelId, value, onSave }: CustomModelDialogProps) {
	const [displayName, setDisplayName] = useState('');
	const [costs, setCosts] = useState<Record<CostKey, string>>({
		inputNoCache: '',
		inputCacheRead: '',
		inputCacheWrite: '',
		output: '',
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		setDisplayName(value?.displayName ?? '');
		setCosts({
			inputNoCache: formatCost(value?.costPerM?.inputNoCache),
			inputCacheRead: formatCost(value?.costPerM?.inputCacheRead),
			inputCacheWrite: formatCost(value?.costPerM?.inputCacheWrite),
			output: formatCost(value?.costPerM?.output),
		});
	}, [open, value]);

	const handleSave = () => {
		const costPerM = buildCostPerM(costs);
		const trimmedName = displayName.trim();
		onSave({
			id: modelId,
			displayName: trimmedName || undefined,
			costPerM,
		});
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Custom model settings</DialogTitle>
					<DialogDescription className='font-mono text-xs break-all'>{modelId}</DialogDescription>
				</DialogHeader>

				<div className='grid gap-4'>
					<div className='grid gap-2'>
						<label htmlFor='custom-model-display-name' className='text-sm font-medium text-foreground'>
							Display name
							<span className='text-muted-foreground font-normal ml-1'>(optional)</span>
						</label>
						<Input
							id='custom-model-display-name'
							placeholder={modelId}
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
					</div>

					<div className='grid gap-2'>
						<div className='flex items-baseline justify-between'>
							<span className='text-sm font-medium text-foreground'>Token cost</span>
							<span className='text-xs text-muted-foreground'>USD / 1M tokens</span>
						</div>
						<div className='grid grid-cols-2 gap-3'>
							{COST_FIELDS.map((field) => (
								<div key={field.key} className='grid gap-1'>
									<label
										htmlFor={`custom-model-cost-${field.key}`}
										className='text-xs font-medium text-muted-foreground'
									>
										{field.label}
									</label>
									<div className='relative'>
										<span className='absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground'>
											$
										</span>
										<Input
											id={`custom-model-cost-${field.key}`}
											type='number'
											inputMode='decimal'
											step='0.01'
											min='0'
											placeholder='0'
											className='pl-6'
											value={costs[field.key]}
											onChange={(e) =>
												setCosts((prev) => ({ ...prev, [field.key]: e.target.value }))
											}
										/>
									</div>
								</div>
							))}
						</div>
						<p className='text-xs text-muted-foreground'>
							Leave a field empty to skip cost tracking for that token type.
						</p>
					</div>
				</div>

				<div className='flex justify-end gap-2 pt-2'>
					<Button variant='ghost' size='sm' onClick={() => onOpenChange(false)} type='button'>
						Cancel
					</Button>
					<Button size='sm' onClick={handleSave} type='button'>
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function formatCost(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value)) {
		return '';
	}
	return String(value);
}

function parseCost(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return undefined;
	}
	return parsed;
}

function buildCostPerM(costs: Record<CostKey, string>): CustomModelMetadata['costPerM'] {
	const parsed: NonNullable<CustomModelMetadata['costPerM']> = {
		inputNoCache: parseCost(costs.inputNoCache),
		inputCacheRead: parseCost(costs.inputCacheRead),
		inputCacheWrite: parseCost(costs.inputCacheWrite),
		output: parseCost(costs.output),
	};
	const hasAny = Object.values(parsed).some((v) => v !== undefined);
	return hasAny ? parsed : undefined;
}

import { displayMap } from '@nao/shared/tools';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

const DEFAULT_MARKER_COLOR = '#522bff';
const DEFAULT_MARKER_RADIUS = 5;

interface MapConfigEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	config: displayMap.Input;
	isSaving: boolean;
	onSave: (config: displayMap.Input) => Promise<void>;
	description: string;
}

export function MapConfigEditDialog({
	open,
	onOpenChange,
	config,
	isSaving,
	onSave,
	description,
}: MapConfigEditDialogProps) {
	const [draft, setDraft] = useState<displayMap.Input>(config);
	const [primaryHex, setPrimaryHex] = useState(DEFAULT_MARKER_COLOR);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(config);
			setPrimaryHex(resolvePrimaryHex());
			setError(null);
		}
	}, [open, config]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const parsed = displayMap.InputSchema.safeParse(draft);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? 'Invalid map configuration.');
			return;
		}

		try {
			await onSave(parsed.data);
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update map.');
		}
	};

	const updateRadius = (value: string) => {
		const parsed = value.trim() === '' ? undefined : Number(value);
		setDraft((prev) => ({ ...prev, marker_radius: Number.isFinite(parsed) ? parsed : undefined }));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Edit map</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						{description}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
					<div className='grid gap-2'>
						<label htmlFor='map-title' className='text-sm font-semibold text-foreground'>
							Title
						</label>
						<Input
							id='map-title'
							className='h-8 bg-panel'
							value={draft.title}
							onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
							placeholder='Map title'
						/>
					</div>

					<div className='grid gap-2'>
						<span className='text-sm font-semibold text-foreground'>Marker</span>
						<div className='flex items-center gap-3'>
							<input
								type='color'
								aria-label='Marker color'
								value={draft.marker_color ?? primaryHex}
								onChange={(e) => setDraft((prev) => ({ ...prev, marker_color: e.target.value }))}
								className='h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md bg-transparent p-0 shadow-xs [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none'
							/>
							<input
								type='range'
								aria-label='Marker size'
								min={3}
								max={30}
								value={draft.marker_radius ?? DEFAULT_MARKER_RADIUS}
								onChange={(e) => updateRadius(e.target.value)}
								className='min-w-0 flex-1 cursor-pointer accent-primary'
							/>
							<ArrowRight className='size-4 shrink-0 text-muted-foreground' />
							<MarkerPreview
								color={draft.marker_color ?? primaryHex}
								radius={draft.marker_radius ?? DEFAULT_MARKER_RADIUS}
							/>
							<Button
								type='button'
								variant='ghost'
								size='sm'
								className='h-8 shrink-0 rounded-full'
								onClick={() =>
									setDraft((prev) => ({
										...prev,
										marker_color: undefined,
										marker_radius: undefined,
									}))
								}
								disabled={!draft.marker_color && !draft.marker_radius}
							>
								Reset
							</Button>
						</div>
					</div>

					{error && <p className='text-xs text-destructive'>{error}</p>}

					<DialogFooter>
						<Button
							type='button'
							variant='ghost'
							className='rounded-full border'
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							variant='primary-gradient'
							type='submit'
							className='rounded-full'
							isLoading={isSaving}
							disabled={isSaving}
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

const MARKER_STROKE_WIDTH = 2;

function MarkerPreview({ color, radius }: { color: string; radius: number }) {
	const diameter = radius * 2 + MARKER_STROKE_WIDTH * 2;
	return (
		<div className='flex size-18 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-panel'>
			<span
				className='rounded-full shadow-sm'
				style={{
					width: diameter,
					height: diameter,
					backgroundColor: color,
					opacity: 0.9,
					border: `${MARKER_STROKE_WIDTH}px solid var(--background)`,
					boxSizing: 'border-box',
				}}
			/>
		</div>
	);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function resolvePrimaryHex(): string {
	if (typeof document === 'undefined') {
		return DEFAULT_MARKER_COLOR;
	}
	const context = document.createElement('canvas').getContext('2d');
	const value = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
	if (!value || !context) {
		return DEFAULT_MARKER_COLOR;
	}
	const sentinel = '#010203';
	context.fillStyle = sentinel;
	context.fillStyle = value;
	if (context.fillStyle === sentinel && value.toLowerCase() !== sentinel) {
		return DEFAULT_MARKER_COLOR;
	}
	context.fillRect(0, 0, 1, 1);
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
	const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
	return HEX_RE.test(hex) ? hex : DEFAULT_MARKER_COLOR;
}

import { useCallback, useEffect, useState } from 'react';
import { Activity, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface LiveStorySettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isLive: boolean;
	cacheTtlMinutes: number | null;
	refreshText: boolean;
	isUpdating: boolean;
	onSaveSettings: (settings: { isLive: boolean; cacheTtlMinutes: number | null; refreshText: boolean }) => void;
}

const TTL_OPTIONS = [
	{ value: 'manual', label: 'Manual refresh only' },
	{ value: '5', label: '5 minutes' },
	{ value: '15', label: '15 minutes' },
	{ value: '30', label: '30 minutes' },
	{ value: '60', label: '1 hour' },
	{ value: '360', label: '6 hours' },
	{ value: '1440', label: '24 hours' },
] as const;

export function LiveStorySettingsDialog({
	open,
	onOpenChange,
	isLive,
	cacheTtlMinutes,
	refreshText,
	isUpdating,
	onSaveSettings,
}: LiveStorySettingsDialogProps) {
	const [localIsLive, setLocalIsLive] = useState(isLive);
	const [localTtl, setLocalTtl] = useState<string>(cacheTtlMinutes?.toString() ?? 'manual');
	const [localRefreshText, setLocalRefreshText] = useState(refreshText);

	useEffect(() => {
		if (open) {
			setLocalIsLive(isLive);
			setLocalTtl(cacheTtlMinutes?.toString() ?? 'manual');
			setLocalRefreshText(refreshText);
		}
	}, [open, isLive, cacheTtlMinutes, refreshText]);

	const hasChanges =
		localIsLive !== isLive ||
		(localIsLive && localTtl !== (cacheTtlMinutes?.toString() ?? 'manual')) ||
		localRefreshText !== refreshText;

	const handleSave = useCallback(() => {
		const newTtl = localTtl === 'manual' ? null : parseInt(localTtl, 10);
		onSaveSettings({
			isLive: localIsLive,
			cacheTtlMinutes: localIsLive ? newTtl : null,
			refreshText: localIsLive ? localRefreshText : false,
		});
		onOpenChange(false);
	}, [localIsLive, localTtl, localRefreshText, onSaveSettings, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Live Story Settings</DialogTitle>
					<DialogDescription>
						A live story refreshes its data from the database instead of showing a static snapshot.
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-5'>
					<div className='flex items-center justify-between gap-4'>
						<div className='flex items-center gap-2.5'>
							<div className='flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600'>
								<Activity className='size-4' />
							</div>
							<div>
								<p className='text-sm font-medium'>Live mode</p>
								<p className='text-xs text-muted-foreground'>Re-run queries to refresh data</p>
							</div>
						</div>
						<Switch checked={localIsLive} onCheckedChange={setLocalIsLive} />
					</div>

					{localIsLive && (
						<>
							<div className='flex flex-col gap-2'>
								<label className='text-sm font-medium'>Cache expiration</label>
								<p className='text-xs text-muted-foreground'>
									How often the cached data should be automatically refreshed. You can always refresh
									manually using the refresh button.
								</p>
								<Select value={localTtl} onValueChange={setLocalTtl}>
									<SelectTrigger className='w-full'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TTL_OPTIONS.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className='flex items-center justify-between gap-4'>
								<div className='flex items-center gap-2.5'>
									<div className='flex size-8 items-center justify-center rounded-full bg-violet-100 text-violet-600'>
										<Sparkles className='size-4' />
									</div>
									<div>
										<p className='text-sm font-medium'>Refresh text analysis</p>
										<p className='text-xs text-muted-foreground'>
											Use AI to update the story text when data refreshes
										</p>
									</div>
								</div>
								<Switch checked={localRefreshText} onCheckedChange={setLocalRefreshText} />
							</div>
						</>
					)}
				</div>

				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!hasChanges || isUpdating}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

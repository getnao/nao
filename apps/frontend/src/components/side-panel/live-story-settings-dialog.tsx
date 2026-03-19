import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
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
	isUpdating: boolean;
	onToggleLive: (isLive: boolean) => void;
	onUpdateCacheTtl: (ttl: number | null) => void;
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
	isUpdating,
	onToggleLive,
	onUpdateCacheTtl,
}: LiveStorySettingsDialogProps) {
	const [localIsLive, setLocalIsLive] = useState(isLive);
	const [localTtl, setLocalTtl] = useState<string>(cacheTtlMinutes?.toString() ?? 'manual');

	useEffect(() => {
		if (open) {
			setLocalIsLive(isLive);
			setLocalTtl(cacheTtlMinutes?.toString() ?? 'manual');
		}
	}, [open, isLive, cacheTtlMinutes]);

	const hasChanges =
		localIsLive !== isLive || (localIsLive && localTtl !== (cacheTtlMinutes?.toString() ?? 'manual'));

	const handleSave = useCallback(() => {
		if (localIsLive !== isLive) {
			onToggleLive(localIsLive);
		}
		if (localIsLive) {
			const newTtl = localTtl === 'manual' ? null : parseInt(localTtl, 10);
			if (newTtl !== cacheTtlMinutes) {
				onUpdateCacheTtl(newTtl);
			}
		}
		onOpenChange(false);
	}, [localIsLive, localTtl, isLive, cacheTtlMinutes, onToggleLive, onUpdateCacheTtl, onOpenChange]);

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

import { useState } from 'react';

import type { CloudBillingStatus } from '@/hooks/use-organization-billing';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const membershipLabels: Record<CloudBillingStatus['members'][number]['membershipClass'], string> = {
	org_admin: 'Organization admin',
	org_member: 'Organization member',
	project_only: 'Project member',
};

export function CloudBillingSeats({
	data,
	disabled,
	onUpgrade,
	onAdjustSeats,
	onSelectSeats,
}: {
	data: CloudBillingStatus;
	disabled: boolean;
	onUpgrade?: () => void;
	onAdjustSeats?: () => void;
	onSelectSeats: (selectedUserIds: string[]) => Promise<unknown>;
}) {
	const [error, setError] = useState<string | null>(null);
	const seatedCount = data.members.filter((member) => member.seated).length;
	const capacity = data.seatLimit;
	const availableSeats = capacity === null ? null : Math.max(0, capacity - seatedCount);

	const changeSeat = async (userId: string, seated: boolean) => {
		if (seated && availableSeats === 0) {
			setError('No seats are available. Add seats or make someone read-only first.');
			return;
		}
		setError(null);
		const selectedUserIds = data.members
			.filter((member) => member.membershipClass !== 'org_admin' && member.seated && member.id !== userId)
			.map((member) => member.id);
		try {
			await onSelectSeats(seated ? [...selectedUserIds, userId] : selectedUserIds);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Unable to update seat access.');
		}
	};

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard
				title='Seat usage'
				description='Seats give people full access. Viewers and read-only members are always free.'
			>
				<div className='flex flex-wrap gap-x-10 gap-y-4'>
					<SeatStat label='Seats in use' value={seatedCount} />
					<SeatStat label='Available seats' value={availableSeats ?? 'Unlimited'} />
					{capacity !== null && (
						<SeatStat label={data.tier === 'team' ? 'Purchased' : 'Included'} value={capacity} />
					)}
				</div>
				{capacity !== null && <SeatUsageBar used={seatedCount} capacity={capacity} />}
				{data.tier === 'free' && onUpgrade && (
					<SeatAction
						title='Need more seats?'
						description='Upgrade to Team and pay only for the full-access seats you need.'
						label='Add seats'
						disabled={disabled}
						onClick={onUpgrade}
					/>
				)}
				{data.tier === 'team' && onAdjustSeats && (
					<SeatAction
						title='Paid capacity'
						description='Add seats now or schedule fewer seats for your next renewal.'
						label='Adjust seats'
						variant='secondary'
						disabled={disabled}
						onClick={onAdjustSeats}
					/>
				)}
			</SettingsCard>

			<SettingsCard
				flush
				title='Members'
				description={
					capacity === null
						? 'Everyone who needs full access has it on this plan.'
						: 'Seated members have full access. Read-only members keep their data and can be seated at any time.'
				}
			>
				{error && (
					<p className='border-b border-border p-4 text-sm text-destructive' role='alert'>
						{error}
					</p>
				)}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Membership</TableHead>
							<TableHead className='w-0 whitespace-nowrap'>Full access</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.members.map((member) => (
							<TableRow key={member.id}>
								<TableCell className='font-medium'>{member.name}</TableCell>
								<TableCell className='font-mono text-muted-foreground'>{member.email}</TableCell>
								<TableCell className='text-muted-foreground'>
									{membershipLabels[member.membershipClass]}
								</TableCell>
								<TableCell className='w-0'>
									<Switch
										checked={member.seated}
										disabled={
											disabled || capacity === null || member.membershipClass === 'org_admin'
										}
										aria-label={`Full access for ${member.name}`}
										onCheckedChange={(seated) => void changeSeat(member.id, seated)}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</SettingsCard>
		</div>
	);
}

function SeatAction({
	title,
	description,
	label,
	variant = 'default',
	disabled,
	onClick,
}: {
	title: string;
	description: string;
	label: string;
	variant?: 'default' | 'secondary';
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<div className='flex flex-col items-start gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between'>
			<div>
				<p className='text-sm font-medium text-foreground'>{title}</p>
				<p className='mt-1 text-xs text-muted-foreground'>{description}</p>
			</div>
			<Button variant={variant} disabled={disabled} onClick={onClick}>
				{label}
			</Button>
		</div>
	);
}

function SeatStat({ label, value }: { label: string; value: number | string }) {
	return (
		<div className='flex flex-col gap-1'>
			<span className='text-xl font-semibold text-foreground tabular-nums'>{value}</span>
			<span className='text-xs text-muted-foreground'>{label}</span>
		</div>
	);
}

function SeatUsageBar({ used, capacity }: { used: number; capacity: number }) {
	const width = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
	return (
		<div
			role='progressbar'
			aria-label='Seat usage'
			aria-valuemin={0}
			aria-valuemax={capacity}
			aria-valuenow={Math.min(used, capacity)}
			className='h-1.5 overflow-hidden rounded-full bg-muted'
		>
			<div
				className={cn('h-full rounded-full bg-primary transition-[width]', used >= capacity && 'bg-amber-500')}
				style={{ width: `${width}%` }}
			/>
		</div>
	);
}

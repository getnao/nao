import { Switch } from '@/components/ui/switch';

interface UserGroupSwitchRowProps {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}

export function UserGroupSwitchRow({ id, label, description, checked, onCheckedChange }: UserGroupSwitchRowProps) {
	return (
		<div className='flex items-start justify-between gap-4 rounded-lg border p-3'>
			<div>
				<label htmlFor={id} className='text-sm font-medium'>
					{label}
				</label>
				<p className='text-xs text-muted-foreground'>{description}</p>
			</div>
			<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
		</div>
	);
}

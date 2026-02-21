import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface SettingsControlRowProps {
	label: string;
	description: string;
	control: React.ReactNode;
	id?: string;
	className?: string;
}

export function SettingsControlRow({ id, label, description, control, className }: SettingsControlRowProps) {
	return (
		<div className={cn('flex items-center justify-between', className)}>
			<div className='flex flex-col gap-0.5'>
				{id ? (
					<label htmlFor={id} className='text-sm font-medium text-foreground cursor-pointer h-5'>
						{label}
					</label>
				) : (
					<p className='text-sm font-medium text-foreground h-5'>{label}</p>
				)}
				<p className='text-xs text-muted-foreground'>{description}</p>
			</div>
			{control}
		</div>
	);
}

interface SettingsToggleRowProps {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}

export function SettingsToggleRow({
	id,
	label,
	description,
	checked,
	onCheckedChange,
	disabled = false,
	className,
}: SettingsToggleRowProps) {
	return (
		<SettingsControlRow
			id={id}
			label={label}
			description={description}
			className={className}
			control={<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />}
		/>
	);
}

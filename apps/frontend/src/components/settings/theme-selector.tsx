import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '@/contexts/theme.provider';
import { cn } from '@/lib/utils';

const themeOptions = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor },
] as const;

export const ThemeSelector = () => {
	const { theme, setTheme } = useTheme();

	return (
		<div className='flex gap-1'>
			{themeOptions.map((option) => {
				const Icon = option.icon;
				const isSelected = theme === option.value;

				return (
					<Button
						key={option.value}
						onClick={() => {
							setTheme(option.value);
						}}
						variant={isSelected ? 'ghost' : 'ghost-muted'}
						size='sm'
						className={cn(
							'rounded-full px-2.5',
							isSelected
								? 'bg-accent text-foreground'
								: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
						)}
					>
						<Icon className='size-3.5' />
						{option.label}
					</Button>
				);
			})}
		</div>
	);
};

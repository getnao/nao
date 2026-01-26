import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/contexts/theme.provider';

export const ThemeSelector = () => {
	const { theme, setTheme } = useTheme();

	return (
		<div className='inline-flex items-center gap-1 rounded-full bg-secondary p-1'>
			<button
				onClick={() => setTheme('light')}
				className={`
          flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium
          transition-all cursor-pointer
          ${
				theme === 'light'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			}
        `}
			>
				<Sun className='size-4' />
				Light
			</button>

			<button
				onClick={() => setTheme('dark')}
				className={`
          flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium
          transition-all cursor-pointer
          ${
				theme === 'dark'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			}
        `}
			>
				<Moon className='size-4' />
				Dark
			</button>

			<button
				onClick={() => setTheme('system')}
				className={`
          flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium
          transition-all cursor-pointer
          ${
				theme === 'system'
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			}
        `}
			>
				<Monitor className='size-4' />
				System
			</button>
		</div>
	);
};

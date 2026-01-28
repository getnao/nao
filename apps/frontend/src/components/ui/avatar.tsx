import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { hashValue } from '@/lib/hash';

const avatarColors = [
	'bg-red-500',
	'bg-orange-500',
	'bg-amber-500',
	'bg-yellow-500',
	'bg-lime-500',
	'bg-green-500',
	'bg-emerald-500',
	'bg-teal-500',
	'bg-cyan-500',
	'bg-sky-500',
	'bg-blue-500',
	'bg-indigo-500',
	'bg-violet-500',
	'bg-purple-500',
	'bg-fuchsia-500',
	'bg-pink-500',
	'bg-rose-500',
];

function getInitials(username: string): string {
	const parts = username.trim().split(/\s+/);
	if (parts.length === 1) {
		return parts[0].charAt(0).toUpperCase();
	}
	return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getColorClass(username: string): string {
	const hash = hashValue(username);
	return avatarColors[hash % avatarColors.length];
}

const avatarVariants = cva('inline-flex items-center justify-center rounded-full font-medium text-white select-none', {
	variants: {
		size: {
			sm: 'size-6 text-xs',
			default: 'size-8 text-sm',
			lg: 'size-10 text-base',
			xl: 'size-12 text-lg',
		},
	},
	defaultVariants: {
		size: 'default',
	},
});

interface AvatarProps extends React.ComponentProps<'div'>, VariantProps<typeof avatarVariants> {
	username: string;
}

export function Avatar({ username, size, className, ...props }: AvatarProps) {
	const initials = getInitials(username);
	const colorClass = getColorClass(username);

	return (
		<div className={cn(avatarVariants({ size }), colorClass, className)} title={username} {...props}>
			{initials}
		</div>
	);
}

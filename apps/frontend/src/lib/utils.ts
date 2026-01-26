import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useQuery } from '@tanstack/react-query';
import type { ClassValue } from 'clsx';
import { trpc } from '@/main';

export function cn(...inputs: Array<ClassValue>) {
	return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) {
		return '0 B';
	}
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const value = bytes / Math.pow(k, i);
	return `${value % 1 === 0 ? value : value.toFixed(1)} ${sizes[i]}`;
}

export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getAuthentificationNavigation(): string {
	const userCount = useQuery(trpc.user.countUsers.queryOptions());
	const navigation = userCount.data ? '/login' : '/signup';
	return navigation;
}

export function isLast<T>(item: T, array: T[]): boolean {
	return item === array.at(-1);
}

export const regexPassword = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/;

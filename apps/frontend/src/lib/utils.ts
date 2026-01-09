import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ClassValue } from 'clsx';

export function cn(...inputs: Array<ClassValue>) {
	return twMerge(clsx(inputs));
}

export function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

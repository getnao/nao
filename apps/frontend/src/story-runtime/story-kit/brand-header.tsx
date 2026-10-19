import { StoryBrandMark } from '@nao/shared/story-brand-mark';
import { showsBrandIdentity } from '@nao/shared/story-theme';
import { useStoryTheme } from './hooks';
import type { ReactNode } from 'react';

export interface BrandHeaderProps {
	title?: string;
	description?: ReactNode;
	children?: ReactNode;
}

export function BrandHeader({ title, description, children }: BrandHeaderProps) {
	const brand = useStoryTheme()?.brand;
	const showIdentity = brand && showsBrandIdentity(brand);

	return (
		<header className='nao-brand-header'>
			{(showIdentity || children) && (
				<div className='nao-brand-header__bar'>
					{showIdentity ? <StoryBrandMark brand={brand} /> : <span />}
					{children && <div className='nao-brand-header__meta'>{children}</div>}
				</div>
			)}
			{(title || description) && (
				<div className='nao-brand-header__heading'>
					{title && <h1>{title}</h1>}
					{description && <p>{description}</p>}
				</div>
			)}
		</header>
	);
}

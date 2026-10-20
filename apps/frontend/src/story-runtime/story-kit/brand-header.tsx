import { StoryBrandMark } from '@nao/shared/story-brand-mark';
import { showsBrandIdentity } from '@nao/shared/story-theme';
import { useStoryTheme } from './hooks';
import type { ReactNode } from 'react';

export interface BrandHeaderProps {
	children?: ReactNode;
}

export function BrandHeader({ children }: BrandHeaderProps) {
	const brand = useStoryTheme()?.brand;
	const showIdentity = brand && showsBrandIdentity(brand);
	if (!showIdentity && !children) {
		return null;
	}

	return (
		<header className='nao-brand-header'>
			<div className='nao-brand-header__bar'>
				{showIdentity ? <StoryBrandMark brand={brand} /> : <span />}
				{children && <div className='nao-brand-header__meta'>{children}</div>}
			</div>
		</header>
	);
}

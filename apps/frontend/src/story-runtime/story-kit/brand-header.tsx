import { StoryBrandMark } from '@nao/shared/story-brand-mark';
import { useStoryBrand } from './hooks';
import type { ReactNode } from 'react';

export interface BrandHeaderProps {
	children?: ReactNode;
}

export function BrandHeader({ children }: BrandHeaderProps) {
	const brand = useStoryBrand();
	if (!brand && !children) {
		return null;
	}

	return (
		<header className='nao-brand-header'>
			<div className='nao-brand-header__bar'>
				{brand ? <StoryBrandMark brand={brand} /> : <span />}
				{children && <div className='nao-brand-header__meta'>{children}</div>}
			</div>
		</header>
	);
}

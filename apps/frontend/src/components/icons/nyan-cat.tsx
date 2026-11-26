import type { SVGProps } from 'react';

import NyanCatArtwork from '@/components/icons/nyan-cat.svg';
import { cn } from '@/lib/utils';

export function NyanCat(props: SVGProps<SVGSVGElement>) {
	return (
		<NyanCatArtwork
			{...props}
			className={cn('nyan-cat', props.className)}
			shapeRendering='crispEdges'
			aria-hidden='true'
		/>
	);
}

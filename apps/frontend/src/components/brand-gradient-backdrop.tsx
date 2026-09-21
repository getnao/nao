import type { CSSProperties } from 'react';

const TEXTURE_URL = '/fontNaoTexture.webp';

type BrandGradientBackdropProps = {
	color: string;
	className?: string;
	style?: CSSProperties;
};

/** Recolorable version of the original login artwork. */
export function BrandGradientBackdrop({ color, className, style }: BrandGradientBackdropProps) {
	return (
		<div
			className={className}
			style={{ backgroundColor: color, isolation: 'isolate', ...style }}
			aria-hidden='true'
		>
			<div
				className='absolute inset-0'
				style={{
					backgroundImage: `url('${TEXTURE_URL}')`,
					backgroundSize: 'cover',
					backgroundPosition: 'center',
					mixBlendMode: 'screen',
				}}
			/>
		</div>
	);
}

import { joinClassNames } from '@nao/shared/class-names';
import { useMemo } from 'react';
import { requestImage } from '../story-host';
import { useHostRequest } from './use-host-request';
import type { CSSProperties } from 'react';

export interface ImageProps {
	src: string;
	alt: string;
	className?: string;
	style?: CSSProperties;
}

/** An image from a `gs://`, `s3://` or `https://` source, which nao reads and hands to the story. */
export function Image({ src, alt, className, style }: ImageProps) {
	const request = useMemo(() => ({ source: src, key: `image:${src}`, fetch: () => requestImage(src) }), [src]);
	const image = useHostRequest(request, true);

	if (image.status === 'success') {
		return <img src={image.data} alt={alt} className={joinClassNames('nao-image', className)} style={style} />;
	}
	if (image.status === 'error') {
		return (
			<span
				role='img'
				aria-label={alt}
				title={image.error}
				className={joinClassNames('nao-block__state nao-block__state--error nao-image--error', className)}
				style={style}
			>
				Image unavailable: {image.error}
			</span>
		);
	}
	return (
		<span
			aria-busy='true'
			aria-label={alt}
			className={joinClassNames('nao-image nao-skeleton', className)}
			style={style}
		/>
	);
}

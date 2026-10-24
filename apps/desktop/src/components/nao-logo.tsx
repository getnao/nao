import type { ComponentProps } from 'react';

export function NaoLogo(props: ComponentProps<'svg'>) {
	return (
		<svg viewBox='0 0 112 65' fill='none' xmlns='http://www.w3.org/2000/svg' aria-label='nao' role='img' {...props}>
			<g fill='#522BFF'>
				<path d='M64.3619 0V16.8954L55.9142 48.0853L47.4665 16.8954V0H64.3619Z' />
				<path d='M43.9762 59.4619L16.8954 64.9753H0V48.0853H16.8954L43.9762 59.4619Z' />
				<path d='M111.826 48.0853V64.9753H94.9418L67.8501 59.4619L94.9418 48.0853H111.826Z' />
				<path d='M47.4844 51.0305L11.0379 31.4631V14.5731H27.9279L47.4844 51.0305Z' />
				<path d='M100.799 14.5731V31.4631L64.3468 51.0305L83.9033 14.5731H100.799Z' />
			</g>
		</svg>
	);
}

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

type NaoLogoAnimatedProps = {
	className?: string;
	style?: CSSProperties;
	width?: number | string;
	height?: number | string;
	durationSeconds?: number;
	loop?: boolean;
	title?: string;
};

const TOTAL_FRAMES = 97;

type Branch = {
	full: string;
	collapsed: string;
	gradientId: string;
	growStart: number;
	growEnd: number;
	holdEnd: number;
	shrinkEnd: number;
};

const BRANCHES: Branch[] = [
	{
		// 1. bottom-left
		full: 'M43.9762 59.4619 L16.8954 64.9753 L0 64.9753 L0 48.0853 L16.8954 48.0853 Z',
		collapsed: 'M43.9762 59.4619 L43.9762 59.4619 L43.9762 59.4619 L43.9762 59.4619 L43.9762 59.4619 Z',
		gradientId: 'paint1_radial_457_57730',
		growStart: 0,
		growEnd: 9.699,
		holdEnd: 51.734,
		shrinkEnd: 58.199,
	},
	{
		// 2. diagonale gauche
		full: 'M47.4844 51.0305 L11.0379 31.4631 L11.0379 14.5731 L27.9279 14.5731 Z',
		collapsed: 'M47.4844 51.0305 L47.4844 51.0305 L47.4844 51.0305 L47.4844 51.0305 Z',
		gradientId: 'paint3_radial_457_57730',
		growStart: 9.699,
		growEnd: 19.4,
		holdEnd: 61.433,
		shrinkEnd: 67.9,
	},
	{
		// 3. tige centrale
		full: 'M64.3619 0 L64.3619 16.8954 L55.9142 48.0853 L47.4665 16.8954 L47.4665 0 Z',
		collapsed: 'M55.9142 48.0853 L55.9142 48.0853 L55.9142 48.0853 L55.9142 48.0853 L55.9142 48.0853 Z',
		gradientId: 'paint0_radial_457_57730',
		growStart: 20.047,
		growEnd: 29.746,
		holdEnd: 71.134,
		shrinkEnd: 77.599,
	},
	{
		// 4. diagonale droite
		full: 'M100.799 14.5731 L100.799 31.4631 L64.3468 51.0305 L83.9033 14.5731 Z',
		collapsed: 'M64.3468 51.0305 L64.3468 51.0305 L64.3468 51.0305 L64.3468 51.0305 Z',
		gradientId: 'paint4_radial_457_57730',
		growStart: 30.392,
		growEnd: 40.091,
		holdEnd: 80.833,
		shrinkEnd: 87.3,
	},
	{
		// 5. bottom-right
		full: 'M111.826 48.0853 L111.826 64.9753 L94.9418 64.9753 L67.8501 59.4619 L94.9418 48.0853 Z',
		collapsed: 'M67.8501 59.4619 L67.8501 59.4619 L67.8501 59.4619 L67.8501 59.4619 L67.8501 59.4619 Z',
		gradientId: 'paint2_radial_457_57730',
		growStart: 40.091,
		growEnd: 49.793,
		holdEnd: 90.532,
		shrinkEnd: 96.999,
	},
];

function buildMorph(branch: Branch, loop: boolean): { values: string; keyTimes: string } {
	const frames: Array<[number, string]> = loop
		? [
				[0, branch.collapsed],
				[branch.growStart, branch.collapsed],
				[branch.growEnd, branch.full],
				[branch.holdEnd, branch.full],
				[branch.shrinkEnd, branch.collapsed],
				[TOTAL_FRAMES, branch.collapsed],
			]
		: [
				[0, branch.collapsed],
				[branch.growStart, branch.collapsed],
				[branch.growEnd, branch.full],
				[TOTAL_FRAMES, branch.full],
			];

	const values: string[] = [];
	const keyTimes: string[] = [];
	let lastKeyTime = -1;
	for (const [frame, d] of frames) {
		const keyTime = Math.min(1, Math.max(0, frame / TOTAL_FRAMES));
		const rounded = Number(keyTime.toFixed(5));
		if (rounded <= lastKeyTime) {
			continue;
		}
		lastKeyTime = rounded;
		keyTimes.push(String(rounded));
		values.push(d);
	}
	return { values: values.join(';'), keyTimes: keyTimes.join(';') };
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) {
			return;
		}
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		setReduced(mql.matches);
		const onChange = () => setReduced(mql.matches);
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	}, []);
	return reduced;
}

export default function NaoLogoAnimated({
	className,
	style,
	width = 112,
	height = 65,
	durationSeconds = 1.617,
	loop = true,
	title = 'nao',
}: NaoLogoAnimatedProps) {
	const reducedMotion = usePrefersReducedMotion();
	const dur = `${durationSeconds}s`;
	const repeatCount = loop ? 'indefinite' : 1;

	return (
		<svg
			width={width}
			height={height}
			viewBox='0 0 112 65'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={className}
			style={style}
			role='img'
			aria-label={title}
		>
			<title>{title}</title>
			<g filter='url(#filter0_n_457_57730)'>
				{BRANCHES.map((branch) => {
					const { values, keyTimes } = buildMorph(branch, loop);
					return (
						<path
							key={branch.gradientId}
							d={reducedMotion ? branch.full : branch.collapsed}
							fill={`url(#${branch.gradientId})`}
						>
							{!reducedMotion && (
								<animate
									attributeName='d'
									values={values}
									keyTimes={keyTimes}
									dur={dur}
									calcMode='spline'
									keySplines={values
										.split(';')
										.slice(1)
										.map(() => '0.33 0 0.67 1')
										.join(';')}
									repeatCount={repeatCount}
									fill='freeze'
								/>
							)}
						</path>
					);
				})}
			</g>
			<defs>
				<filter
					id='filter0_n_457_57730'
					x='0'
					y='0'
					width='111.826'
					height='64.9753'
					filterUnits='userSpaceOnUse'
					colorInterpolationFilters='sRGB'
				>
					<feFlood floodOpacity='0' result='BackgroundImageFix' />
					<feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
					<feTurbulence
						type='fractalNoise'
						baseFrequency='2.5 2.5'
						stitchTiles='stitch'
						numOctaves='3'
						result='noise'
						seed='7980'
					/>
					<feColorMatrix in='noise' type='luminanceToAlpha' result='alphaNoise' />
					<feComponentTransfer in='alphaNoise' result='coloredNoise1'>
						<feFuncA
							type='discrete'
							tableValues='1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 '
						/>
					</feComponentTransfer>
					<feComposite operator='in' in2='shape' in='coloredNoise1' result='noise1Clipped' />
					<feFlood floodColor='rgba(255, 255, 255, 0.11)' result='color1Flood' />
					<feComposite operator='in' in2='noise1Clipped' in='color1Flood' result='color1' />
					<feMerge result='effect1_noise_457_57730'>
						<feMergeNode in='shape' />
						<feMergeNode in='color1' />
					</feMerge>
				</filter>
				<radialGradient
					id='paint0_radial_457_57730'
					cx='0'
					cy='0'
					r='1'
					gradientUnits='userSpaceOnUse'
					gradientTransform='translate(58.7348 4.55734) rotate(90) scale(80.2902 233.258)'
				>
					<stop offset='0.157902' stopColor='#522BFF' />
					<stop offset='0.466346' stopColor='#4F5EFF' />
					<stop offset='0.798077' stopColor='#522BFF' />
					<stop offset='1' stopColor='#522BFF' />
				</radialGradient>
				<radialGradient
					id='paint1_radial_457_57730'
					cx='0'
					cy='0'
					r='1'
					gradientUnits='userSpaceOnUse'
					gradientTransform='translate(58.7348 4.55734) rotate(90) scale(80.2902 233.258)'
				>
					<stop offset='0.157902' stopColor='#522BFF' />
					<stop offset='0.466346' stopColor='#4F5EFF' />
					<stop offset='0.798077' stopColor='#522BFF' />
					<stop offset='1' stopColor='#522BFF' />
				</radialGradient>
				<radialGradient
					id='paint2_radial_457_57730'
					cx='0'
					cy='0'
					r='1'
					gradientUnits='userSpaceOnUse'
					gradientTransform='translate(58.7348 4.55734) rotate(90) scale(80.2902 233.258)'
				>
					<stop offset='0.157902' stopColor='#522BFF' />
					<stop offset='0.466346' stopColor='#4F5EFF' />
					<stop offset='0.798077' stopColor='#522BFF' />
					<stop offset='1' stopColor='#522BFF' />
				</radialGradient>
				<radialGradient
					id='paint3_radial_457_57730'
					cx='0'
					cy='0'
					r='1'
					gradientUnits='userSpaceOnUse'
					gradientTransform='translate(58.7348 4.55734) rotate(90) scale(80.2902 233.258)'
				>
					<stop offset='0.157902' stopColor='#522BFF' />
					<stop offset='0.466346' stopColor='#4F5EFF' />
					<stop offset='0.798077' stopColor='#522BFF' />
					<stop offset='1' stopColor='#522BFF' />
				</radialGradient>
				<radialGradient
					id='paint4_radial_457_57730'
					cx='0'
					cy='0'
					r='1'
					gradientUnits='userSpaceOnUse'
					gradientTransform='translate(58.7348 4.55734) rotate(90) scale(80.2902 233.258)'
				>
					<stop offset='0.157902' stopColor='#522BFF' />
					<stop offset='0.466346' stopColor='#4F5EFF' />
					<stop offset='0.798077' stopColor='#522BFF' />
					<stop offset='1' stopColor='#522BFF' />
				</radialGradient>
			</defs>
		</svg>
	);
}

import { __ } from '../../i18n';
import type { CareAction, PetMood } from './pet';

export interface MioCopy {
	eyebrow: string;
	title: string;
	screenLabel: string;
	greetLabel: string;
	careGroupLabel: string;
	note: string;
	greetReaction: string;
	moods: Record< PetMood, { label: string; status: string } >;
	actions: Record< CareAction, { label: string; reaction: string } >;
}

export function createMioCopy(): MioCopy {
	return {
		eyebrow: __( 'Pocket companion', 'desktop-mode' ),
		title: __( 'Mio', 'desktop-mode' ),
		screenLabel: __( "Mio's companion screen", 'desktop-mode' ),
		greetLabel: __( 'Greet Mio', 'desktop-mode' ),
		careGroupLabel: __( 'Spend a moment with Mio', 'desktop-mode' ),
		note: __( 'No rush. Mio waits without worry.', 'desktop-mode' ),
		greetReaction: __(
			'Mio bobs happily and drifts a little closer.',
			'desktop-mode',
		),
		moods: {
			radiant: {
				label: __( 'Radiant', 'desktop-mode' ),
				status: __( 'Mio is glowing softly.', 'desktop-mode' ),
			},
			dim: {
				label: __( 'Dim', 'desktop-mode' ),
				status: __(
					'Mio could use a little starlight.',
					'desktop-mode',
				),
			},
			restless: {
				label: __( 'Restless', 'desktop-mode' ),
				status: __(
					'The station static has Mio unsettled.',
					'desktop-mode',
				),
			},
			curious: {
				label: __( 'Curious', 'desktop-mode' ),
				status: __(
					'Mio is looking for something new.',
					'desktop-mode',
				),
			},
		},
		actions: {
			starlight: {
				label: __( 'Starlight', 'desktop-mode' ),
				reaction: __(
					'Mio drinks the starlight and glows brighter.',
					'desktop-mode',
				),
			},
			quiet: {
				label: __( 'Quiet', 'desktop-mode' ),
				reaction: __( 'Mio settles into the quiet.', 'desktop-mode' ),
			},
			explore: {
				label: __( 'Explore', 'desktop-mode' ),
				reaction: __( 'Mio returns with a new story.', 'desktop-mode' ),
			},
		},
	};
}

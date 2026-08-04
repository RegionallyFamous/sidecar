import { __ } from '../../i18n';
import type { CareAction, PetMood } from './pet';

export interface MioCopy {
	title: string;
	screenLabel: string;
	greetLabel: string;
	careGroupLabel: string;
	note: string;
	greetReaction: string;
	moods: Record< PetMood, { status: string } >;
	actions: Record< CareAction, { label: string; reaction: string } >;
}

export function createMioCopy(): MioCopy {
	return {
		title: __( 'Mio', 'desktop-mode' ),
		screenLabel: __( "Mio's companion screen", 'desktop-mode' ),
		greetLabel: __( 'Greet Mio', 'desktop-mode' ),
		careGroupLabel: __( 'Spend a moment with Mio', 'desktop-mode' ),
		note: __( 'No rush. Mio waits here.', 'desktop-mode' ),
		greetReaction: __( 'Mio drifts closer.', 'desktop-mode' ),
		moods: {
			radiant: {
				status: __( 'Mio is glowing softly.', 'desktop-mode' ),
			},
			dim: {
				status: __( 'Mio wants some light.', 'desktop-mode' ),
			},
			restless: {
				status: __( 'Mio feels unsettled.', 'desktop-mode' ),
			},
			curious: {
				status: __( 'Mio wants to explore.', 'desktop-mode' ),
			},
		},
		actions: {
			starlight: {
				label: __( 'Light', 'desktop-mode' ),
				reaction: __( 'Mio glows brighter.', 'desktop-mode' ),
			},
			quiet: {
				label: __( 'Quiet', 'desktop-mode' ),
				reaction: __( 'Mio rests quietly.', 'desktop-mode' ),
			},
			explore: {
				label: __( 'Explore', 'desktop-mode' ),
				reaction: __( 'Mio found a story.', 'desktop-mode' ),
			},
		},
	};
}

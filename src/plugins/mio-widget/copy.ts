import { __ } from '../../i18n';
import type { CareAction, Homecoming, PetMood } from './pet';

export interface MioCopy {
	title: string;
	screenLabel: string;
	greetLabel: string;
	careGroupLabel: string;
	note: string;
	greetReaction: string;
	moods: Record< PetMood, { status: string } >;
	actions: Record< CareAction, { label: string; reaction: string } >;
	expedition: {
		intro: string;
		departed: string;
		choice: string;
		trailLight: string;
		trailExplore: string;
		returning: string;
		travelBoop: string;
		homecomings: Record< Homecoming, string >;
	};
	sound: {
		muteAction: string;
		unmuteAction: string;
		on: string;
		off: string;
	};
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
				reaction: __( 'A tiny door!', 'desktop-mode' ),
			},
		},
		expedition: {
			intro: __(
				'Light guides. Explore goes deep. Quiet calls Mio home.',
				'desktop-mode',
			),
			departed: __( 'A tiny door!', 'desktop-mode' ),
			choice: __( 'Light, Explore, or Quiet?', 'desktop-mode' ),
			trailLight: __( 'Mio follows the light.', 'desktop-mode' ),
			trailExplore: __( 'Mio goes deeper.', 'desktop-mode' ),
			returning: __( 'Mio heads home.', 'desktop-mode' ),
			travelBoop: __( 'Still close.', 'desktop-mode' ),
			homecomings: {
				'warm-hush': __( 'Mio found a warm hush.', 'desktop-mode' ),
				'odd-song': __( 'Mio found an odd song.', 'desktop-mode' ),
				'paper-star': __( 'Mio found a paper star.', 'desktop-mode' ),
			},
		},
		sound: {
			muteAction: __( 'Mute sound effects', 'desktop-mode' ),
			unmuteAction: __( 'Unmute sound effects', 'desktop-mode' ),
			on: __( 'Sound effects on.', 'desktop-mode' ),
			off: __( 'Sound effects off.', 'desktop-mode' ),
		},
	};
}

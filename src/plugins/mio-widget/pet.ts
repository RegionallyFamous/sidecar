export const PET_STATE_VERSION = 2;
export const MIN_METER = 20;
export const MAX_METER = 100;
export const MAX_CATCH_UP_MS = 72 * 60 * 60 * 1000;
export const EXPEDITION_DEPART_MS = 6_000;
export const EXPEDITION_LIGHT_MS = 8_000;
export const EXPEDITION_EXPLORE_MS = 10_000;
export const EXPEDITION_RETURN_MS = 6_000;

const HOUR_MS = 60 * 60 * 1000;

export type CareAction = 'starlight' | 'quiet' | 'explore';
export type PetMood = 'radiant' | 'dim' | 'restless' | 'curious';
export type ExpeditionPhase =
	| 'departing'
	| 'choice'
	| 'traveling'
	| 'returning';
export type TrailChoice = 'starlight' | 'explore';
export type Homecoming = 'warm-hush' | 'odd-song' | 'paper-star';
export type CompanionActionEvent =
	| 'care'
	| 'departed'
	| 'trail-light'
	| 'trail-explore'
	| 'returning'
	| 'busy';

export interface ExpeditionState {
	phase: ExpeditionPhase;
	depth: number;
	trail: TrailChoice[];
	readyAtMs: number | null;
}

export interface PetState {
	version: typeof PET_STATE_VERSION;
	metAtMs: number;
	updatedAtMs: number;
	glow: number;
	ease: number;
	wonder: number;
	interactions: number;
	lastAction: CareAction | null;
	expedition: ExpeditionState | null;
	outings: number;
	lastHomecoming: Homecoming | null;
	lastHomecomingAtMs: number | null;
}

export interface CompanionActionResult {
	state: PetState;
	event: CompanionActionEvent;
}

export function createPetState( nowMs = Date.now() ): PetState {
	return {
		version: PET_STATE_VERSION,
		metAtMs: nowMs,
		updatedAtMs: nowMs,
		glow: 78,
		ease: 74,
		wonder: 72,
		interactions: 0,
		lastAction: null,
		expedition: null,
		outings: 0,
		lastHomecoming: null,
		lastHomecomingAtMs: null,
	};
}

export function restorePetState( raw: unknown, nowMs = Date.now() ): PetState {
	if ( ! isRecord( raw ) || ( raw.version !== 1 && raw.version !== 2 ) ) {
		return createPetState( nowMs );
	}
	if ( ! hasValidStoredMeters( raw ) ) {
		return createPetState( nowMs );
	}

	const state: PetState = {
		version: PET_STATE_VERSION,
		metAtMs: Math.min( raw.metAtMs, nowMs ),
		updatedAtMs: raw.updatedAtMs,
		glow: clampMeter( raw.glow ),
		ease: clampMeter( raw.ease ),
		wonder: clampMeter( raw.wonder ),
		interactions: Math.max( 0, Math.floor( raw.interactions ) ),
		lastAction: isCareAction( raw.lastAction ) ? raw.lastAction : null,
		expedition: raw.version === 2 ? restoreExpedition( raw.expedition ) : null,
		outings:
			raw.version === 2
				? Math.max( 0, Math.floor( finiteOr( raw.outings, 0 ) ) )
				: 0,
		lastHomecoming:
			raw.version === 2 && isHomecoming( raw.lastHomecoming )
				? raw.lastHomecoming
				: null,
		lastHomecomingAtMs:
			raw.version === 2 && Number.isFinite( raw.lastHomecomingAtMs )
				? Number( raw.lastHomecomingAtMs )
				: null,
	};

	return catchUpPet( state, nowMs );
}

export function catchUpPet( state: PetState, nowMs = Date.now() ): PetState {
	const elapsedMs = Math.min(
		MAX_CATCH_UP_MS,
		Math.max( 0, nowMs - state.updatedAtMs ),
	);
	const elapsedHours = elapsedMs / HOUR_MS;
	let current: PetState = {
		...state,
		updatedAtMs: nowMs,
		glow: roundMeter( state.glow - elapsedHours * 0.8 ),
		ease: roundMeter( state.ease - elapsedHours * 0.6 ),
		wonder: roundMeter( state.wonder - elapsedHours * 0.45 ),
	};

	// Several expedition phases may have elapsed while the tab was hidden or
	// the widget was unmounted. Advance against the absolute phase timestamps
	// so returning later never adds a fresh artificial wait.
	for ( let guard = 0; guard < 5; guard++ ) {
		const expedition = current.expedition;
		if (
			! expedition ||
			expedition.readyAtMs === null ||
			expedition.readyAtMs > nowMs
		) {
			break;
		}
		const transitionAt = expedition.readyAtMs;
		if ( expedition.phase === 'departing' ) {
			current = {
				...current,
				expedition: { ...expedition, phase: 'choice', readyAtMs: null },
			};
			continue;
		}
		if ( expedition.phase === 'traveling' ) {
			current = {
				...current,
				expedition:
					expedition.depth >= 3
						? {
							...expedition,
							phase: 'returning',
							readyAtMs: transitionAt + EXPEDITION_RETURN_MS,
						}
						: { ...expedition, phase: 'choice', readyAtMs: null },
			};
			continue;
		}
		if ( expedition.phase === 'returning' ) {
			current = {
				...current,
				expedition: null,
				outings: current.outings + 1,
				lastHomecoming: getHomecoming( expedition.trail ),
				lastHomecomingAtMs: transitionAt,
			};
			continue;
		}
		break;
	}

	return current;
}

/** Ordinary at-home care, kept as a small pure primitive. */
export function applyCareAction(
	state: PetState,
	action: CareAction,
	nowMs = Date.now(),
): PetState {
	const current = catchUpPet( state, nowMs );
	let glow = current.glow;
	let ease = current.ease;
	let wonder = current.wonder;

	switch ( action ) {
		case 'starlight':
			glow += 24;
			ease -= 3;
			wonder += 1;
			break;
		case 'quiet':
			ease += 24;
			wonder -= 3;
			break;
		case 'explore':
			wonder += 24;
			glow -= 6;
			ease -= 4;
			break;
	}

	return commitAction( current, action, glow, ease, wonder );
}

/** Apply one of the existing three buttons to the companion ritual. */
export function applyCompanionAction(
	state: PetState,
	action: CareAction,
	nowMs = Date.now(),
): CompanionActionResult {
	const current = catchUpPet( state, nowMs );
	const expedition = current.expedition;

	if ( ! expedition ) {
		if ( action !== 'explore' ) {
			return {
				state: applyCareAction( current, action, nowMs ),
				event: 'care',
			};
		}
		return {
			state: {
				...commitAction(
					current,
					action,
					current.glow - 2,
					current.ease - 2,
					current.wonder + 5,
				),
				expedition: {
					phase: 'departing',
					depth: 0,
					trail: [],
					readyAtMs: nowMs + EXPEDITION_DEPART_MS,
				},
			},
			event: 'departed',
		};
	}

	if ( expedition.phase !== 'choice' ) {
		return { state: current, event: 'busy' };
	}

	if ( action === 'quiet' ) {
		return {
			state: {
				...commitAction(
					current,
					action,
					current.glow,
					current.ease + 12,
					current.wonder,
				),
				expedition: {
					...expedition,
					phase: 'returning',
					readyAtMs: nowMs + EXPEDITION_RETURN_MS,
				},
			},
			event: 'returning',
		};
	}

	const takingLight = action === 'starlight';
	return {
		state: {
			...commitAction(
				current,
				action,
				current.glow + ( takingLight ? 8 : -4 ),
				current.ease + ( takingLight ? -1 : -8 ),
				current.wonder + ( takingLight ? 2 : 12 ),
			),
			expedition: {
				...expedition,
				phase: 'traveling',
				depth: expedition.depth + ( takingLight ? 1 : 2 ),
				trail: [ ...expedition.trail, action ],
				readyAtMs:
					nowMs +
					( takingLight ? EXPEDITION_LIGHT_MS : EXPEDITION_EXPLORE_MS ),
			},
		},
		event: takingLight ? 'trail-light' : 'trail-explore',
	};
}

export function getNextTransitionAt( state: PetState ): number | null {
	return state.expedition?.readyAtMs ?? null;
}

export function getHomecoming( trail: readonly TrailChoice[] ): Homecoming {
	if ( trail.length === 0 || trail.every( ( choice ) => choice === 'starlight' ) ) {
		return 'warm-hush';
	}
	if ( trail.every( ( choice ) => choice === 'explore' ) ) {
		return 'paper-star';
	}
	return 'odd-song';
}

export function getMood( state: PetState ): PetMood {
	if ( state.glow >= 60 && state.ease >= 60 && state.wonder >= 60 ) {
		return 'radiant';
	}

	const needs: Array< [ PetMood, number ] > = [
		[ 'dim', state.glow ],
		[ 'restless', state.ease ],
		[ 'curious', state.wonder ],
	];
	needs.sort( ( left, right ) => left[ 1 ] - right[ 1 ] );
	return needs[ 0 ]?.[ 0 ] ?? 'radiant';
}

function commitAction(
	state: PetState,
	action: CareAction,
	glow: number,
	ease: number,
	wonder: number,
): PetState {
	return {
		...state,
		glow: roundMeter( glow ),
		ease: roundMeter( ease ),
		wonder: roundMeter( wonder ),
		interactions: state.interactions + 1,
		lastAction: action,
	};
}

function restoreExpedition( raw: unknown ): ExpeditionState | null {
	if ( ! isRecord( raw ) || ! isExpeditionPhase( raw.phase ) ) {
		return null;
	}
	const trail = Array.isArray( raw.trail )
		? raw.trail.filter( isTrailChoice ).slice( 0, 4 )
		: [];
	const readyAtMs = Number.isFinite( raw.readyAtMs )
		? Number( raw.readyAtMs )
		: null;
	if ( raw.phase !== 'choice' && readyAtMs === null ) {
		return null;
	}
	return {
		phase: raw.phase,
		depth: Math.min( 4, Math.max( 0, Math.floor( finiteOr( raw.depth, 0 ) ) ) ),
		trail,
		readyAtMs: raw.phase === 'choice' ? null : readyAtMs,
	};
}

function hasValidStoredMeters(
	raw: Record< string, unknown >,
): raw is Record< string, unknown > & {
	metAtMs: number;
	updatedAtMs: number;
	glow: number;
	ease: number;
	wonder: number;
	interactions: number;
} {
	return [
		raw.metAtMs,
		raw.updatedAtMs,
		raw.glow,
		raw.ease,
		raw.wonder,
		raw.interactions,
	].every( ( value ) => typeof value === 'number' && Number.isFinite( value ) );
}

function roundMeter( value: number ): number {
	return Math.round( clampMeter( value ) * 100 ) / 100;
}

function clampMeter( value: number ): number {
	return Math.min( MAX_METER, Math.max( MIN_METER, value ) );
}

function finiteOr( value: unknown, fallback: number ): number {
	return typeof value === 'number' && Number.isFinite( value ) ? value : fallback;
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null;
}

function isCareAction( value: unknown ): value is CareAction {
	return value === 'starlight' || value === 'quiet' || value === 'explore';
}

function isTrailChoice( value: unknown ): value is TrailChoice {
	return value === 'starlight' || value === 'explore';
}

function isExpeditionPhase( value: unknown ): value is ExpeditionPhase {
	return (
		value === 'departing' ||
		value === 'choice' ||
		value === 'traveling' ||
		value === 'returning'
	);
}

function isHomecoming( value: unknown ): value is Homecoming {
	return (
		value === 'warm-hush' ||
		value === 'odd-song' ||
		value === 'paper-star'
	);
}

export const PET_STATE_VERSION = 1;
export const MIN_METER = 20;
export const MAX_METER = 100;
export const MAX_CATCH_UP_MS = 72 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export type CareAction = 'starlight' | 'quiet' | 'explore';
export type PetMood = 'radiant' | 'dim' | 'restless' | 'curious';

export interface PetState {
	version: typeof PET_STATE_VERSION;
	metAtMs: number;
	updatedAtMs: number;
	glow: number;
	ease: number;
	wonder: number;
	interactions: number;
	lastAction: CareAction | null;
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
	};
}

export function restorePetState( raw: unknown, nowMs = Date.now() ): PetState {
	if ( ! isRecord( raw ) || raw.version !== PET_STATE_VERSION ) {
		return createPetState( nowMs );
	}

	const metAtMs = finiteOr( raw.metAtMs, nowMs );
	const updatedAtMs = finiteOr( raw.updatedAtMs, nowMs );
	const lastAction = isCareAction( raw.lastAction ) ? raw.lastAction : null;
	const state: PetState = {
		version: PET_STATE_VERSION,
		metAtMs: Math.min( metAtMs, nowMs ),
		updatedAtMs,
		glow: clampMeter( finiteOr( raw.glow, 78 ) ),
		ease: clampMeter( finiteOr( raw.ease, 74 ) ),
		wonder: clampMeter( finiteOr( raw.wonder, 72 ) ),
		interactions: Math.max( 0, Math.floor( finiteOr( raw.interactions, 0 ) ) ),
		lastAction,
	};

	return catchUpPet( state, nowMs );
}

export function catchUpPet( state: PetState, nowMs = Date.now() ): PetState {
	const elapsedMs = Math.min(
		MAX_CATCH_UP_MS,
		Math.max( 0, nowMs - state.updatedAtMs ),
	);
	const elapsedHours = elapsedMs / HOUR_MS;

	return {
		...state,
		updatedAtMs: nowMs,
		glow: roundMeter( state.glow - elapsedHours * 0.8 ),
		ease: roundMeter( state.ease - elapsedHours * 0.6 ),
		wonder: roundMeter( state.wonder - elapsedHours * 0.45 ),
	};
}

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

	return {
		...current,
		glow: roundMeter( glow ),
		ease: roundMeter( ease ),
		wonder: roundMeter( wonder ),
		interactions: current.interactions + 1,
		lastAction: action,
	};
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

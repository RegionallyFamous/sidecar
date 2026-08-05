import { describe, expect, test } from 'vitest';
import {
	EXPEDITION_DEPART_MS,
	EXPEDITION_EXPLORE_MS,
	EXPEDITION_RETURN_MS,
	MAX_CATCH_UP_MS,
	applyCareAction,
	applyCompanionAction,
	catchUpPet,
	createPetState,
	getHomecoming,
	getMood,
	restorePetState,
} from '../../src/plugins/mio-widget/pet';

const NOW = Date.UTC( 2026, 7, 4, 18, 0, 0 );

describe( 'Mio companion state', () => {
	test( 'starts radiant without maxing every need', () => {
		const state = createPetState( NOW );

		expect( getMood( state ) ).toBe( 'radiant' );
		expect( state.glow ).toBe( 78 );
		expect( state.ease ).toBe( 74 );
		expect( state.wonder ).toBe( 72 );
	} );

	test( 'caps catch-up at 72 hours and keeps a non-punitive floor', () => {
		const state = createPetState( NOW );
		const afterLongAbsence = catchUpPet(
			state,
			NOW + MAX_CATCH_UP_MS * 4,
		);

		expect( afterLongAbsence.glow ).toBe( 20.4 );
		expect( afterLongAbsence.ease ).toBe( 30.8 );
		expect( afterLongAbsence.wonder ).toBe( 39.6 );

		const atFloor = catchUpPet(
			{ ...state, glow: 20, ease: 20, wonder: 20 },
			NOW + MAX_CATCH_UP_MS,
		);
		expect( atFloor.glow ).toBe( 20 );
		expect( atFloor.ease ).toBe( 20 );
		expect( atFloor.wonder ).toBe( 20 );
	} );

	test( 'makes every care choice meaningful and derives mood from the lowest need', () => {
		const state = createPetState( NOW );
		const explored = applyCareAction( state, 'explore', NOW );

		expect( explored ).toMatchObject( {
			glow: 72,
			ease: 70,
			wonder: 96,
			interactions: 1,
			lastAction: 'explore',
		} );
		expect( getMood( { ...state, glow: 30 } ) ).toBe( 'dim' );
		expect( getMood( { ...state, ease: 30 } ) ).toBe( 'restless' );
		expect( getMood( { ...state, wonder: 30 } ) ).toBe( 'curious' );
	} );

	test( 'recovers from malformed and future-version storage', () => {
		const malformed = restorePetState(
			{ version: 2, glow: 'bright' },
			NOW,
		);
		const future = restorePetState( { version: 3, glow: 1 }, NOW );

		expect( malformed ).toEqual( createPetState( NOW ) );
		expect( future ).toEqual( createPetState( NOW ) );
	} );

	test( 'migrates valid version-one care state without losing the relationship', () => {
		const migrated = restorePetState( {
			version: 1,
			metAtMs: NOW - 1_000,
			updatedAtMs: NOW,
			glow: 64,
			ease: 55,
			wonder: 81,
			interactions: 9,
			lastAction: 'quiet',
		}, NOW );

		expect( migrated ).toMatchObject( {
			version: 2,
			glow: 64,
			ease: 55,
			wonder: 81,
			interactions: 9,
			lastAction: 'quiet',
			expedition: null,
			outings: 0,
		} );
	} );

	test( 'completes a deterministic bold tiny expedition in about thirty seconds', () => {
		let state = createPetState( NOW );
		const departed = applyCompanionAction( state, 'explore', NOW );
		state = departed.state;
		expect( departed.event ).toBe( 'departed' );
		expect( state.expedition ).toMatchObject( {
			phase: 'departing',
			depth: 0,
			trail: [],
		} );

		state = catchUpPet( state, NOW + EXPEDITION_DEPART_MS );
		expect( state.expedition?.phase ).toBe( 'choice' );

		state = applyCompanionAction(
			state,
			'explore',
			NOW + EXPEDITION_DEPART_MS,
		).state;
		state = catchUpPet(
			state,
			NOW + EXPEDITION_DEPART_MS + EXPEDITION_EXPLORE_MS,
		);
		expect( state.expedition ).toMatchObject( {
			phase: 'choice',
			depth: 2,
			trail: [ 'explore' ],
		} );

		const secondChoiceAt =
			NOW + EXPEDITION_DEPART_MS + EXPEDITION_EXPLORE_MS;
		state = applyCompanionAction( state, 'explore', secondChoiceAt ).state;
		state = catchUpPet( state, secondChoiceAt + EXPEDITION_EXPLORE_MS );
		expect( state.expedition?.phase ).toBe( 'returning' );

		state = catchUpPet(
			state,
			secondChoiceAt + EXPEDITION_EXPLORE_MS + EXPEDITION_RETURN_MS,
		);
		expect( state.expedition ).toBeNull();
		expect( state.outings ).toBe( 1 );
		expect( state.lastHomecoming ).toBe( 'paper-star' );
	} );

	test( 'makes every expedition ending positive and choice-authored', () => {
		expect( getHomecoming( [] ) ).toBe( 'warm-hush' );
		expect( getHomecoming( [ 'starlight', 'starlight' ] ) ).toBe(
			'warm-hush',
		);
		expect( getHomecoming( [ 'starlight', 'explore' ] ) ).toBe( 'odd-song' );
		expect( getHomecoming( [ 'explore', 'explore' ] ) ).toBe( 'paper-star' );
	} );

	test( 'lets Quiet bring Mio home early without punishment', () => {
		let state = applyCompanionAction(
			createPetState( NOW ),
			'explore',
			NOW,
		).state;
		state = catchUpPet( state, NOW + EXPEDITION_DEPART_MS );
		const returning = applyCompanionAction(
			state,
			'quiet',
			NOW + EXPEDITION_DEPART_MS,
		);

		expect( returning.event ).toBe( 'returning' );
		expect( returning.state.ease ).toBeGreaterThan( state.ease );
		state = catchUpPet(
			returning.state,
			NOW + EXPEDITION_DEPART_MS + EXPEDITION_RETURN_MS,
		);
		expect( state.lastHomecoming ).toBe( 'warm-hush' );
	} );
} );

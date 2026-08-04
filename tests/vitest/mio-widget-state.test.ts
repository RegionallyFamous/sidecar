import { describe, expect, test } from 'vitest';
import {
	MAX_CATCH_UP_MS,
	applyCareAction,
	catchUpPet,
	createPetState,
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
			{ version: 1, glow: 'bright' },
			NOW,
		);
		const future = restorePetState( { version: 2, glow: 1 }, NOW );

		expect( malformed ).toEqual( createPetState( NOW ) );
		expect( future ).toEqual( createPetState( NOW ) );
	} );
} );

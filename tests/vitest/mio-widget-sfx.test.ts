import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	MIO_SFX_RECIPES,
	MioSfx,
} from '../../src/plugins/mio-widget/sfx';

class FakeAudioParam {
	value = 0;
	setValueAtTime = vi.fn( ( value: number ) => {
		this.value = value;
	} );
	linearRampToValueAtTime = vi.fn();
	exponentialRampToValueAtTime = vi.fn();
	cancelScheduledValues = vi.fn();
}

class FakeOscillator extends EventTarget {
	type: OscillatorType = 'sine';
	frequency = new FakeAudioParam();
	connect = vi.fn( ( node: unknown ) => node );
	disconnect = vi.fn();
	start = vi.fn();
	stop = vi.fn();
}

class FakeGain {
	gain = new FakeAudioParam();
	connect = vi.fn( ( node: unknown ) => node );
	disconnect = vi.fn();
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	currentTime = 1;
	state: AudioContextState = 'running';
	destination = {};
	oscillators: FakeOscillator[] = [];
	resume = vi.fn( async () => undefined );
	suspend = vi.fn( async () => undefined );
	close = vi.fn( async () => undefined );

	constructor() {
		FakeAudioContext.instances.push( this );
	}

	createOscillator(): OscillatorNode {
		const oscillator = new FakeOscillator();
		this.oscillators.push( oscillator );
		return oscillator as unknown as OscillatorNode;
	}

	createGain(): GainNode {
		return new FakeGain() as unknown as GainNode;
	}
}

describe( 'Mio 16-bit sound effects', () => {
	beforeEach( () => {
		FakeAudioContext.instances = [];
		Object.defineProperty( window, 'AudioContext', {
			configurable: true,
			value: FakeAudioContext,
		} );
		Object.defineProperty( window, 'matchMedia', {
			configurable: true,
			value: vi.fn( () => ( { matches: false } ) ),
		} );
		Object.defineProperty( document, 'hidden', {
			configurable: true,
			value: false,
		} );
		vi.spyOn( performance, 'now' ).mockReturnValue( 1_000 );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	test( 'keeps every procedural recipe short, quiet, and in a compact register', () => {
		for ( const tones of Object.values( MIO_SFX_RECIPES ) ) {
			expect( Math.max( ...tones.map( ( tone ) => tone.offsetMs + tone.durationMs ) ) )
				.toBeLessThanOrEqual( 220 );
			for ( const tone of tones ) {
				expect( tone.frequency ).toBeGreaterThanOrEqual( 220 );
				expect( tone.frequency ).toBeLessThanOrEqual( 1_200 );
				expect( tone.gain ).toBeLessThanOrEqual( 0.05 );
				expect( [ 'square', 'triangle' ] ).toContain( tone.wave );
			}
		}
	} );

	test( 'creates no audio context until a trusted Mio action', () => {
		const sfx = new MioSfx( true );

		sfx.play( 'boop', false );
		expect( FakeAudioContext.instances ).toHaveLength( 0 );

		sfx.play( 'boop', true );
		expect( FakeAudioContext.instances ).toHaveLength( 1 );
		expect( FakeAudioContext.instances[ 0 ]?.oscillators ).toHaveLength( 2 );
		expect(
			FakeAudioContext.instances[ 0 ]?.oscillators.map(
				( oscillator ) => oscillator.frequency.value,
			),
		).toEqual( [ 660, 880 ] );

		sfx.dispose();
	} );

	test( 'mute prevents construction and reduced motion collapses a cue', () => {
		const muted = new MioSfx( false );
		muted.play( 'explore', true );
		expect( FakeAudioContext.instances ).toHaveLength( 0 );

		vi.mocked( window.matchMedia ).mockReturnValue( {
			matches: true,
		} as MediaQueryList );
		const reduced = new MioSfx( true );
		reduced.play( 'explore', true );
		const context = FakeAudioContext.instances[ 0 ];
		expect( context?.oscillators ).toHaveLength( 1 );
		expect( context?.oscillators[ 0 ]?.type ).toBe( 'triangle' );
		reduced.dispose();
	} );

	test( 'rate-limits repeats and releases audio on hide and teardown', () => {
		const sfx = new MioSfx( true );
		sfx.play( 'quiet', true );
		sfx.play( 'quiet', true );
		const context = FakeAudioContext.instances[ 0 ]!;
		expect( context.oscillators ).toHaveLength( 1 );

		sfx.suspend();
		expect( context.suspend ).toHaveBeenCalledOnce();
		sfx.dispose();
		sfx.dispose();
		expect( context.close ).toHaveBeenCalledOnce();
	} );
} );

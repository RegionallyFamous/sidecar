import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __ } from '../../src/i18n';
import { createMioCopy } from '../../src/plugins/mio-widget/copy';
import { mountMioWidget } from '../../src/plugins/mio-widget/mount';
import type {
	WidgetContext,
	WidgetStorage,
} from '../../src/widgets/types';

const NOW = Date.UTC( 2026, 7, 4, 18, 0, 0 );

vi.mock( '../../src/i18n', () => ( {
	__: vi.fn( ( source: string ) => source ),
} ) );

const translate = vi.mocked( __ );

function createStorage(): WidgetStorage & {
	values: Map< string, unknown >;
	set: ReturnType< typeof vi.fn >;
} {
	const values = new Map< string, unknown >();
	return {
		values,
		get< T >( key: string ): T | null {
			return values.has( key ) ? values.get( key ) as T : null;
		},
		set: vi.fn( ( key: string, value: unknown ) => {
			values.set( key, value );
		} ),
		remove( key: string ): void {
			values.delete( key );
		},
		clear(): void {
			values.clear();
		},
	};
}

function createContext( storage = createStorage() ): WidgetContext {
	return {
		id: 'openstation/mio',
		pluginUrl: 'https://example.test/wp-content/plugins/desktop-mode',
		storage,
	};
}

function widgetRoot(): HTMLElement {
	return document.querySelector< HTMLElement >( '.mio-companion' )!;
}

describe( 'Mio companion mount', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		vi.setSystemTime( NOW );
		translate.mockClear();
		translate.mockImplementation( ( source ) => source );
		document.body.innerHTML = '<main id="widget"></main>';
		Object.defineProperty( document, 'hidden', {
			configurable: true,
			value: false,
		} );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	test( 'mounts a labelled, keyboard-native companion using the core plugin URL', () => {
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const teardown = mountMioWidget( container, createContext() );

		expect( container.querySelectorAll( 'button' ) ).toHaveLength( 4 );
		expect(
			container.querySelector(
				'[role="status"][aria-live="polite"][aria-atomic="true"]',
			),
		).not.toBeNull();
		expect( container.querySelectorAll( 'progress, [data-meter], [data-value]' ) )
			.toHaveLength( 0 );
		expect(
			container.querySelector( '[data-action="boop"]' )
				?.getAttribute( 'aria-label' ),
		).toBe( 'Greet Mio' );
		expect(
			container.querySelector( '[data-action="boop"] svg' )
				?.getAttribute( 'shape-rendering' ),
		).toBe( 'crispEdges' );
		expect(
			container.querySelector( '.mio-companion__shell-art' )
				?.getAttribute( 'viewBox' ),
		).toBe( '0 0 108 150' );
		expect(
			container.querySelectorAll( '.mio-companion__shell-art path' ),
		).toHaveLength( 9 );
		expect(
			container.querySelector( '[data-action="boop"] linearGradient' ),
		).not.toBeNull();
		expect(
			container.querySelectorAll(
				'[data-action="boop"] linearGradient stop',
			),
		).toHaveLength( 14 );
		expect( container.querySelector( '.mio-companion__ring' ) ).not.toBeNull();
		expect(
			container.querySelector( '.mio-companion__interior' ),
		).not.toBeNull();
		expect( container.querySelector( '.mio-companion__mood' ) ).toBeNull();
		expect(
			container.querySelector( '.mio-companion__eyes rect[rx]' ),
		).toBeNull();
		expect(
			container.querySelector( '[role="status"]' )?.textContent,
		).toBe( '' );
		expect( widgetRoot().dataset.messageVisible ).toBeUndefined();
		expect(
			Array.from(
				container.querySelectorAll< HTMLElement >(
					'.mio-companion__control-label',
				),
				( label ) => label.textContent,
			),
		).toEqual( [ 'Light', 'Quiet', 'Explore' ] );
		expect(
			widgetRoot().style.getPropertyValue( '--mio-habitat-image' ),
		).toBe(
			'url("https://example.test/wp-content/plugins/desktop-mode/assets/images/mio-lcd-habitat-pixel.webp")',
		);

		teardown();
	} );

	test( 'uses unique title ids for simultaneous instances', () => {
		const first = document.querySelector< HTMLElement >( '#widget' )!;
		const second = document.createElement( 'main' );
		document.body.appendChild( second );
		const teardownFirst = mountMioWidget( first, createContext() );
		const teardownSecond = mountMioWidget( second, createContext() );
		const roots = document.querySelectorAll< HTMLElement >( '.mio-companion' );
		const labelledBy = Array.from( roots, ( root ) =>
			root.getAttribute( 'aria-labelledby' ),
		);
		const gradientIds = Array.from(
			document.querySelectorAll< SVGLinearGradientElement >(
				'.mio-companion linearGradient',
			),
			( gradient ) => gradient.id,
		);

		expect( new Set( labelledBy ).size ).toBe( 2 );
		expect( new Set( gradientIds ).size ).toBe( 2 );
		for ( const id of labelledBy ) {
			expect( id ).not.toBeNull();
			expect( document.getElementById( id! ) ).not.toBeNull();
		}

		teardownFirst();
		teardownSecond();
	} );

	test( 'inserts translated visible and accessible copy as text, never markup', () => {
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		translate.mockImplementation( ( source ) => `<b>${ source }</b>` );
		const translated = createMioCopy();
		const teardown = mountMioWidget(
			container,
			createContext(),
			translated,
		);

		expect( container.querySelector( 'b' ) ).toBeNull();
		expect( translate ).toHaveBeenCalledWith( 'Mio', 'desktop-mode' );
		expect( translate ).toHaveBeenCalledWith(
			'Mio found a story.',
			'desktop-mode',
		);
		expect(
			container.querySelector( '.mio-companion__title' )?.textContent,
		).toBe( '<b>Mio</b>' );
		expect(
			container.querySelector( '.mio-companion__note' )?.textContent,
		).toBe( '<b>No rush. Mio waits here.</b>' );
		expect(
			Array.from(
				container.querySelectorAll< HTMLElement >(
					'.mio-companion__control-label',
				),
				( label ) => label.textContent,
			),
		).toEqual( [ '<b>Light</b>', '<b>Quiet</b>', '<b>Explore</b>' ] );
		expect(
			container.querySelector( '[role="status"]' )?.textContent,
		).toBe( '' );
		expect(
			container.querySelector( '.mio-companion__screen' )
				?.getAttribute( 'aria-label' ),
		).toBe( "<b>Mio's companion screen</b>" );
		expect(
			container.querySelector( '[data-action="boop"]' )
				?.getAttribute( 'aria-label' ),
		).toBe( '<b>Greet Mio</b>' );

		container.querySelector< HTMLButtonElement >(
			'[data-action="quiet"]',
		)!.click();
		expect(
			container.querySelector( '[role="status"]' )?.textContent,
		).toBe( '<b>Mio rests quietly.</b>' );
		expect( container.querySelector( 'b' ) ).toBeNull();

		teardown();
	} );

	test( 'shows reaction copy temporarily and restarts the window for a new action', () => {
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const teardown = mountMioWidget( container, createContext() );
		const root = widgetRoot();
		const status = container.querySelector< HTMLElement >(
			'[role="status"]',
		)!;

		expect( status.textContent ).toBe( '' );
		expect( root.dataset.messageVisible ).toBeUndefined();

		container.querySelector< HTMLButtonElement >(
			'[data-action="boop"]',
		)!.click();
		expect( status.textContent ).toBe( 'Mio drifts closer.' );
		expect( root.dataset.messageVisible ).toBe( 'true' );

		vi.advanceTimersByTime( 2000 );
		container.querySelector< HTMLButtonElement >(
			'[data-action="quiet"]',
		)!.click();
		expect( status.textContent ).toBe( 'Mio rests quietly.' );

		vi.advanceTimersByTime( 2599 );
		expect( status.textContent ).toBe( 'Mio rests quietly.' );
		expect( root.dataset.messageVisible ).toBe( 'true' );

		vi.advanceTimersByTime( 1 );
		expect( status.textContent ).toBe( '' );
		expect( root.dataset.messageVisible ).toBeUndefined();

		teardown();
	} );

	test.each( [
		[ 'os-widgets__card', 'os-widgets__card--mio-companion' ],
		[
			'desktop-mode-widgets__card',
			'desktop-mode-widgets__card--mio-companion',
		],
	] )( 'marks and restores the %s host frame', ( baseClass, modifierClass ) => {
		document.body.innerHTML = `
			<article class="${ baseClass }">
				<main class="${ baseClass }-body" id="widget"></main>
			</article>
		`;
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const card = container.parentElement!;
		const teardown = mountMioWidget( container, createContext() );

		expect( container.classList.contains( 'mio-companion-host' ) ).toBe( true );
		expect( card.classList.contains( modifierClass ) ).toBe( true );

		teardown();
		expect( container.classList.contains( 'mio-companion-host' ) ).toBe( false );
		expect( card.classList.contains( modifierClass ) ).toBe( false );
	} );

	test( 'persists only through the stable pet-state key', () => {
		const storage = createStorage();
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const teardown = mountMioWidget( container, createContext( storage ) );

		container.querySelector< HTMLButtonElement >(
			'[data-action="explore"]',
		)!.click();

		expect( Array.from( storage.values.keys() ) ).toEqual( [ 'pet-state' ] );
		expect( storage.values.get( 'pet-state' ) ).toMatchObject( {
			wonder: 96,
			interactions: 1,
		} );
		expect(
			container.querySelector( '[role="status"]' )?.textContent,
		).toBe( 'Mio found a story.' );

		teardown();
	} );

	test( 'does not rewrite an unchanged passive status announcement', () => {
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const teardown = mountMioWidget( container, createContext() );
		const status = container.querySelector< HTMLElement >(
			'[role="status"]',
		)!;
		const observer = new MutationObserver( () => undefined );
		observer.observe( status, {
			childList: true,
			characterData: true,
			subtree: true,
		} );

		vi.advanceTimersByTime( 5 * 60 * 1000 );

		expect( observer.takeRecords() ).toHaveLength( 0 );
		observer.disconnect();
		teardown();
	} );

	test( 'cleans timers, listeners, and DOM idempotently', () => {
		const storage = createStorage();
		const container = document.querySelector< HTMLElement >( '#widget' )!;
		const teardown = mountMioWidget( container, createContext( storage ) );

		container.querySelector< HTMLButtonElement >(
			'[data-action="quiet"]',
		)!.click();
		teardown();
		teardown();
		const writesAfterTeardown = storage.set.mock.calls.length;
		document.dispatchEvent( new Event( 'visibilitychange' ) );
		vi.advanceTimersByTime( 10 * 60 * 1000 );

		expect( storage.set ).toHaveBeenCalledTimes( writesAfterTeardown );
		expect( container.children ).toHaveLength( 0 );
		expect( vi.getTimerCount() ).toBe( 0 );
	} );
} );

/**
 * Iframe-side tests for Gutenberg's Sidebar Window handler.
 *
 * The source editor parks its complementary area while a separate
 * managed OpenStation window displays the requested area. The bridge
 * must restore the exact source area when that sibling closes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installEditorSidecarHandler } from '../../src/iframe-bridge-standalone';

const WIDTH_KEY = 'openstation.editorSidecar.width';

interface SidecarState {
	type: 'os-editor-sidecar-state';
	active: boolean;
	available: boolean;
	width: number;
}

interface GutenbergRig {
	activeArea: string | null;
	enable: ReturnType< typeof vi.fn >;
	disable: ReturnType< typeof vi.fn >;
}

let postMessage: ReturnType< typeof vi.spyOn >;
let installed = false;

function sendSet(
	active: boolean,
	opts: { detached?: boolean; area?: string | null } = {},
	origin = window.location.origin,
): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin,
			data: { type: 'os-editor-sidecar-set', active, ...opts },
		} ),
	);
}

function sendSource(
	parked: boolean,
	origin = window.location.origin,
): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin,
			data: { type: 'os-editor-sidecar-source', parked },
		} ),
	);
}

function states(): SidecarState[] {
	return postMessage.mock.calls
		.map( ( call ) => call[ 0 ] as unknown )
		.filter(
			( message ): message is SidecarState =>
				!! message &&
				typeof message === 'object' &&
				( message as { type?: unknown } ).type ===
					'os-editor-sidecar-state',
		);
}

function lastState(): SidecarState {
	const all = states();
	return all[ all.length - 1 ];
}

function installGutenberg( currentArea: string | null = null ): GutenbergRig {
	const rig: GutenbergRig = {
		activeArea: currentArea,
		enable: vi.fn( ( _scope: string, area: string ) => {
			rig.activeArea = area;
		} ),
		disable: vi.fn( () => {
			rig.activeArea = null;
		} ),
	};
	( window as unknown as { wp: unknown } ).wp = {
		data: {
			select: ( store: string ) => {
				if ( store === 'core/editor' ) {
					return {};
				}
				if ( store === 'core/interface' ) {
					return {
						getActiveComplementaryArea: () => rig.activeArea,
					};
				}
				return undefined;
			},
			dispatch: ( store: string ) =>
				store === 'core/interface'
					? {
							enableComplementaryArea: rig.enable,
							disableComplementaryArea: rig.disable,
					  }
					: undefined,
		},
	};
	return rig;
}

function addEditorDom( withSidebar = true ): HTMLElement | null {
	const skeleton = document.createElement( 'div' );
	skeleton.className = 'interface-interface-skeleton';
	document.body.appendChild( skeleton );
	if ( ! withSidebar ) {
		return null;
	}
	const sidebar = document.createElement( 'aside' );
	sidebar.className = 'interface-interface-skeleton__sidebar';
	vi.spyOn( sidebar, 'getBoundingClientRect' ).mockReturnValue( {
		width: 320,
		height: 640,
		top: 40,
		right: 1180,
		bottom: 680,
		left: 860,
		x: 860,
		y: 40,
		toJSON: () => ( {} ),
	} );
	skeleton.appendChild( sidebar );
	return sidebar;
}

async function handle(): Promise< HTMLElement > {
	await vi.waitFor( () => {
		if ( ! document.querySelector( '.os-editor-sidecar-resizer' ) ) {
			throw new Error( 'sidecar resize handle not mounted yet' );
		}
	} );
	return document.querySelector( '.os-editor-sidecar-resizer' )!;
}

beforeEach( () => {
	// The production installer intentionally has page-lifetime state and
	// deduplicates itself. Keep one listener for this jsdom document and
	// return it to its inactive baseline between tests.
	if ( installed ) {
		sendSet( false );
		sendSource( false );
	}
	document.body.innerHTML = '';
	document.body.className = '';
	document.documentElement.className = '';
	document.documentElement.style.removeProperty(
		'--os-editor-sidecar-width',
	);
	window.localStorage.clear();
	Object.defineProperty( window, 'innerWidth', {
		configurable: true,
		value: 1200,
	} );
	delete ( window as unknown as { wp?: unknown } ).wp;
	postMessage = vi.spyOn( window, 'postMessage' );
	if ( ! installed ) {
		installEditorSidecarHandler();
		installed = true;
	}
} );

afterEach( () => {
	sendSet( false );
	sendSource( false );
	postMessage.mockRestore();
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.useRealTimers();
} );

describe( 'installEditorSidecarHandler', () => {
	test( 'reports unavailable and leaves layout untouched outside Gutenberg', () => {
		sendSet( true );

		expect( lastState() ).toMatchObject( {
			type: 'os-editor-sidecar-state',
			active: false,
			available: false,
		} );
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			false,
		);
		expect(
			document.documentElement.classList.contains(
				'os-editor-sidecar-active',
			),
		).toBe( false );
	} );

	test( 'opens the requested area in detached sidebar-only mode', async () => {
		const gutenberg = installGutenberg();
		addEditorDom();

		sendSet( true, {
			detached: true,
			area: 'yoast-seo/sidebar',
		} );
		await handle();

		expect( gutenberg.enable ).toHaveBeenCalledWith(
			'core',
			'yoast-seo/sidebar',
		);
		expect(
			document.querySelector( '.os-editor-sidecar-window-chrome' ),
		).toBeNull();
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			true,
		);
		expect(
			document.documentElement.classList.contains(
				'os-editor-sidecar-active',
			),
		).toBe( true );
		expect(
			document.documentElement.style.getPropertyValue(
				'--os-editor-sidecar-width',
			),
		).toBe( '320px' );
		expect( lastState() ).toMatchObject( {
			type: 'os-editor-sidecar-state',
			active: true,
			available: true,
			width: 320,
		} );
	} );

	test( 'explicit deactivation closes an already-active plugin sidebar', () => {
		const gutenberg = installGutenberg( 'yoast-seo/sidebar' );
		addEditorDom();

		sendSet( true );
		sendSet( false );

		expect( gutenberg.enable ).not.toHaveBeenCalled();
		expect( gutenberg.disable ).toHaveBeenCalledWith( 'core' );
		expect( gutenberg.activeArea ).toBeNull();
		expect( lastState() ).toMatchObject( {
			active: false,
			available: true,
		} );
	} );

	test( 'parks and safely restores the source complementary area', () => {
		const gutenberg = installGutenberg( 'yoast-seo/sidebar' );
		addEditorDom();

		sendSource( true );
		expect( gutenberg.disable ).toHaveBeenCalledWith( 'core' );
		expect( gutenberg.activeArea ).toBeNull();

		// Duplicate park messages must not overwrite the remembered area
		// with null during iframe-ready/session replay.
		sendSource( true );
		sendSource( false );

		expect( gutenberg.enable ).toHaveBeenLastCalledWith(
			'core',
			'yoast-seo/sidebar',
		);
		expect( gutenberg.activeArea ).toBe( 'yoast-seo/sidebar' );
	} );

	test( 'mounts an accessible keyboard resizer and persists clamped width', async () => {
		installGutenberg();
		addEditorDom();
		sendSet( true );
		const resizer = await handle();

		expect( resizer.getAttribute( 'role' ) ).toBe( 'separator' );
		expect( resizer.getAttribute( 'aria-orientation' ) ).toBe( 'vertical' );
		expect( resizer.getAttribute( 'tabindex' ) ).toBe( '0' );
		expect( resizer.getAttribute( 'aria-valuemin' ) ).toBe( '280' );
		expect( resizer.getAttribute( 'aria-valuemax' ) ).toBe( '520' );

		resizer.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'End', bubbles: true } ),
		);
		expect(
			document.documentElement.style.getPropertyValue(
				'--os-editor-sidecar-width',
			),
		).toBe( '520px' );
		expect( window.localStorage.getItem( WIDTH_KEY ) ).toBe( '520' );

		resizer.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Home', bubbles: true } ),
		);
		expect(
			document.documentElement.style.getPropertyValue(
				'--os-editor-sidecar-width',
			),
		).toBe( '280px' );
		expect( window.localStorage.getItem( WIDTH_KEY ) ).toBe( '280' );
	} );

	test( 'falls back to a 240px sidebar when the viewport cannot fit 280px', () => {
		installGutenberg();
		addEditorDom( false );
		Object.defineProperty( window, 'innerWidth', {
			configurable: true,
			value: 560,
		} );

		sendSet( true );

		expect(
			document.documentElement.style.getPropertyValue(
				'--os-editor-sidecar-width',
			),
		).toBe( '240px' );
		expect( lastState().width ).toBe( 240 );
	} );

	test( 'removes the resize surface after Gutenberg closes its own sidebar', async () => {
		vi.useFakeTimers();
		const gutenberg = installGutenberg( 'yoast-seo/sidebar' );
		const sidebar = addEditorDom()!;
		sendSet( true );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( document.querySelector( '.os-editor-sidecar-resizer' ) ).not.toBeNull();

		sidebar.remove();
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync( 350 );

		expect( document.querySelector( '.os-editor-sidecar-resizer' ) ).toBeNull();
		expect(
			document.querySelector( '.os-editor-sidecar-window-chrome' ),
		).toBeNull();
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			false,
		);
		expect( lastState() ).toMatchObject( {
			active: false,
			available: true,
		} );
		// Closing from Gutenberg is authoritative; the bridge must not
		// issue a second close back into the data store.
		expect( gutenberg.disable ).not.toHaveBeenCalled();
	} );

	test( 'ignores set messages from a foreign origin', () => {
		const gutenberg = installGutenberg();
		addEditorDom( false );

		sendSet( true, {}, 'https://attacker.test' );
		sendSource( true, 'https://attacker.test' );

		expect( gutenberg.enable ).not.toHaveBeenCalled();
		expect( states() ).toHaveLength( 0 );
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			false,
		);
	} );
} );

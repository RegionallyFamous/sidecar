/**
 * Iframe-side tests for Gutenberg's Sidebar Window handler.
 *
 * These exercise the compound-editor contract: the existing
 * complementary area stays in the one Gutenberg document, while the
 * bridge supplies layout classes, an accessible resizer, persistence,
 * and state messages for the parent shell.
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

function sendSet( active: boolean, origin = window.location.origin ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin,
			data: { type: 'os-editor-sidecar-set', active },
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

async function attachedChrome(): Promise< HTMLElement > {
	await vi.waitFor( () => {
		if ( ! document.querySelector( '.os-editor-sidecar-window-chrome' ) ) {
			throw new Error( 'attached sidebar window chrome not mounted yet' );
		}
	} );
	return document.querySelector( '.os-editor-sidecar-window-chrome' )!;
}

beforeEach( () => {
	// The production installer intentionally has page-lifetime state and
	// deduplicates itself. Keep one listener for this jsdom document and
	// return it to its inactive baseline between tests.
	if ( installed ) {
		sendSet( false );
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

	test( 'opens Gutenberg document settings and mounts attached window chrome', async () => {
		const gutenberg = installGutenberg();
		addEditorDom();

		sendSet( true );
		const chrome = await attachedChrome();
		const close = chrome.querySelector< HTMLButtonElement >( 'button' );

		expect( gutenberg.enable ).toHaveBeenCalledWith(
			'core',
			'edit-post/document',
		);
		expect( chrome.textContent ).toContain( 'Sidebar Window' );
		expect( close ).not.toBeNull();
		expect( close!.getAttribute( 'aria-label' ) ).toBe(
			'Close Sidebar Window',
		);
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
		expect( lastState() ).toEqual( {
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

	test( 'attached chrome close tears down the window and reports inactive', async () => {
		const gutenberg = installGutenberg( 'yoast-seo/sidebar' );
		addEditorDom();
		sendSet( true );
		const chrome = await attachedChrome();
		const resizer = await handle();
		resizer.dispatchEvent(
			new MouseEvent( 'pointerdown', {
				bubbles: true,
				button: 0,
				clientX: 860,
			} ),
		);
		expect(
			document.body.classList.contains( 'os-editor-sidecar-resizing' ),
		).toBe( true );

		chrome.querySelector< HTMLButtonElement >( 'button' )!.click();

		expect( gutenberg.disable ).toHaveBeenCalledWith( 'core' );
		expect(
			document.querySelector( '.os-editor-sidecar-window-chrome' ),
		).toBeNull();
		expect( document.querySelector( '.os-editor-sidecar-resizer' ) ).toBeNull();
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			false,
		);
		expect(
			document.documentElement.classList.contains(
				'os-editor-sidecar-active',
			),
		).toBe( false );
		expect(
			document.body.classList.contains( 'os-editor-sidecar-resizing' ),
		).toBe( false );
		expect( lastState() ).toMatchObject( {
			active: false,
			available: true,
		} );
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

		sendSet( true, 'https://attacker.test' );

		expect( gutenberg.enable ).not.toHaveBeenCalled();
		expect( states() ).toHaveLength( 0 );
		expect( document.body.classList.contains( 'os-editor-sidecar-active' ) ).toBe(
			false,
		);
	} );
} );

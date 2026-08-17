/**
 * Parent-shell tests for Gutenberg's Sidebar Window.
 *
 * The shell owns discovery, persistence, window sizing, and the
 * postMessage lifecycle. Gutenberg's sidebar DOM remains in the
 * editor iframe and is covered separately by the iframe-handler
 * tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const STORAGE_KEY = 'openstation.editorSidecar.activeWindows';

interface FrameWindow {
	document: Document;
	wp?: {
		data?: {
			select?: ( store: string ) => Record< string, unknown > | undefined;
		};
	};
	postMessage: ReturnType< typeof vi.fn >;
}

interface FakeWindow {
	id: string;
	config: { native?: boolean };
	iframe: HTMLIFrameElement | null;
	element: HTMLElement;
	maximize: ReturnType< typeof vi.fn >;
	renderCustomTitleBarButtons: ReturnType< typeof vi.fn >;
}

function gutenbergFrame(): FrameWindow {
	const frameDocument = document.implementation.createHTMLDocument();
	const skeleton = frameDocument.createElement( 'div' );
	skeleton.className = 'interface-interface-skeleton';
	frameDocument.body.appendChild( skeleton );
	return {
		document: frameDocument,
		wp: {
			data: {
				select: ( store: string ) => {
					if ( store === 'core/editor' || store === 'core/interface' ) {
						return {};
					}
					return undefined;
				},
			},
		},
		postMessage: vi.fn(),
	};
}

function fakeWindow( id: string, frame = gutenbergFrame() ): FakeWindow {
	const desktop = document.createElement( 'div' );
	const element = document.createElement( 'section' );
	desktop.appendChild( element );
	document.body.appendChild( desktop );
	Object.defineProperty( desktop, 'clientWidth', {
		configurable: true,
		value: 1200,
	} );
	vi.spyOn( element, 'getBoundingClientRect' ).mockReturnValue( {
		width: 720,
		height: 600,
		top: 0,
		right: 720,
		bottom: 600,
		left: 0,
		x: 0,
		y: 0,
		toJSON: () => ( {} ),
	} );
	return {
		id,
		config: {},
		iframe: { contentWindow: frame } as unknown as HTMLIFrameElement,
		element,
		maximize: vi.fn(),
		renderCustomTitleBarButtons: vi.fn(),
	};
}

function fakeManager() {
	const windows = new Map< string, FakeWindow >();
	return {
		windows,
		add( win: FakeWindow ) {
			windows.set( win.id, win );
		},
		getById( id: string ) {
			return windows.get( id ) ?? null;
		},
	};
}

async function boot() {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const sidecar = await import( '../../src/editor-sidecar' );
	const registry = await import( '../../src/title-bar-buttons/registry' );
	const manager = fakeManager();
	sidecar.bootEditorSidecar( { manager } );
	const def = registry
		.listTitleBarButtons()
		.find( ( candidate ) => candidate.id === 'desktop-mode/editor-sidecar' )!;
	return { manager, def };
}

function renderButton(
	def: { render?: ( host: HTMLElement, win: never ) => void },
	win: FakeWindow,
): HTMLElement {
	const host = document.createElement( 'os-window-button' );
	document.body.appendChild( host );
	def.render!( host, win as never );
	return host;
}

function stateMessage(
	frame: FrameWindow,
	data: unknown,
	origin = window.location.origin,
): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin,
			source: frame as unknown as Window,
			data,
		} ),
	);
}

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
	window.localStorage.clear();
} );

afterEach( () => {
	clearHooksStub();
	window.localStorage.clear();
	_resetAllSharedStoresForTests();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
} );

describe( 'bootEditorSidecar', () => {
	test( 'registers a right-side title-bar toggle immediately before Preview', async () => {
		const { def } = await boot();

		expect( def ).toBeDefined();
		expect( def.label ).toBe( 'Sidebar Window' );
		expect( def.icon ).toBe( 'dashicons-columns' );
		expect( def.placement ).toBe( 'right' );
		expect( def.order ).toBe( 54 );
	} );

	test( 'matches only iframe windows with editor and complementary-area stores', async () => {
		const { def } = await boot();
		const gutenberg = fakeWindow( 'gutenberg' );
		expect( def.match( gutenberg as never ) ).toBe( true );

		gutenberg.config.native = true;
		expect( def.match( gutenberg as never ) ).toBe( false );

		const classicFrame = gutenbergFrame();
		classicFrame.wp!.data!.select = ( store ) =>
			store === 'core/editor' ? {} : undefined;
		expect( def.match( fakeWindow( 'classic', classicFrame ) as never ) ).toBe(
			false,
		);

		const legacyInterface = gutenbergFrame();
		legacyInterface.wp!.data!.select = ( store ) =>
			store === 'core/editor' || store === 'core/edit-post' ? {} : undefined;
		expect(
			def.match( fakeWindow( 'legacy-interface', legacyInterface ) as never ),
		).toBe( true );
	} );

	test( 'activates the split, persists it, and maximizes a narrow editor', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-17', frame );
		manager.add( editor );
		const host = renderButton( def, editor );

		expect( host.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		host.click();

		expect( editor.maximize ).toHaveBeenCalledTimes( 1 );
		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-set', active: true },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[ 'post-17' ],
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );

		const repainted = renderButton( def, editor );
		expect( repainted.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
	} );

	test( 'second activation disables the split and clears persistence', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-21', frame );
		manager.add( editor );
		const host = renderButton( def, editor );

		host.click();
		host.click();

		expect( frame.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'os-editor-sidecar-set', active: false },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
		// Maximizing is activation-only, not part of the off path.
		expect( editor.maximize ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'restores a persisted split after the replacement iframe is ready', async () => {
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( [ 'post-33' ] ) );
		const { manager } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-33', frame );
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: 'post-33' } );

		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-set', active: true },
			window.location.origin,
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );
		// Session restore should not unexpectedly resize the window.
		expect( editor.maximize ).not.toHaveBeenCalled();
	} );

	test( 'waits for Gutenberg stores and DOM that mount after bridge readiness', async () => {
		vi.useFakeTimers();
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( [ 'post-34' ] ) );
		const frame = gutenbergFrame();
		const select = frame.wp!.data!.select!;
		frame.wp!.data!.select = () => undefined;
		frame.document.querySelector( '.interface-interface-skeleton' )?.remove();
		const { manager, def } = await boot();
		const editor = fakeWindow( 'post-34', frame );
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: 'post-34' } );
		expect( def.match( editor as never ) ).toBe( false );
		expect( frame.postMessage ).not.toHaveBeenCalled();

		frame.wp!.data!.select = select;
		const skeleton = frame.document.createElement( 'div' );
		skeleton.className = 'interface-interface-skeleton';
		frame.document.body.appendChild( skeleton );
		await vi.advanceTimersByTimeAsync( 250 );

		expect( def.match( editor as never ) ).toBe( true );
		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-set', active: true },
			window.location.origin,
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'follows Gutenberg when its own close control closes the sidebar', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-45', frame );
		manager.add( editor );
		renderButton( def, editor ).click();
		editor.renderCustomTitleBarButtons.mockClear();

		stateMessage( frame, {
			type: 'os-editor-sidecar-state',
			active: false,
			available: true,
		} );

		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );
		expect( renderButton( def, editor ).getAttribute( 'aria-pressed' ) ).toBe(
			'false',
		);
	} );

	test( 'ignores sidecar state from a foreign origin or another iframe', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-51', frame );
		manager.add( editor );
		renderButton( def, editor ).click();
		editor.renderCustomTitleBarButtons.mockClear();

		stateMessage(
			frame,
			{ type: 'os-editor-sidecar-state', active: false },
			'https://attacker.test',
		);
		stateMessage( gutenbergFrame(), {
			type: 'os-editor-sidecar-state',
			active: false,
		} );

		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[ 'post-51' ],
		);
		expect( editor.renderCustomTitleBarButtons ).not.toHaveBeenCalled();
	} );
} );

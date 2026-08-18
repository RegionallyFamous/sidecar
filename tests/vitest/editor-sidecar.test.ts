/**
 * Parent-shell tests for Gutenberg's Sidebar Window.
 *
 * The shell owns discovery, pairing, persistence, and the postMessage
 * lifecycle between the source editor and its managed sidebar sibling.
 * Iframe behavior is covered separately by the handler tests.
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
	history?: {
		state: unknown;
		replaceState: ReturnType< typeof vi.fn >;
	};
	location?: { href: string };
	wp?: {
		data?: {
			select?: ( store: string ) => Record< string, unknown > | undefined;
		};
	};
	postMessage: ReturnType< typeof vi.fn >;
}

interface FakeWindow {
	id: string;
	config: {
		native?: boolean;
		url?: string;
		baseId?: string;
		title?: string;
		ephemeral?: boolean;
		initialState?: string;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		minWidth?: number;
		onClose?: () => void;
	};
	iframe: HTMLIFrameElement | null;
	element: HTMLElement;
	state: string;
	maximize: ReturnType< typeof vi.fn >;
	applySnap: ReturnType< typeof vi.fn >;
	renderCustomTitleBarButtons: ReturnType< typeof vi.fn >;
	getCurrentUrl: () => string;
	close: ReturnType< typeof vi.fn >;
	destroy: ReturnType< typeof vi.fn >;
	acceptClose: ReturnType< typeof vi.fn >;
	setRect: ( next: Partial< { x: number; y: number; width: number; height: number } > ) => void;
}

function gutenbergFrame( activeArea: string | null = 'edit-post/document' ): FrameWindow {
	const frameDocument = document.implementation.createHTMLDocument();
	const skeleton = frameDocument.createElement( 'div' );
	skeleton.className = 'interface-interface-skeleton';
	frameDocument.body.appendChild( skeleton );
	return {
		document: frameDocument,
		wp: {
			data: {
				select: ( store: string ) => {
					if ( store === 'core/editor' ) {
						return {};
					}
					if ( store === 'core/interface' ) {
						return {
							getActiveComplementaryArea: () => activeArea,
						};
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
	element.className = 'os-window';
	const iframe = document.createElement( 'iframe' );
	Object.defineProperty( iframe, 'contentWindow', {
		configurable: true,
		value: frame,
	} );
	element.appendChild( iframe );
	desktop.appendChild( element );
	document.body.appendChild( desktop );
	Object.defineProperty( desktop, 'clientWidth', {
		configurable: true,
		value: 1200,
	} );
	let rect = { x: 100, y: 80, width: 720, height: 600 };
	vi.spyOn( element, 'getBoundingClientRect' ).mockImplementation( () => ( {
		...rect,
		top: rect.y,
		right: rect.x + rect.width,
		bottom: rect.y + rect.height,
		left: rect.x,
		toJSON: () => ( {} ),
	} ) );
	for ( const [ property, key ] of [
		[ 'offsetLeft', 'x' ],
		[ 'offsetTop', 'y' ],
		[ 'offsetWidth', 'width' ],
		[ 'offsetHeight', 'height' ],
	] as const ) {
		Object.defineProperty( element, property, {
			configurable: true,
			get: () => {
				const styleProperty = {
					x: 'left',
					y: 'top',
					width: 'width',
					height: 'height',
				}[ key ] as 'left' | 'top' | 'width' | 'height';
				const styled = Number.parseFloat( element.style[ styleProperty ] );
				return Number.isFinite( styled ) ? styled : rect[ key ];
			},
		} );
	}
	const win: FakeWindow = {
		id,
		config: {
			url: `/wp-admin/post.php?post=${ encodeURIComponent( id ) }&action=edit`,
		},
		iframe,
		element,
		state: 'normal',
		maximize: vi.fn(),
		applySnap: vi.fn(),
		renderCustomTitleBarButtons: vi.fn(),
		getCurrentUrl: () =>
			`/wp-admin/post.php?post=${ encodeURIComponent( id ) }&action=edit`,
		close: vi.fn(),
		destroy: vi.fn(),
		acceptClose: vi.fn( () => win.config.onClose?.() ),
		setRect: ( next ) => {
			for ( const [ key, value ] of Object.entries( next ) ) {
				if ( typeof value === 'number' ) {
					rect[ key as keyof typeof rect ] = value;
					const styleProperty = {
						x: 'left',
						y: 'top',
						width: 'width',
						height: 'height',
					}[ key ] as 'left' | 'top' | 'width' | 'height';
					element.style[ styleProperty ] = `${ value }px`;
				}
			}
		},
	};
	return win;
}

function fakeManager() {
	const desktop = document.createElement( 'div' );
	desktop.className = 'os-area';
	let desktopSize = { width: 1200, height: 800 };
	Object.defineProperties( desktop, {
		clientWidth: {
			configurable: true,
			get: () => desktopSize.width,
		},
		clientHeight: {
			configurable: true,
			get: () => desktopSize.height,
		},
	} );
	document.body.appendChild( desktop );
	const windows = new Map< string, FakeWindow >();
	const mount = ( config: FakeWindow[ 'config' ] & { id: string } ) => {
		const win = fakeWindow( config.id );
		win.config = { ...config };
		win.state = config.initialState ?? 'normal';
		win.getCurrentUrl = () => config.url ?? '';
		for ( const property of [ 'left', 'top', 'width', 'height' ] as const ) {
			const value =
				property === 'left'
					? config.x
					: property === 'top'
						? config.y
						: config[ property ];
			if ( typeof value === 'number' ) {
				win.element.style[ property ] = `${ value }px`;
			}
		}
		win.setRect( {
			x: config.x,
			y: config.y,
			width: config.width,
			height: config.height,
		} );
		desktop.appendChild( win.element );
		windows.set( win.id, win );
		return win;
	};
	const open = vi.fn( async ( config: FakeWindow[ 'config' ] & { id: string } ) =>
		mount( config ),
	);
	return {
		desktop,
		windows,
		open,
		mount,
		add( win: FakeWindow ) {
			desktop.appendChild( win.element );
			windows.set( win.id, win );
		},
		remove( id: string ) {
			windows.get( id )?.element.remove();
			windows.delete( id );
		},
		setDesktopSize( next: Partial< typeof desktopSize > ) {
			desktopSize = { ...desktopSize, ...next };
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

async function clickButton(
	def: { render?: ( host: HTMLElement, win: never ) => void },
	win: FakeWindow,
): Promise< HTMLElement > {
	const host = renderButton( def, win );
	host.click();
	for ( let i = 0; i < 8; i++ ) {
		await Promise.resolve();
	}
	return host;
}

async function flushMicrotasks(): Promise< void > {
	for ( let i = 0; i < 8; i++ ) {
		await Promise.resolve();
	}
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
	document.documentElement.dir = 'ltr';
} );

afterEach( () => {
	clearHooksStub();
	window.localStorage.clear();
	_resetAllSharedStoresForTests();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	document.documentElement.removeAttribute( 'dir' );
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

		const companion = fakeWindow( 'gutenberg--sidebar-window' );
		expect( def.match( companion as never ) ).toBe( false );
		const companionByUrl = fakeWindow( 'custom-companion' );
		companionByUrl.getCurrentUrl = () =>
			'/wp-admin/post.php?post=7&action=edit&openstation_sidebar_window=1';
		expect( def.match( companionByUrl as never ) ).toBe( false );
	} );

	test( 'opens a narrow floating sibling directly beside the unchanged editor', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame( 'yoast-seo/sidebar' );
		const editor = fakeWindow( 'post-17', frame );
		manager.add( editor );
		const originalIframe = editor.iframe;
		const host = await clickButton( def, editor );

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config ).toMatchObject( {
			id: 'post-17--sidebar-window',
			baseId: 'post-17--sidebar-window',
			title: 'Sidebar Window',
			ephemeral: true,
			x: 820,
			y: 80,
			width: 320,
			height: 600,
		} );
		expect( config.initialState ?? 'normal' ).toBe( 'normal' );
		const companionUrl = new URL( config.url!, window.location.origin );
		expect( companionUrl.searchParams.get( 'openstation_sidebar_window' ) ).toBe(
			'1',
		);
		expect( companionUrl.searchParams.get( 'action' ) ).toBe( 'edit' );
		expect( editor.applySnap ).not.toHaveBeenCalled();
		expect( editor.maximize ).not.toHaveBeenCalled();
		expect( editor.state ).toBe( 'normal' );
		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: true },
			window.location.origin,
		);

		const companion = manager.getById( 'post-17--sidebar-window' )!;
		expect( companion.state ).toBe( 'normal' );
		expect( companion.element.style.left ).toBe( '820px' );
		expect( companion.element.style.top ).toBe( '80px' );
		expect( companion.element.style.width ).toBe( '320px' );
		expect( companion.element.style.height ).toBe( '600px' );
		expect( companion.element.parentElement ).toBe( editor.element.parentElement );
		expect( editor.element.contains( companion.element ) ).toBe( false );
		expect( editor.iframe ).toBe( originalIframe );
		expect( editor.element.querySelectorAll( 'iframe' ) ).toHaveLength( 1 );
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[ 'post-17' ],
		);

		const repainted = renderButton( def, editor );
		expect( host.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( repainted.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
	} );

	test( 'reflows the floating sibling when the source moves or resizes', async () => {
		const { manager, def } = await boot();
		const editor = fakeWindow( 'post-geometry' );
		manager.add( editor );
		await clickButton( def, editor );
		const companion = manager.getById( 'post-geometry--sidebar-window' )!;

		editor.setRect( { x: 140, y: 120 } );
		hooks.doAction( HOOKS.WINDOW_BOUNDS_CHANGED, {
			windowId: editor.id,
			x: 140,
			y: 120,
			width: 720,
			height: 600,
			state: 'normal',
			phase: 'drag',
		} );

		expect( companion.element.style.left ).toBe( '860px' );
		expect( companion.element.style.top ).toBe( '120px' );
		expect( companion.element.style.width ).toBe( '320px' );
		expect( companion.element.style.height ).toBe( '600px' );

		editor.setRect( { width: 760, height: 660 } );
		hooks.doAction( HOOKS.WINDOW_BOUNDS_CHANGED, {
			windowId: editor.id,
			x: 140,
			y: 120,
			width: 760,
			height: 660,
			state: 'normal',
			phase: 'resize',
		} );

		expect( companion.element.style.left ).toBe( '900px' );
		expect( companion.element.style.top ).toBe( '120px' );
		expect( companion.element.style.width ).toBe( '320px' );
		expect( companion.element.style.height ).toBe( '660px' );
		expect( editor.applySnap ).not.toHaveBeenCalled();
	} );

	test( 'restores fitted source geometry on accepted close and clamps it to the current desktop', async () => {
		const { manager, def } = await boot();
		const editor = fakeWindow( 'post-edge-restore' );
		editor.setRect( { x: 200, y: 80, width: 1000, height: 600 } );
		manager.add( editor );

		await clickButton( def, editor );
		const companion = manager.getById(
			'post-edge-restore--sidebar-window',
		)!;

		// Fitting the 320px companion temporarily shrinks and repositions the source.
		expect( editor.element.style.left ).toBe( '0px' );
		expect( editor.element.style.top ).toBe( '80px' );
		expect( editor.element.style.width ).toBe( '880px' );
		expect( companion.element.style.left ).toBe( '880px' );

		// The desktop may resize while the pair is open. Restore the original
		// 1000px width, but keep its old position inside the new 1100x650 bounds.
		manager.setDesktopSize( { width: 1100, height: 650 } );
		companion.acceptClose();

		expect( editor.element.style.left ).toBe( '100px' );
		expect( editor.element.style.top ).toBe( '50px' );
		expect( editor.element.style.width ).toBe( '1000px' );
	} );

	test( 'uses the source Gutenberg sidebar width when it is measurable', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const sidebar = frame.document.createElement( 'aside' );
		sidebar.className = 'interface-interface-skeleton__sidebar';
		frame.document.body.appendChild( sidebar );
		vi.spyOn( sidebar, 'getBoundingClientRect' ).mockReturnValue( {
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: 296,
			bottom: 600,
			width: 296,
			height: 600,
			toJSON: () => ( {} ),
		} );
		const editor = fakeWindow( 'post-measured-width', frame );
		manager.add( editor );

		await clickButton( def, editor );

		expect( manager.open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				x: 820,
				width: 296,
				minWidth: 296,
			} ),
		);
	} );

	test( 'auto-opens the demo sidebar once and consumes its URL marker', async () => {
		const { manager } = await boot();
		const frame = gutenbergFrame( 'yoast-seo/sidebar' );
		const sourceUrl = new URL(
			'/wp-admin/post.php?post=77&action=edit&openstation_sidebar_window_auto=1#editor',
			window.location.origin,
		).toString();
		frame.location = { href: sourceUrl };
		frame.history = {
			state: { editor: true },
			replaceState: vi.fn( ( _state, _title, nextUrl ) => {
				frame.location!.href = new URL(
					String( nextUrl ),
					frame.location!.href,
				).toString();
			} ),
		};
		const editor = fakeWindow( 'post-auto-demo', frame );
		editor.config.url = sourceUrl;
		editor.getCurrentUrl = () => frame.location!.href;
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: editor.id } );
		await flushMicrotasks();

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect( config ).toMatchObject( {
			id: 'post-auto-demo--sidebar-window',
			x: 820,
			y: 80,
			width: 320,
			height: 600,
		} );
		const companionUrl = new URL( config.url!, window.location.origin );
		expect( companionUrl.searchParams.get( 'openstation_sidebar_window' ) ).toBe(
			'1',
		);
		expect(
			companionUrl.searchParams.has( 'openstation_sidebar_window_auto' ),
		).toBe( false );
		expect(
			new URL( editor.config.url!, window.location.origin ).searchParams.has(
				'openstation_sidebar_window_auto',
			),
		).toBe( false );
		expect( frame.history.replaceState ).toHaveBeenCalledTimes( 1 );
		const replacedUrl = new URL(
			String( frame.history.replaceState.mock.calls[ 0 ][ 2 ] ),
			sourceUrl,
		);
		expect(
			replacedUrl.searchParams.has( 'openstation_sidebar_window_auto' ),
		).toBe( false );
		expect( replacedUrl.searchParams.get( 'post' ) ).toBe( '77' );
		expect( replacedUrl.hash ).toBe( '#editor' );
		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: true },
			window.location.origin,
		);

		const companion = manager.getById( config.id )!;
		const companionFrame =
			companion.iframe!.contentWindow as unknown as FrameWindow;
		hooks.doAction( HOOKS.IFRAME_READY, { windowId: companion.id } );
		await flushMicrotasks();

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		expect( companionFrame.postMessage ).toHaveBeenCalledWith(
			{
				type: 'os-editor-sidecar-set',
				active: true,
				detached: true,
				area: 'yoast-seo/sidebar',
			},
			window.location.origin,
		);

		companion.acceptClose();
		manager.remove( companion.id );
		hooks.doAction( HOOKS.IFRAME_READY, { windowId: editor.id } );
		await flushMicrotasks();

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'activates the companion only after its iframe is ready', async () => {
		const { manager, def } = await boot();
		const sourceFrame = gutenbergFrame( 'yoast-seo/sidebar' );
		const editor = fakeWindow( 'post-21', sourceFrame );
		manager.add( editor );
		await clickButton( def, editor );
		const companion = manager.getById( 'post-21--sidebar-window' )!;
		const companionFrame = companion.iframe!.contentWindow as unknown as FrameWindow;

		expect( def.match( companion as never ) ).toBe( false );
		expect( companionFrame.postMessage ).not.toHaveBeenCalled();
		hooks.doAction( HOOKS.IFRAME_READY, {
			windowId: 'post-21--sidebar-window',
		} );

		expect( companionFrame.postMessage ).toHaveBeenCalledWith(
			{
				type: 'os-editor-sidecar-set',
				active: true,
				detached: true,
				area: 'yoast-seo/sidebar',
			},
			window.location.origin,
		);
	} );

	test( 'toggle-off stays parked until the companion close is accepted', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-25', frame );
		manager.add( editor );
		const host = await clickButton( def, editor );
		const companion = manager.getById( 'post-25--sidebar-window' )!;
		frame.postMessage.mockClear();

		host.click();
		for ( let i = 0; i < 8; i++ ) {
			await Promise.resolve();
		}

		expect(
			companion.close.mock.calls.length + companion.destroy.mock.calls.length,
		).toBe( 1 );
		expect( frame.postMessage ).not.toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: false },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[ 'post-25' ],
		);
		expect( renderButton( def, editor ).getAttribute( 'aria-pressed' ) ).toBe(
			'true',
		);

		companion.acceptClose();

		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: false },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
	} );

	test( 'toggle-off during open closes the stale companion when open resolves', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-race-off', frame );
		manager.add( editor );
		let resolveOpen: ( () => void ) | undefined;
		manager.open.mockImplementationOnce( ( config ) =>
			new Promise( ( resolve ) => {
				resolveOpen = () => resolve( manager.mount( config ) );
			} ),
		);
		const host = renderButton( def, editor );

		host.click();
		await flushMicrotasks();
		host.click();
		await flushMicrotasks();
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);

		resolveOpen!();
		await flushMicrotasks();
		const stale = manager.getById( 'post-race-off--sidebar-window' )!;

		expect(
			stale.close.mock.calls.length + stale.destroy.mock.calls.length,
		).toBe( 1 );
		expect( frame.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'os-editor-sidecar-source', parked: false },
			window.location.origin,
		);
	} );

	test( 'on-off-on during open preserves the final desired activation', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-race-on', frame );
		manager.add( editor );
		let resolveOpen: ( () => void ) | undefined;
		manager.open.mockImplementationOnce( ( config ) =>
			new Promise( ( resolve ) => {
				resolveOpen = () => resolve( manager.mount( config ) );
			} ),
		);
		const host = renderButton( def, editor );

		host.click();
		await flushMicrotasks();
		host.click();
		await flushMicrotasks();
		host.click();
		await flushMicrotasks();
		resolveOpen!();
		await flushMicrotasks();

		const companion = manager.getById( 'post-race-on--sidebar-window' )!;
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[ 'post-race-on' ],
		);
		expect( frame.postMessage ).toHaveBeenLastCalledWith(
			{ type: 'os-editor-sidecar-source', parked: true },
			window.location.origin,
		);
		expect(
			companion.close.mock.calls.length + companion.destroy.mock.calls.length,
		).toBe( 0 );
		expect( renderButton( def, editor ).getAttribute( 'aria-pressed' ) ).toBe(
			'true',
		);
	} );

	test( 'restores a persisted sibling after the source iframe is ready', async () => {
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( [ 'post-33' ] ) );
		const { manager } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-33', frame );
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: 'post-33' } );
		for ( let i = 0; i < 8; i++ ) {
			await Promise.resolve();
		}

		expect( manager.open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'post-33--sidebar-window',
				width: 320,
				height: 600,
			} ),
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );
		expect( editor.applySnap ).not.toHaveBeenCalled();
	} );

	test( 'consumes the auto-open marker before restoring a persisted sibling', async () => {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( [ 'post-persisted-auto' ] ),
		);
		const { manager } = await boot();
		const frame = gutenbergFrame();
		const sourceUrl = new URL(
			'/wp-admin/post.php?post=88&action=edit&openstation_sidebar_window_auto=1',
			window.location.origin,
		).toString();
		frame.location = { href: sourceUrl };
		frame.history = {
			state: { editor: true },
			replaceState: vi.fn( ( _state, _title, nextUrl ) => {
				frame.location!.href = new URL(
					String( nextUrl ),
					frame.location!.href,
				).toString();
			} ),
		};
		const editor = fakeWindow( 'post-persisted-auto', frame );
		editor.config.url = sourceUrl;
		editor.getCurrentUrl = () => frame.location!.href;
		manager.add( editor );

		hooks.doAction( HOOKS.IFRAME_READY, { windowId: editor.id } );
		await flushMicrotasks();

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
		const config = manager.open.mock.calls[ 0 ][ 0 ];
		expect(
			new URL( config.url!, window.location.origin ).searchParams.has(
				'openstation_sidebar_window_auto',
			),
		).toBe( false );
		expect(
			new URL( editor.config.url!, window.location.origin ).searchParams.has(
				'openstation_sidebar_window_auto',
			),
		).toBe( false );
		expect( frame.history.replaceState ).toHaveBeenCalledTimes( 1 );

		const companion = manager.getById( config.id )!;
		companion.acceptClose();
		manager.remove( companion.id );
		hooks.doAction( HOOKS.IFRAME_READY, { windowId: editor.id } );
		await flushMicrotasks();

		expect( manager.open ).toHaveBeenCalledTimes( 1 );
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
		expect( manager.open ).not.toHaveBeenCalled();

		frame.wp!.data!.select = select;
		const skeleton = frame.document.createElement( 'div' );
		skeleton.className = 'interface-interface-skeleton';
		frame.document.body.appendChild( skeleton );
		await vi.advanceTimersByTimeAsync( 250 );

		expect( def.match( editor as never ) ).toBe( true );
		expect( manager.open ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 'post-34--sidebar-window' } ),
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'readiness exhaustion closes the unusable companion and restores the source', async () => {
		vi.useFakeTimers();
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-timeout', frame );
		manager.add( editor );
		await clickButton( def, editor );
		const companion = manager.getById( 'post-timeout--sidebar-window' )!;
		const companionFrame = companion.iframe!.contentWindow as unknown as FrameWindow;
		companionFrame.wp!.data!.select = () => undefined;
		companionFrame.document
			.querySelector( '.interface-interface-skeleton' )
			?.remove();
		frame.postMessage.mockClear();

		hooks.doAction( HOOKS.IFRAME_READY, {
			windowId: 'post-timeout--sidebar-window',
		} );
		await vi.advanceTimersByTimeAsync( 250 * 41 );

		expect(
			companion.close.mock.calls.length + companion.destroy.mock.calls.length,
		).toBe( 1 );
		companion.acceptClose();
		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: false },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
	} );

	test( 'closing the managed sibling unparks the source and clears toggle state', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-45', frame );
		manager.add( editor );
		await clickButton( def, editor );
		manager.remove( 'post-45--sidebar-window' );
		editor.renderCustomTitleBarButtons.mockClear();
		frame.postMessage.mockClear();

		hooks.doAction( HOOKS.WINDOW_CLOSED, {
			windowId: 'post-45--sidebar-window',
		} );

		expect( frame.postMessage ).toHaveBeenCalledWith(
			{ type: 'os-editor-sidecar-source', parked: false },
			window.location.origin,
		);
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
		expect( editor.renderCustomTitleBarButtons ).toHaveBeenCalledTimes( 1 );
		expect( renderButton( def, editor ).getAttribute( 'aria-pressed' ) ).toBe(
			'false',
		);
	} );

	test( 'closing the editor destroys its managed sibling', async () => {
		const { manager, def } = await boot();
		const editor = fakeWindow( 'post-49' );
		manager.add( editor );
		await clickButton( def, editor );
		const companion = manager.getById( 'post-49--sidebar-window' )!;

		manager.remove( 'post-49' );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'post-49' } );

		expect( companion.destroy ).toHaveBeenCalledTimes( 1 );
		expect( JSON.parse( window.localStorage.getItem( STORAGE_KEY )! ) ).toEqual(
			[],
		);
	} );

	test( 'ignores sidecar state from a foreign origin or another iframe', async () => {
		const { manager, def } = await boot();
		const frame = gutenbergFrame();
		const editor = fakeWindow( 'post-51', frame );
		manager.add( editor );
		await clickButton( def, editor );
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

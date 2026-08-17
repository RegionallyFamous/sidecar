/**
 * OpenStation — Gutenberg Sidebar Window.
 *
 * The editor and its sidebar are presented as two real OpenStation
 * windows. The source editor snaps to the left and a transient,
 * iframe-backed companion opens on the right with the same post URL.
 * The companion's iframe is reduced to Gutenberg's complementary area,
 * so Post, Block, and plugin-owned sidebars get normal Gutenberg runtime
 * behavior while living outside the source window's bounds.
 *
 * A separate editor document is the unavoidable boundary for a truly
 * independent shell window: an iframe cannot paint outside its own box,
 * and adopting plugin-owned React DOM into the shell would sever React
 * context and delegated events. The source's complementary area is
 * therefore parked while the companion is open, and the companion is
 * ephemeral so only the source participates in session restore.
 */

import { addAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { createSharedStore } from '../shared-store';
import { registerTitleBarButton } from '../title-bar-buttons/registry';

const ACTIVE_STORAGE_KEY = 'openstation.editorSidecar.activeWindows';
const MAX_PERSISTED_IDS = 64;
const GUTENBERG_PROBE_INTERVAL_MS = 250;
const GUTENBERG_PROBE_ATTEMPTS = 40;
const COMPANION_SUFFIX = '--sidebar-window';
const COMPANION_QUERY_KEY = 'openstation_sidebar_window';

type WindowState =
	| 'normal'
	| 'minimized'
	| 'maximized'
	| 'fullscreen'
	| 'snapped-left'
	| 'snapped-right';

interface EditorSidecarWindowLike {
	id: string;
	config: {
		native?: boolean;
		url?: string;
		desktopId?: string;
	};
	iframe?: HTMLIFrameElement | null;
	element?: HTMLElement;
	state?: WindowState;
	_savedGeometry?: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	applySnap?: ( zone: 'left' | 'right' ) => void;
	maximize?: () => void;
	toggleMaximize?: () => void;
	close?: () => void;
	destroy?: () => void;
	getCurrentUrl?: () => string;
	renderCustomTitleBarButtons?: () => void;
}

interface CompanionWindowConfig {
	id: string;
	baseId: string;
	url: string;
	title: string;
	icon: string;
	width: number;
	height: number;
	minWidth: number;
	minHeight: number;
	initialState: 'snapped-right';
	ephemeral: true;
	multi: false;
	ownerHandle: string;
	desktopId?: string;
	onClose: () => void;
}

interface EditorSidecarManager {
	getById: ( id: string ) => EditorSidecarWindowLike | null | undefined;
	open: ( config: CompanionWindowConfig ) => Promise< EditorSidecarWindowLike >;
}

interface GutenbergSelectors {
	getActiveComplementaryArea?: ( scope: string ) => string | null;
	getActiveGeneralSidebarName?: () => string | null;
}

interface GutenbergDataApi {
	select?: ( store: string ) => GutenbergSelectors | undefined;
}

interface GutenbergFrameWindow {
	wp?: { data?: GutenbergDataApi };
	document: Document;
}

interface EditorSidecarState {
	activeEditors: Set< string >;
}

interface SourceLayout {
	state: WindowState;
}

function readPersistedEditors(): Set< string > {
	try {
		const raw = window.localStorage.getItem( ACTIVE_STORAGE_KEY );
		const parsed = raw ? ( JSON.parse( raw ) as unknown ) : [];
		if ( ! Array.isArray( parsed ) ) {
			return new Set();
		}
		return new Set(
			parsed.filter(
				( id ): id is string => typeof id === 'string' && id !== '',
			),
		);
	} catch {
		return new Set();
	}
}

const store = createSharedStore< EditorSidecarState >(
	'desktop-mode/editor-sidecar',
	() => ( { activeEditors: readPersistedEditors() } ),
);

function persistEditors(): void {
	try {
		const ids = Array.from( store.state.activeEditors ).slice(
			-MAX_PERSISTED_IDS,
		);
		window.localStorage.setItem( ACTIVE_STORAGE_KEY, JSON.stringify( ids ) );
	} catch {
		/* localStorage may be blocked — the current session still works. */
	}
}

function companionId( sourceId: string ): string {
	return `${ sourceId }${ COMPANION_SUFFIX }`;
}

function sourceIdFromCompanion( id: string ): string | null {
	return id.endsWith( COMPANION_SUFFIX )
		? id.slice( 0, -COMPANION_SUFFIX.length )
		: null;
}

function isCompanionWindow( win: EditorSidecarWindowLike ): boolean {
	if ( sourceIdFromCompanion( win.id ) ) {
		return true;
	}
	try {
		const current = win.getCurrentUrl?.() || win.config.url || '';
		return (
			new URL( current, window.location.origin ).searchParams.get(
				COMPANION_QUERY_KEY,
			) === '1'
		);
	} catch {
		return false;
	}
}

function frameWindow(
	win: EditorSidecarWindowLike,
): GutenbergFrameWindow | null {
	if ( win.config.native || ! win.iframe?.contentWindow ) {
		return null;
	}
	return win.iframe.contentWindow as GutenbergFrameWindow;
}

function isGutenbergEditor( win: EditorSidecarWindowLike ): boolean {
	try {
		const frame = frameWindow( win );
		const select = frame?.wp?.data?.select;
		if ( ! frame || typeof select !== 'function' ) {
			return false;
		}
		return !! (
			select( 'core/editor' ) &&
			( select( 'core/interface' ) || select( 'core/edit-post' ) ) &&
			frame.document.querySelector( '.interface-interface-skeleton' )
		);
	} catch {
		return false;
	}
}

function activeArea( win: EditorSidecarWindowLike ): string | null {
	try {
		const select = frameWindow( win )?.wp?.data?.select;
		if ( typeof select !== 'function' ) {
			return null;
		}
		const modern = select( 'core/interface' );
		if ( typeof modern?.getActiveComplementaryArea === 'function' ) {
			return modern.getActiveComplementaryArea( 'core' ) ?? null;
		}
		const legacy = select( 'core/edit-post' );
		if ( typeof legacy?.getActiveGeneralSidebarName === 'function' ) {
			return legacy.getActiveGeneralSidebarName() ?? null;
		}
	} catch {
		/* Navigation race — the companion will fall back to Post settings. */
	}
	return null;
}

function postMessageTo(
	win: EditorSidecarWindowLike,
	data: Record< string, unknown >,
): boolean {
	const target = win.iframe?.contentWindow;
	if ( ! target ) {
		return false;
	}
	try {
		target.postMessage( data, window.location.origin );
		return true;
	} catch {
		return false;
	}
}

function parkSource( win: EditorSidecarWindowLike, parked: boolean ): boolean {
	return postMessageTo( win, {
		type: 'os-editor-sidecar-source',
		parked,
	} );
}

function activateCompanion(
	win: EditorSidecarWindowLike,
	area: string | null,
): boolean {
	return postMessageTo( win, {
		type: 'os-editor-sidecar-set',
		active: true,
		detached: true,
		area,
	} );
}

function companionUrl( source: EditorSidecarWindowLike ): string {
	const current = source.getCurrentUrl?.() || source.config.url || '';
	const url = new URL( current, window.location.origin );
	url.searchParams.set( COMPANION_QUERY_KEY, '1' );
	return url.toString();
}

function arrangeSource(
	source: EditorSidecarWindowLike,
	layouts: Map< string, SourceLayout >,
): void {
	if ( ! source.applySnap || source.state === 'fullscreen' ) {
		return;
	}
	const state = source.state ?? 'normal';
	if ( ! layouts.has( source.id ) ) {
		layouts.set( source.id, { state } );
	}
	if ( state === 'normal' && ! source._savedGeometry && source.element ) {
		source._savedGeometry = {
			x: source.element.offsetLeft,
			y: source.element.offsetTop,
			width: source.element.offsetWidth,
			height: source.element.offsetHeight,
		};
	}
	source.applySnap( 'left' );
}

function restoreSourceLayout(
	source: EditorSidecarWindowLike,
	layouts: Map< string, SourceLayout >,
): void {
	const saved = layouts.get( source.id );
	layouts.delete( source.id );
	if ( ! saved || source.state !== 'snapped-left' ) {
		return;
	}
	if ( saved.state === 'snapped-left' ) {
		return;
	}
	if ( saved.state === 'snapped-right' ) {
		source.applySnap?.( 'right' );
		return;
	}
	if ( saved.state === 'maximized' ) {
		source.maximize?.();
		return;
	}
	if ( saved.state === 'normal' && source.toggleMaximize ) {
		source.toggleMaximize();
		source.toggleMaximize();
	}
}

export function bootEditorSidecar( {
	manager,
}: {
	manager: EditorSidecarManager;
} ): void {
	const readinessProbes = new Map< string, number >();
	const openingSources = new Set< string >();
	const areaBySource = new Map< string, string | null >();
	const sourceLayouts = new Map< string, SourceLayout >();

	const deactivate = ( sourceId: string ): void => {
		const wasActive = store.state.activeEditors.delete( sourceId );
		if ( wasActive ) {
			persistEditors();
		}
		areaBySource.delete( sourceId );
		const source = manager.getById( sourceId );
		if ( source ) {
			parkSource( source, false );
			restoreSourceLayout( source, sourceLayouts );
			source.renderCustomTitleBarButtons?.();
		} else {
			sourceLayouts.delete( sourceId );
		}
	};

	const requestCompanionClose = ( sourceId: string ): void => {
		const companion = manager.getById( companionId( sourceId ) );
		if ( companion?.close ) {
			// Keep the source parked and the toggle active until Window.close()
			// clears its before-unload guard and invokes the companion onClose.
			companion.close();
			return;
		}
		// The companion may still be inside manager.open(). Mark the desired
		// state inactive; the resolving open path destroys the stale result.
		deactivate( sourceId );
	};

	const openCompanion = async (
		source: EditorSidecarWindowLike,
		makeRoom: boolean,
	): Promise< void > => {
		if ( openingSources.has( source.id ) ) {
			areaBySource.set( source.id, activeArea( source ) );
			store.state.activeEditors.add( source.id );
			persistEditors();
			parkSource( source, true );
			if ( makeRoom ) {
				arrangeSource( source, sourceLayouts );
			}
			source.renderCustomTitleBarButtons?.();
			return;
		}
		openingSources.add( source.id );
		const area = activeArea( source );
		areaBySource.set( source.id, area );
		store.state.activeEditors.add( source.id );
		persistEditors();
		parkSource( source, true );
		if ( makeRoom ) {
			arrangeSource( source, sourceLayouts );
		}
		source.renderCustomTitleBarButtons?.();

		const id = companionId( source.id );
		try {
			const companion = await manager.open( {
				id,
				baseId: id,
				url: companionUrl( source ),
				title: __( 'Sidebar Window' ),
				icon: 'dashicons-columns',
				width: 420,
				height: 720,
				minWidth: 280,
				minHeight: 320,
				initialState: 'snapped-right',
				ephemeral: true,
				multi: false,
				ownerHandle: 'desktop-mode/editor-sidecar',
				desktopId: source.config.desktopId,
				onClose: () => {
					deactivate( source.id );
				},
			} );
			if ( ! store.state.activeEditors.has( source.id ) ) {
				if ( companion.destroy ) {
					companion.destroy();
				} else {
					companion.close?.();
				}
			}
		} catch {
			deactivate( source.id );
		} finally {
			openingSources.delete( source.id );
		}
	};

	const handleReadyWindow = ( win: EditorSidecarWindowLike ): void => {
		const sourceId = sourceIdFromCompanion( win.id );
		if ( sourceId ) {
			if ( ! store.state.activeEditors.has( sourceId ) ) {
				win.close?.();
				return;
			}
			activateCompanion( win, areaBySource.get( sourceId ) ?? null );
			return;
		}
		if ( store.state.activeEditors.has( win.id ) ) {
			void openCompanion( win, false );
			return;
		}
		win.renderCustomTitleBarButtons?.();
	};

	const probeGutenbergReadiness = (
		windowId: string,
		attempt = 0,
	): void => {
		const win = manager.getById( windowId );
		if ( ! win ) {
			readinessProbes.delete( windowId );
			return;
		}
		if ( isGutenbergEditor( win ) ) {
			readinessProbes.delete( windowId );
			handleReadyWindow( win );
			return;
		}
		if ( attempt >= GUTENBERG_PROBE_ATTEMPTS ) {
			readinessProbes.delete( windowId );
			const sourceId = sourceIdFromCompanion( windowId );
			if ( sourceId ) {
				requestCompanionClose( sourceId );
			} else if ( store.state.activeEditors.has( windowId ) ) {
				deactivate( windowId );
			}
			return;
		}
		const timer = window.setTimeout( () => {
			readinessProbes.delete( windowId );
			probeGutenbergReadiness( windowId, attempt + 1 );
		}, GUTENBERG_PROBE_INTERVAL_MS );
		readinessProbes.set( windowId, timer );
	};

	registerTitleBarButton( {
		id: 'desktop-mode/editor-sidecar',
		label: __( 'Sidebar Window' ),
		icon: 'dashicons-columns',
		placement: 'right',
		order: 54,
		match: ( win ) => ! isCompanionWindow( win ) && isGutenbergEditor( win ),
		render: ( host, win ) => {
			const active = store.state.activeEditors.has( win.id );
			host.setAttribute( 'aria-pressed', String( active ) );
			host.addEventListener( 'click', ( event: Event ) => {
				event.stopPropagation();
				if ( store.state.activeEditors.has( win.id ) ) {
					requestCompanionClose( win.id );
				} else {
					void openCompanion( win, true );
				}
			} );
		},
	} );

	addAction(
		HOOKS.IFRAME_READY,
		'desktop-mode/editor-sidecar',
		( event: { windowId?: string } ) => {
			if ( ! event?.windowId ) {
				return;
			}
			const win = manager.getById( event.windowId );
			if ( ! win ) {
				return;
			}
			const existingProbe = readinessProbes.get( win.id );
			if ( existingProbe !== undefined ) {
				window.clearTimeout( existingProbe );
				readinessProbes.delete( win.id );
			}
			if ( isGutenbergEditor( win ) ) {
				handleReadyWindow( win );
				return;
			}
			if ( ! isCompanionWindow( win ) ) {
				win.renderCustomTitleBarButtons?.();
			}
			const timer = window.setTimeout( () => {
				readinessProbes.delete( win.id );
				probeGutenbergReadiness( win.id, 1 );
			}, GUTENBERG_PROBE_INTERVAL_MS );
			readinessProbes.set( win.id, timer );
		},
	);

	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/editor-sidecar-window-closed',
		( event: { windowId?: string } ) => {
			if ( ! event?.windowId ) {
				return;
			}
			const sourceId = sourceIdFromCompanion( event.windowId );
			if ( sourceId ) {
				if ( store.state.activeEditors.has( sourceId ) ) {
					deactivate( sourceId );
				}
				return;
			}
			if ( store.state.activeEditors.has( event.windowId ) ) {
				const id = companionId( event.windowId );
				const companion = manager.getById( id );
				if ( companion ) {
					if ( companion.destroy ) {
						companion.destroy();
					} else {
						companion.close?.();
					}
				}
				deactivate( event.windowId );
			}
		},
	);

	window.addEventListener( 'message', ( event: MessageEvent ) => {
		if ( event.origin !== window.location.origin ) {
			return;
		}
		const data = event.data as
			| { type?: unknown; active?: unknown; available?: unknown }
			| null;
		if (
			! data ||
			data.type !== 'os-editor-sidecar-state' ||
			typeof data.active !== 'boolean'
		) {
			return;
		}
		for ( const sourceId of store.state.activeEditors ) {
			const companion = manager.getById( companionId( sourceId ) );
			if ( companion?.iframe?.contentWindow !== event.source ) {
				continue;
			}
			if ( ! data.active || data.available === false ) {
				requestCompanionClose( sourceId );
			}
			break;
		}
	} );
}

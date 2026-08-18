/**
 * OpenStation — Gutenberg Sidebar Window.
 *
 * The editor and its sidebar are presented as two real OpenStation
 * windows. A narrow, transient iframe-backed companion attaches to
 * the source editor's inline end and opens the same post URL.
 * The companion's iframe is reduced to Gutenberg's complementary area,
 * so Post, Block, and plugin-owned sidebars get normal Gutenberg runtime
 * behavior while living outside the source window's bounds.
 *
 * A separate editor document is the unavoidable boundary for a truly
 * independent shell window: an iframe cannot paint outside its own box,
 * and adopting plugin-owned React DOM into the shell would sever React
 * context and delegated events. Both complementary areas stay available;
 * the companion is ephemeral so only the source participates in session
 * restore.
 */

import { addAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { createSharedStore } from '../shared-store';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import '../ui/components/os-context-menu/os-context-menu';
import '../ui/components/os-select/os-select';
import '../ui/components/os-window-button/os-window-button';

const ACTIVE_STORAGE_KEY = 'openstation.editorSidecar.activeWindows';
const MAX_PERSISTED_IDS = 64;
const GUTENBERG_PROBE_INTERVAL_MS = 250;
const GUTENBERG_PROBE_ATTEMPTS = 40;
const COMPANION_SUFFIX = '--sidebar-window';
const COMPANION_QUERY_KEY = 'openstation_sidebar_window';
const AUTO_OPEN_QUERY_KEY = 'openstation_sidebar_window_auto';
const COMPANION_WIDTH_STORAGE_KEY = 'openstation.editorSidecar.width';
const DEFAULT_COMPANION_WIDTH = 320;
const MIN_COMPANION_WIDTH = 280;
const MAX_COMPANION_WIDTH = 520;
const SIDEBAR_AREA_PATTERN = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_./-]*$/i;

interface SidebarChoice {
	area: string;
	label: string;
}

interface SidebarPanelSelect extends HTMLElement {
	items: ReadonlyArray< { value: string; label: string } >;
	value: string;
}

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
		minWidth?: number;
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
	close?: () => void;
	destroy?: () => void;
	getCurrentUrl?: () => string;
	renderCustomTitleBarButtons?: () => void;
	onDragMove?: unknown;
	onDragEnd?: unknown;
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
	x: number;
	y: number;
	initialState: 'normal';
	ephemeral: true;
	multi: false;
	ownerHandle: string;
	desktopId?: string;
	appearance: {
		controls: { hide: string[] };
		slots: {
			'after-titlebar': {
				replace: true;
				render: ( host: HTMLElement ) => void;
			};
		};
	};
	onClose: () => void;
}

interface EditorSidecarManager {
	getById: ( id: string ) => EditorSidecarWindowLike | null | undefined;
	open: ( config: CompanionWindowConfig ) => Promise< EditorSidecarWindowLike >;
	raise?: ( id: string ) => void;
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
	location?: Location;
	history?: History;
}

interface EditorSidecarState {
	activeEditors: Set< string >;
}

interface SourceGeometry {
	x: number;
	y: number;
	width: number;
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

function humanizeSidebarArea( area: string ): string {
	const name = area.split( '/' ).pop() || area;
	return name
		.replace( /[-_.]+/g, ' ' )
		.replace( /\b\w/g, ( character ) => character.toUpperCase() );
}

/**
 * Gutenberg does not expose a public selector that enumerates registered
 * complementary areas. Its own area toggles do expose the identifier through
 * `aria-controls`, so read those controls and keep the store selector for the
 * currently active area. This supports arbitrary PluginSidebar registrations
 * without teaching OpenStation plugin-specific identifiers.
 */
function sidebarChoices( win: EditorSidecarWindowLike ): SidebarChoice[] {
	const choices = new Map< string, string >( [
		[ 'edit-post/document', __( 'Post settings' ) ],
		[ 'edit-post/block', __( 'Block settings' ) ],
	] );
	try {
		const frame = frameWindow( win );
		const controls =
			frame?.document.querySelectorAll< HTMLElement >( '[aria-controls]' );
		for ( const control of controls ?? [] ) {
			const controlled = control.getAttribute( 'aria-controls' ) ?? '';
			const area = controlled.replace( ':', '/' );
			if ( ! SIDEBAR_AREA_PATTERN.test( area ) ) {
				continue;
			}
			const label =
				control.getAttribute( 'aria-label' )?.trim() ||
				control.getAttribute( 'title' )?.trim() ||
				control.textContent?.trim() ||
				humanizeSidebarArea( area );
			if ( ! choices.has( area ) ) {
				choices.set( area, label );
			}
		}
	} catch {
		/* The editor may be between same-origin navigations. */
	}
	const current = activeArea( win );
	if ( current && SIDEBAR_AREA_PATTERN.test( current ) && ! choices.has( current ) ) {
		choices.set( current, humanizeSidebarArea( current ) );
	}
	return Array.from( choices, ( [ area, label ] ) => ( { area, label } ) );
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
	url.searchParams.delete( AUTO_OPEN_QUERY_KEY );
	url.searchParams.set( COMPANION_QUERY_KEY, '1' );
	return url.toString();
}

/**
 * One-shot demo/startup affordance. The query flag is consumed from both
 * the manager's configured URL and the live iframe history before opening,
 * so a later iframe reload does not keep forcing a companion back open.
 */
function consumeAutoOpen( source: EditorSidecarWindowLike ): boolean {
	if ( isCompanionWindow( source ) ) {
		return false;
	}
	try {
		const live = source.getCurrentUrl?.() || '';
		const configured = source.config.url || '';
		const flagged = [ configured, live ]
			.filter( Boolean )
			.map( ( candidate ) => new URL( candidate, window.location.origin ) )
			.find(
				( candidate ) =>
					candidate.searchParams.get( AUTO_OPEN_QUERY_KEY ) === '1',
			);
		if ( ! flagged ) {
			return false;
		}
		const configuredUrl = new URL(
			configured || live || flagged.toString(),
			window.location.origin,
		);
		configuredUrl.searchParams.delete( AUTO_OPEN_QUERY_KEY );
		source.config.url = configuredUrl.toString();
		const frame = frameWindow( source );
		if ( frame?.history ) {
			try {
				const liveUrl = new URL(
					live || flagged.toString(),
					window.location.origin,
				);
				liveUrl.searchParams.delete( AUTO_OPEN_QUERY_KEY );
				frame.history.replaceState(
					frame.history.state,
					'',
					`${ liveUrl.pathname }${ liveUrl.search }${ liveUrl.hash }`,
				);
			} catch {
				/* Navigation may have crossed a same-origin document boundary. */
			}
		}
		return true;
	} catch {
		return false;
	}
}

function clampCompanionWidth( width: number ): number {
	return Math.max(
		MIN_COMPANION_WIDTH,
		Math.min( MAX_COMPANION_WIDTH, Math.round( width ) ),
	);
}

function fallbackCompanionWidth(): number {
	try {
		const stored = Number.parseFloat(
			window.localStorage.getItem( COMPANION_WIDTH_STORAGE_KEY ) ?? '',
		);
		if (
			Number.isFinite( stored ) &&
			stored >= MIN_COMPANION_WIDTH &&
			stored <= MAX_COMPANION_WIDTH
		) {
			return clampCompanionWidth( stored );
		}
	} catch {
		/* localStorage may be blocked. */
	}
	return DEFAULT_COMPANION_WIDTH;
}

function resolveCompanionWidth( source: EditorSidecarWindowLike ): number {
	try {
		const sidebar = frameWindow( source )?.document.querySelector(
			'.interface-interface-skeleton__sidebar',
		);
		const measured = sidebar?.getBoundingClientRect().width ?? 0;
		if ( measured >= MIN_COMPANION_WIDTH && measured <= MAX_COMPANION_WIDTH ) {
			return clampCompanionWidth( measured );
		}
	} catch {
		/* The source may be between same-origin navigations. */
	}
	// Gutenberg's mobile sidebar is a 100vw overlay. Treat that as a
	// breakpoint sentinel rather than turning the companion into a 520px panel.
	return fallbackCompanionWidth();
}

function companionGeometry(
	source: EditorSidecarWindowLike,
	width: number,
	fit = false,
): { x: number; y: number; width: number; height: number } | null {
	const element = source.element;
	if ( ! element ) {
		return { x: 40, y: 40, width, height: 720 };
	}
	if ( source.state && source.state !== 'normal' ) {
		return null;
	}
	const desktop = element.parentElement;
	let sourceX = element.offsetLeft;
	let sourceY = element.offsetTop;
	let sourceWidth = element.offsetWidth;
	const sourceHeight = element.offsetHeight;
	const rtl = window.getComputedStyle( element ).direction === 'rtl';
	if ( fit && desktop?.clientWidth ) {
		const sourceMinWidth = Math.max( 320, source.config.minWidth ?? 320 );
		if ( desktop.clientWidth < sourceMinWidth + width ) {
			return null;
		}
		sourceWidth = Math.min( sourceWidth, desktop.clientWidth - width );
		const minSourceX = rtl ? width : 0;
		const maxSourceX = rtl
			? desktop.clientWidth - sourceWidth
			: desktop.clientWidth - sourceWidth - width;
		sourceX = Math.max( minSourceX, Math.min( sourceX, maxSourceX ) );
		if ( desktop.clientHeight ) {
			sourceY = Math.max(
				0,
				Math.min( sourceY, desktop.clientHeight - sourceHeight ),
			);
		}
		element.style.left = `${ sourceX }px`;
		element.style.top = `${ sourceY }px`;
		element.style.width = `${ sourceWidth }px`;
	}
	return {
		x: rtl ? sourceX - width : sourceX + sourceWidth,
		y: sourceY,
		width,
		height: sourceHeight,
	};
}

export function bootEditorSidecar( {
	manager,
}: {
	manager: EditorSidecarManager;
} ): void {
	const readinessProbes = new Map< string, number >();
	const openingSources = new Set< string >();
	const areaBySource = new Map< string, string | null >();
	const companionWidths = new Map< string, number >();
	const sourceGeometries = new Map< string, SourceGeometry >();
	const sidebarChoicesBySource = new Map<
		string,
		Map< string, string >
	>();
	const sidebarChoiceObservers = new Map< string, MutationObserver >();
	let choiceMenu: HTMLElement | null = null;
	let choiceMenuHost: HTMLElement | null = null;
	const closeChoiceMenu = (): void => {
		choiceMenu?.remove();
		choiceMenu = null;
		choiceMenuHost?.setAttribute( 'aria-expanded', 'false' );
		choiceMenuHost = null;
		document.removeEventListener( 'mousedown', onChoiceMenuPointerDown, true );
		document.removeEventListener( 'keydown', onChoiceMenuKeyDown, true );
	};
	const onChoiceMenuPointerDown = ( event: MouseEvent ): void => {
		if (
			choiceMenu &&
			event.target instanceof Node &&
			! choiceMenu.contains( event.target ) &&
			! choiceMenuHost?.contains( event.target )
		) {
			closeChoiceMenu();
		}
	};
	const onChoiceMenuKeyDown = ( event: KeyboardEvent ): void => {
		if ( event.key === 'Escape' ) {
			const returnFocus = choiceMenuHost;
			closeChoiceMenu();
			returnFocus?.focus();
		}
	};
	const sourceSnapHandlers = new Map<
		string,
		{ onDragMove: unknown; onDragEnd: unknown }
	>();
	const pairObservers = new Map< string, ResizeObserver >();
	const rememberSourceGeometry = ( source: EditorSidecarWindowLike ): void => {
		if ( source.element && ! sourceGeometries.has( source.id ) ) {
			sourceGeometries.set( source.id, {
				x: source.element.offsetLeft,
				y: source.element.offsetTop,
				width: source.element.offsetWidth,
			} );
		}
	};

	function availableSidebarChoices(
		source: EditorSidecarWindowLike,
	): SidebarChoice[] {
		let remembered = sidebarChoicesBySource.get( source.id );
		if ( ! remembered ) {
			remembered = new Map();
			sidebarChoicesBySource.set( source.id, remembered );
		}
		for ( const choice of sidebarChoices( source ) ) {
			remembered.set( choice.area, choice.label );
		}
		return Array.from( remembered, ( [ area, label ] ) => ( { area, label } ) );
	}

	function startSidebarChoiceObserver(
		source: EditorSidecarWindowLike,
	): void {
		sidebarChoiceObservers.get( source.id )?.disconnect();
		sidebarChoiceObservers.delete( source.id );
		const root = frameWindow( source )?.document.documentElement;
		if ( ! root || typeof MutationObserver === 'undefined' ) {
			return;
		}
		const observer = new MutationObserver( ( records ) => {
			const addedControl = records.some( ( record ) => {
				if ( record.type === 'attributes' ) {
					return true;
				}
				return Array.from( record.addedNodes ).some(
					( node ) => {
						if ( node.nodeType !== 1 ) {
							return false;
						}
						const element = node as Element;
						return (
							element.hasAttribute( 'aria-controls' ) ||
							!! element.querySelector( '[aria-controls]' )
						);
					},
				);
			} );
			if ( addedControl ) {
				syncCompanionPanelSelector( source.id );
			}
		} );
		observer.observe( root, {
			attributes: true,
			attributeFilter: [ 'aria-controls', 'aria-label', 'title' ],
			childList: true,
			subtree: true,
		} );
		sidebarChoiceObservers.set( source.id, observer );
	}

	const suspendSourceSnapping = ( source: EditorSidecarWindowLike ): void => {
		if ( sourceSnapHandlers.has( source.id ) ) {
			return;
		}
		sourceSnapHandlers.set( source.id, {
			onDragMove: source.onDragMove,
			onDragEnd: source.onDragEnd,
		} );
		source.onDragMove = undefined;
		source.onDragEnd = undefined;
	};

	const syncCompanionToSource = ( sourceId: string ): void => {
		const source = manager.getById( sourceId );
		const companion = manager.getById( companionId( sourceId ) );
		if ( ! source?.element || ! companion?.element ) {
			return;
		}
		const width =
			companionWidths.get( sourceId ) ?? resolveCompanionWidth( source );
		companionWidths.set( sourceId, width );
		const geometry = companionGeometry( source, width );
		if ( ! geometry ) {
			return;
		}
		companion.element.style.left = `${ geometry.x }px`;
		companion.element.style.top = `${ geometry.y }px`;
		companion.element.style.width = `${ geometry.width }px`;
		companion.element.style.height = `${ geometry.height }px`;
		source.element.classList.add( 'os-window--editor-sidecar-source' );
		companion.element.classList.add( 'os-window--editor-sidecar-companion' );
	};

	const movePairFromCompanion = (
		sourceId: string,
		x: number,
		y: number,
	): void => {
		const source = manager.getById( sourceId );
		const companion = manager.getById( companionId( sourceId ) );
		if ( ! source?.element || ! companion?.element ) {
			return;
		}
		const width = companionWidths.get( sourceId ) ?? companion.element.offsetWidth;
		const rtl = window.getComputedStyle( source.element ).direction === 'rtl';
		source.element.style.left = `${
			rtl ? x + width : x - source.element.offsetWidth
		}px`;
		source.element.style.top = `${ y }px`;
		companion.element.style.width = `${ width }px`;
		companion.element.style.height = `${ source.element.offsetHeight }px`;
	};

	const setPairReflowing = ( windowId: string, reflowing: boolean ): void => {
		const sourceId = sourceIdFromCompanion( windowId ) ?? windowId;
		if ( ! store.state.activeEditors.has( sourceId ) ) {
			return;
		}
		const source = manager.getById( sourceId );
		const companion = manager.getById( companionId( sourceId ) );
		for ( const member of [ source, companion ] ) {
			member?.element?.classList.toggle( 'os-window--reflowing', reflowing );
		}
	};

	const fitPairToDesktop = ( sourceId: string ): boolean => {
		const source = manager.getById( sourceId );
		if ( ! source?.element ) {
			return false;
		}
		const width =
			companionWidths.get( sourceId ) ?? resolveCompanionWidth( source );
		const geometry = companionGeometry( source, width, true );
		if ( ! geometry ) {
			return false;
		}
		const companion = manager.getById( companionId( sourceId ) );
		if ( companion?.element ) {
			companion.element.style.left = `${ geometry.x }px`;
			companion.element.style.top = `${ geometry.y }px`;
			companion.element.style.width = `${ geometry.width }px`;
			companion.element.style.height = `${ geometry.height }px`;
			source.element.classList.add( 'os-window--editor-sidecar-source' );
			companion.element.classList.add(
				'os-window--editor-sidecar-companion',
			);
		}
		return true;
	};

	const deactivate = ( sourceId: string ): void => {
		const wasActive = store.state.activeEditors.delete( sourceId );
		if ( wasActive ) {
			persistEditors();
		}
		areaBySource.delete( sourceId );
		companionWidths.delete( sourceId );
		sidebarChoicesBySource.delete( sourceId );
		sidebarChoiceObservers.get( sourceId )?.disconnect();
		sidebarChoiceObservers.delete( sourceId );
		pairObservers.get( sourceId )?.disconnect();
		pairObservers.delete( sourceId );
		const source = manager.getById( sourceId );
		const companion = manager.getById( companionId( sourceId ) );
		companion?.element?.classList.remove(
			'os-window--editor-sidecar-companion',
			'os-window--editor-sidecar-pair-focused',
			'os-window--reflowing',
		);
		if ( source ) {
			const saved = sourceGeometries.get( sourceId );
			if ( saved && source.element ) {
				const desktop = source.element.parentElement;
				const width = desktop?.clientWidth
					? Math.min( saved.width, desktop.clientWidth )
					: saved.width;
				const x = desktop?.clientWidth
					? Math.max( 0, Math.min( saved.x, desktop.clientWidth - width ) )
					: saved.x;
				const y = desktop?.clientHeight
					? Math.max(
						0,
						Math.min(
							saved.y,
							desktop.clientHeight - source.element.offsetHeight,
						),
					)
					: saved.y;
				source.element.style.left = `${ x }px`;
				source.element.style.top = `${ y }px`;
				source.element.style.width = `${ width }px`;
			}
			source.element?.classList.remove(
				'os-window--editor-sidecar-source',
				'os-window--editor-sidecar-pair-focused',
				'os-window--reflowing',
			);
			const handlers = sourceSnapHandlers.get( sourceId );
			if ( handlers ) {
				source.onDragMove = handlers.onDragMove;
				source.onDragEnd = handlers.onDragEnd;
			}
			source.renderCustomTitleBarButtons?.();
		}
		sourceGeometries.delete( sourceId );
		sourceSnapHandlers.delete( sourceId );
	};

	const requestCompanionClose = ( sourceId: string ): void => {
		const companion = manager.getById( companionId( sourceId ) );
		if ( companion?.close ) {
			// Keep the toggle active until Window.close() clears its
			// before-unload guard and invokes the companion onClose.
			companion.close();
			return;
		}
		// The companion may still be inside manager.open(). Mark the desired
		// state inactive; the resolving open path destroys the stale result.
		deactivate( sourceId );
	};

	const openCompanion = async (
		source: EditorSidecarWindowLike,
		preferredArea?: string | null,
	): Promise< void > => {
		const selectedArea =
			preferredArea === undefined ? activeArea( source ) : preferredArea;
		if ( openingSources.has( source.id ) ) {
			rememberSourceGeometry( source );
			areaBySource.set( source.id, selectedArea );
			store.state.activeEditors.add( source.id );
			persistEditors();
			suspendSourceSnapping( source );
			startSidebarChoiceObserver( source );
			source.element?.classList.add( 'os-window--editor-sidecar-source' );
			source.renderCustomTitleBarButtons?.();
			return;
		}
		openingSources.add( source.id );
		const area = selectedArea;
		areaBySource.set( source.id, area );
		store.state.activeEditors.add( source.id );
		persistEditors();
		suspendSourceSnapping( source );
		startSidebarChoiceObserver( source );
		source.element?.classList.add( 'os-window--editor-sidecar-source' );
		source.renderCustomTitleBarButtons?.();

		const width = resolveCompanionWidth( source );
		companionWidths.set( source.id, width );
		rememberSourceGeometry( source );
		const geometry = companionGeometry( source, width, true );
		if ( ! geometry ) {
			deactivate( source.id );
			openingSources.delete( source.id );
			return;
		}
		const id = companionId( source.id );
		try {
			const companion = await manager.open( {
				id,
				baseId: id,
				url: companionUrl( source ),
				title: __( 'Sidebar Window' ),
				icon: 'dashicons-columns',
				width: geometry.width,
				height: geometry.height,
				x: geometry.x,
				y: geometry.y,
				minWidth: geometry.width,
				minHeight: Math.min( 320, geometry.height ),
				initialState: 'normal',
				ephemeral: true,
				multi: false,
				ownerHandle: 'desktop-mode/editor-sidecar',
				desktopId: source.config.desktopId,
				appearance: {
					controls: {
						hide: [
							'core/minimize',
							'core/maximize',
							'core/focus-tab',
							'core/detach',
						],
					},
					slots: {
						'after-titlebar': {
							replace: true,
							render: ( host ) => {
								mountCompanionPanelSelector( source, host );
							},
						},
					},
				},
				onClose: () => {
					deactivate( source.id );
				},
			} );
			// Keep the narrow companion attached: edge snapping and title-bar
			// double-click maximize would otherwise turn it into a half/full
			// desktop window despite the fixed pairing geometry.
			companion.onDragMove = undefined;
			companion.onDragEnd = undefined;
			companion.element?.addEventListener(
				'dblclick',
				( event ) => {
					event.preventDefault();
					event.stopImmediatePropagation();
				},
				{ capture: true },
			);
			if ( ! store.state.activeEditors.has( source.id ) ) {
				if ( companion.destroy ) {
					companion.destroy();
				} else {
					companion.close?.();
				}
			} else {
				if ( ! fitPairToDesktop( source.id ) ) {
					requestCompanionClose( source.id );
					return;
				}
				if (
					typeof ResizeObserver !== 'undefined' &&
					source.element?.parentElement &&
					! pairObservers.has( source.id )
				) {
					const observer = new ResizeObserver( () => {
						if ( ! store.state.activeEditors.has( source.id ) ) {
							return;
						}
						if ( ! fitPairToDesktop( source.id ) ) {
							requestCompanionClose( source.id );
						}
					} );
					observer.observe( source.element.parentElement );
					pairObservers.set( source.id, observer );
				}
			}
		} catch {
			deactivate( source.id );
		} finally {
			openingSources.delete( source.id );
		}
	};

	const chooseSidebarArea = (
		source: EditorSidecarWindowLike,
		area: string,
	): void => {
		areaBySource.set( source.id, area );
		syncCompanionPanelSelector( source.id );
		if ( ! store.state.activeEditors.has( source.id ) ) {
			void openCompanion( source, area );
			return;
		}
		const companion = manager.getById( companionId( source.id ) );
		if ( companion ) {
			activateCompanion( companion, area );
		} else {
			// manager.open() may still be resolving. Its ready path reads the
			// latest value from areaBySource, so no second window is needed.
			void openCompanion( source, area );
		}
	};

	function selectedSidebarArea( sourceId: string ): string {
		const selected = areaBySource.get( sourceId );
		if ( selected && SIDEBAR_AREA_PATTERN.test( selected ) ) {
			return selected;
		}
		const companion = manager.getById( companionId( sourceId ) );
		const liveArea = companion ? activeArea( companion ) : null;
		return liveArea && SIDEBAR_AREA_PATTERN.test( liveArea )
			? liveArea
			: 'edit-post/document';
	}

	function syncCompanionPanelSelector( sourceId: string ): void {
		const source = manager.getById( sourceId );
		const companion = manager.getById( companionId( sourceId ) );
		const select = companion?.element?.querySelector< SidebarPanelSelect >(
			'os-select.os-editor-sidecar-panel-select',
		);
		if ( ! source || ! select ) {
			return;
		}
		const items = availableSidebarChoices( source ).map( ( choice ) => ( {
			value: choice.area,
			label: choice.label,
		} ) );
		const currentItems = Array.from(
			select.querySelectorAll< HTMLElement >( ':scope > os-option' ),
		).map( ( option ) => ( {
			value: option.getAttribute( 'value' ) ?? '',
			label: option.textContent?.trim() ?? '',
		} ) );
		if ( JSON.stringify( currentItems ) !== JSON.stringify( items ) ) {
			select.items = items;
		}
		const selected = selectedSidebarArea( sourceId );
		if ( select.getAttribute( 'value' ) !== selected ) {
			select.value = selected;
			select.setAttribute( 'value', selected );
		}
	}

	function mountCompanionPanelSelector(
		source: EditorSidecarWindowLike,
		slot: HTMLElement,
	): void {
		let select = slot.querySelector< SidebarPanelSelect >(
			'os-select.os-editor-sidecar-panel-select',
		);
		if ( ! select ) {
			select = document.createElement( 'os-select' ) as SidebarPanelSelect;
			select.classList.add( 'os-editor-sidecar-panel-select' );
			select.setAttribute( 'label', __( 'Sidebar panel' ) );
			select.setAttribute( 'compact', '' );
			select.addEventListener( 'os-pick', ( event: Event ) => {
				const value = ( event as CustomEvent< { value?: string } > ).detail
					?.value;
				if ( value && SIDEBAR_AREA_PATTERN.test( value ) ) {
					chooseSidebarArea( source, value );
				}
			} );
			slot.appendChild( select );
		}
		let close = slot.querySelector< HTMLElement >(
			'os-window-button.os-editor-sidecar-panel-close',
		);
		if ( ! close ) {
			close = document.createElement( 'os-window-button' );
			close.classList.add(
				'os-window__btn',
				'os-editor-sidecar-panel-close',
			);
			close.setAttribute( 'icon', 'close' );
			close.setAttribute( 'danger', '' );
			close.setAttribute( 'aria-label', __( 'Close Sidebar Window' ) );
			close.addEventListener( 'click', ( event ) => {
				event.stopPropagation();
				requestCompanionClose( source.id );
			} );
			slot.appendChild( close );
		}
		syncCompanionPanelSelector( source.id );
	}

	const openChoiceMenu = (
		host: HTMLElement,
		source: EditorSidecarWindowLike,
	): void => {
		if ( choiceMenu && choiceMenuHost === host ) {
			closeChoiceMenu();
			return;
		}
		closeChoiceMenu();
		const menu = document.createElement( 'os-context-menu' );
		menu.setAttribute( 'open', '' );
		menu.setAttribute( 'aria-label', __( 'Choose a sidebar' ) );
		menu.classList.add( 'os-editor-sidecar-choice-menu' );
		menu.style.position = 'fixed';
		menu.style.left = '-9999px';
		menu.style.top = '-9999px';
		menu.style.visibility = 'hidden';
		menu.style.zIndex = '1000000';

		const selected =
			areaBySource.get( source.id ) ?? activeArea( source ) ?? 'edit-post/document';
		for ( const choice of availableSidebarChoices( source ) ) {
			const option = document.createElement( 'os-context-menu-option' );
			option.dataset.menuItemId = choice.area;
			option.dataset.sidebarArea = choice.area;
			option.setAttribute( 'value', choice.area );
			option.setAttribute(
				'icon',
				choice.area.startsWith( 'edit-post/' )
					? 'dashicons-admin-generic'
					: 'dashicons-admin-plugins',
			);
			if ( choice.area === selected ) {
				option.setAttribute( 'checked', '' );
			}
			option.textContent = choice.label;
			menu.appendChild( option );
		}

		if ( store.state.activeEditors.has( source.id ) ) {
			const separator = document.createElement( 'hr' );
			separator.style.cssText =
				'border:0;border-top:1px solid var(--os-ui-context-menu-separator-color,rgba(255,255,255,.12));margin:4px 6px';
			menu.appendChild( separator );
			const close = document.createElement( 'os-context-menu-option' );
			close.dataset.menuItemId = 'close';
			close.setAttribute( 'value', 'close' );
			close.setAttribute( 'danger', '' );
			close.setAttribute( 'icon', 'dashicons-no-alt' );
			close.textContent = __( 'Close Sidebar Window' );
			menu.appendChild( close );
		}

		menu.addEventListener( 'os-context-menu-pick', ( event: Event ) => {
			const detail = (
				event as CustomEvent< { id?: string; value?: string } >
			).detail;
			const value = detail?.id || detail?.value || '';
			closeChoiceMenu();
			if ( value === 'close' ) {
				requestCompanionClose( source.id );
			} else if ( SIDEBAR_AREA_PATTERN.test( value ) ) {
				chooseSidebarArea( source, value );
			}
		} );

		document.body.appendChild( menu );
		choiceMenu = menu;
		choiceMenuHost = host;
		host.setAttribute( 'aria-expanded', 'true' );
		document.addEventListener( 'mousedown', onChoiceMenuPointerDown, true );
		document.addEventListener( 'keydown', onChoiceMenuKeyDown, true );
		window.requestAnimationFrame( () => {
			if ( choiceMenu !== menu ) {
				return;
			}
			const anchor = host.getBoundingClientRect();
			const rect = menu.getBoundingClientRect();
			const margin = 8;
			const left = Math.max(
				margin,
				Math.min(
					anchor.right - rect.width,
					window.innerWidth - rect.width - margin,
				),
			);
			const below = anchor.bottom + 6;
			const top =
				below + rect.height <= window.innerHeight - margin
					? below
					: Math.max( margin, anchor.top - rect.height - 6 );
			menu.style.left = `${ Math.round( left ) }px`;
			menu.style.top = `${ Math.round( top ) }px`;
			menu.style.visibility = 'visible';
		} );
	};

	const handleReadyWindow = ( win: EditorSidecarWindowLike ): void => {
		const sourceId = sourceIdFromCompanion( win.id );
		if ( sourceId ) {
			if ( ! store.state.activeEditors.has( sourceId ) ) {
				win.close?.();
				return;
			}
			const source = manager.getById( sourceId );
			const slot = win.element?.querySelector< HTMLElement >(
				'.os-window__slot--after-titlebar',
			);
			if ( source && slot ) {
				mountCompanionPanelSelector( source, slot );
			}
			activateCompanion( win, areaBySource.get( sourceId ) ?? null );
			syncCompanionPanelSelector( sourceId );
			return;
		}
		const autoOpen = consumeAutoOpen( win );
		if ( store.state.activeEditors.has( win.id ) || autoOpen ) {
			void openCompanion( win );
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
			host.setAttribute( 'aria-haspopup', 'menu' );
			host.setAttribute( 'aria-expanded', 'false' );
			host.addEventListener( 'click', ( event: Event ) => {
				event.stopPropagation();
				openChoiceMenu( host, win );
			} );
		},
	} );

	addAction(
		HOOKS.WINDOW_FOCUSED,
		'desktop-mode/editor-sidecar-focus-pair',
		( event: { windowId?: string } ) => {
			if ( ! event?.windowId ) {
				return;
			}
			for ( const activeSourceId of store.state.activeEditors ) {
				manager
					.getById( activeSourceId )
					?.element?.classList.remove(
						'os-window--editor-sidecar-pair-focused',
					);
				manager
					.getById( companionId( activeSourceId ) )
					?.element?.classList.remove(
						'os-window--editor-sidecar-pair-focused',
					);
			}
			const sourceId = sourceIdFromCompanion( event.windowId );
			if ( sourceId && store.state.activeEditors.has( sourceId ) ) {
				manager
					.getById( sourceId )
					?.element?.classList.add(
						'os-window--editor-sidecar-pair-focused',
					);
				manager
					.getById( companionId( sourceId ) )
					?.element?.classList.add(
						'os-window--editor-sidecar-pair-focused',
					);
				manager.raise?.( sourceId );
				return;
			}
			if ( store.state.activeEditors.has( event.windowId ) ) {
				manager
					.getById( event.windowId )
					?.element?.classList.add(
						'os-window--editor-sidecar-pair-focused',
					);
				manager
					.getById( companionId( event.windowId ) )
					?.element?.classList.add(
						'os-window--editor-sidecar-pair-focused',
					);
				manager.raise?.( companionId( event.windowId ) );
			}
		},
	);

	addAction(
		HOOKS.WINDOW_DRAG_START,
		'desktop-mode/editor-sidecar-drag-start',
		( event: { windowId?: string } ) => {
			if ( event?.windowId ) {
				setPairReflowing( event.windowId, true );
			}
		},
	);

	addAction(
		HOOKS.WINDOW_RESIZE_START,
		'desktop-mode/editor-sidecar-resize-start',
		( event: { windowId?: string } ) => {
			if ( event?.windowId ) {
				setPairReflowing( event.windowId, true );
			}
		},
	);

	addAction(
		HOOKS.WINDOW_BOUNDS_CHANGED,
		'desktop-mode/editor-sidecar-bounds',
		( event: {
			windowId?: string;
			x?: number;
			y?: number;
			phase?: 'drag' | 'resize';
		} ) => {
			if ( ! event?.windowId ) {
				return;
			}
			const sourceId = sourceIdFromCompanion( event.windowId );
			if (
				sourceId &&
				event.phase === 'drag' &&
				typeof event.x === 'number' &&
				typeof event.y === 'number'
			) {
				movePairFromCompanion( sourceId, event.x, event.y );
				return;
			}
			if ( store.state.activeEditors.has( event.windowId ) ) {
				syncCompanionToSource( event.windowId );
			}
		},
	);

	const settlePair = ( event: { windowId?: string } ): void => {
		if ( ! event?.windowId ) {
			return;
		}
		const sourceId = sourceIdFromCompanion( event.windowId ) ?? event.windowId;
		if ( store.state.activeEditors.has( sourceId ) ) {
			fitPairToDesktop( sourceId );
		}
		window.requestAnimationFrame( () => {
			setPairReflowing( event.windowId!, false );
		} );
	};

	addAction(
		HOOKS.WINDOW_DRAG_END,
		'desktop-mode/editor-sidecar-drag-end',
		settlePair,
	);

	addAction(
		HOOKS.WINDOW_RESIZE_END,
		'desktop-mode/editor-sidecar-resize-end',
		settlePair,
	);

	const closePairForSourceState = ( event: { windowId?: string } ): void => {
		if (
			event?.windowId &&
			! sourceIdFromCompanion( event.windowId ) &&
			store.state.activeEditors.has( event.windowId )
		) {
			requestCompanionClose( event.windowId );
		}
	};

	addAction(
		HOOKS.WINDOW_MINIMIZED,
		'desktop-mode/editor-sidecar-source-minimized',
		closePairForSourceState,
	);
	addAction(
		HOOKS.WINDOW_MAXIMIZED,
		'desktop-mode/editor-sidecar-source-maximized',
		closePairForSourceState,
	);
	addAction(
		HOOKS.WINDOW_FULLSCREEN_ENTERED,
		'desktop-mode/editor-sidecar-source-fullscreen',
		closePairForSourceState,
	);

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
		const data = event.data as {
			type?: unknown;
			active?: unknown;
			available?: unknown;
			area?: unknown;
		} | null;
		if ( ! data ) {
			return;
		}
		if (
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
			if (
				data.active &&
				typeof data.area === 'string' &&
				SIDEBAR_AREA_PATTERN.test( data.area )
			) {
				const source = manager.getById( sourceId );
				if ( source ) {
					availableSidebarChoices( source );
					const choices = sidebarChoicesBySource.get( sourceId );
					if ( choices && ! choices.has( data.area ) ) {
						choices.set( data.area, humanizeSidebarArea( data.area ) );
					}
				}
				areaBySource.set( sourceId, data.area );
				syncCompanionPanelSelector( sourceId );
			}
			if ( ! data.active || data.available === false ) {
				requestCompanionClose( sourceId );
			}
			break;
		}
	} );
}

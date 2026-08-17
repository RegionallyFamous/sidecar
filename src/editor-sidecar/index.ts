/**
 * OpenStation — Gutenberg Editor Sidecar.
 *
 * Gutenberg's complementary area (Post, Block, and plugin-owned
 * sidebars such as Yoast / Rank Math / ACF) belongs to the editor's
 * React tree. Moving it into a second document would sever React's
 * event delegation; opening a second editor would create competing
 * dirty state and autosaves. The sidecar therefore stays inside the
 * ONE real editor iframe and asks its iframe-side bridge to switch the
 * existing complementary area into a persistent, resizable split.
 *
 * The shell owns only policy and lifecycle:
 *  - a title-bar button appears after Gutenberg has actually booted;
 *  - activating it sends `os-editor-sidecar-set` to that iframe;
 *  - narrow floating/snapped editors maximize once to make useful room;
 *  - active editor ids persist so session-restored windows re-apply the
 *    split after their iframe announces readiness.
 *
 * The iframe-side DOM/CSS work lives in
 * `installEditorSidecarHandler()` and `assets/css/chromeless.css`.
 */

import { addAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { createSharedStore } from '../shared-store';
import { registerTitleBarButton } from '../title-bar-buttons/registry';

/** Persisted per-post window ids; capped defensively on write. */
const ACTIVE_STORAGE_KEY = 'openstation.editorSidecar.activeWindows';
const MAX_PERSISTED_IDS = 64;
const GUTENBERG_PROBE_INTERVAL_MS = 250;
const GUTENBERG_PROBE_ATTEMPTS = 40;

interface EditorSidecarWindowLike {
	id: string;
	config: { native?: boolean };
	iframe?: HTMLIFrameElement | null;
	element?: HTMLElement;
	maximize?: () => void;
	renderCustomTitleBarButtons?: () => void;
}

interface EditorSidecarManager {
	getById: ( id: string ) => EditorSidecarWindowLike | null | undefined;
}

interface GutenbergDataApi {
	select?: ( store: string ) => Record< string, unknown > | undefined;
}

interface GutenbergFrameWindow {
	wp?: { data?: GutenbergDataApi };
	document: Document;
}

interface EditorSidecarState {
	activeEditors: Set< string >;
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

/**
 * Gutenberg capability probe against the same-origin child realm.
 * Looking for BOTH the editor store and a complementary-area store
 * avoids painting the button on Classic Editor and on non-editor admin
 * pages that happen to enqueue one of the packages.
 */
function isGutenbergEditor( win: EditorSidecarWindowLike ): boolean {
	if ( win.config.native || ! win.iframe?.contentWindow ) {
		return false;
	}
	try {
		const frame = win.iframe.contentWindow as GutenbergFrameWindow;
		const select = frame.wp?.data?.select;
		if ( typeof select !== 'function' ) {
			return false;
		}
		const editor = select( 'core/editor' );
		const modernInterface = select( 'core/interface' );
		const legacyInterface = select( 'core/edit-post' );
		return !! (
			editor &&
			( modernInterface || legacyInterface ) &&
			frame.document.querySelector( '.interface-interface-skeleton' )
		);
	} catch {
		// Cross-origin/navigation race. The next `os-ready` repaints.
		return false;
	}
}

function postSidecarState(
	win: EditorSidecarWindowLike,
	active: boolean,
): boolean {
	const target = win.iframe?.contentWindow;
	if ( ! target ) {
		return false;
	}
	try {
		target.postMessage(
			{ type: 'os-editor-sidecar-set', active },
			window.location.origin,
		);
		return true;
	} catch {
		return false;
	}
}

/** Give the compound editor enough width to remain a useful split. */
function makeRoomForSidecar( win: EditorSidecarWindowLike ): void {
	const element = win.element;
	if ( ! element || typeof win.maximize !== 'function' ) {
		return;
	}
	const desktopWidth = element.parentElement?.clientWidth ?? window.innerWidth;
	const currentWidth = element.getBoundingClientRect().width;
	if ( desktopWidth >= 960 && currentWidth > 0 && currentWidth < 900 ) {
		win.maximize();
	}
}

function setActive(
	win: EditorSidecarWindowLike,
	active: boolean,
	makeRoom: boolean,
): void {
	if ( active ) {
		store.state.activeEditors.add( win.id );
		if ( makeRoom ) {
			makeRoomForSidecar( win );
		}
	} else {
		store.state.activeEditors.delete( win.id );
	}
	persistEditors();
	postSidecarState( win, active );
	win.renderCustomTitleBarButtons?.();
}

function windowForMessageSource(
	manager: EditorSidecarManager,
	source: MessageEventSource | null,
): EditorSidecarWindowLike | null {
	if ( ! source ) {
		return null;
	}
	for ( const id of store.state.activeEditors ) {
		const win = manager.getById( id );
		if ( win?.iframe?.contentWindow === source ) {
			return win;
		}
	}
	return null;
}

/**
 * Register the title-bar affordance and keep it synchronized across
 * iframe reloads, Gutenberg's own close button, and session restore.
 */
export function bootEditorSidecar( {
	manager,
}: {
	manager: EditorSidecarManager;
} ): void {
	const readinessProbes = new Map< string, number >();

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
			if ( store.state.activeEditors.has( win.id ) ) {
				postSidecarState( win, true );
			}
			win.renderCustomTitleBarButtons?.();
			return;
		}
		if ( attempt >= GUTENBERG_PROBE_ATTEMPTS ) {
			readinessProbes.delete( windowId );
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
		label: __( 'Editor Sidecar' ),
		icon: 'dashicons-columns',
		placement: 'right',
		order: 54, // Immediately before Preview (55) and Related (60).
		match: ( win ) => isGutenbergEditor( win ),
		render: ( host, win ) => {
			const active = store.state.activeEditors.has( win.id );
			host.setAttribute( 'aria-pressed', String( active ) );
			host.addEventListener( 'click', ( event: Event ) => {
				event.stopPropagation();
				setActive( win, ! store.state.activeEditors.has( win.id ), true );
			} );
		},
	} );

	// A restored or navigated iframe gets a fresh document. Re-apply the
	// persisted split only after its bridge says every listener is wired.
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
			// The standalone bridge can announce readiness before Gutenberg's
			// React tree and data stores mount. Repaint immediately to remove
			// stale controls after navigation, then probe until the editor is
			// actually capable of hosting the sidecar.
			win.renderCustomTitleBarButtons?.();
			probeGutenbergReadiness( win.id );
		},
	);

	// The iframe owns Gutenberg's close button. If the user closes the
	// complementary area there, its handler reports `active: false` so
	// the shell button and persisted preference follow the real UI.
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
		const win = windowForMessageSource( manager, event.source );
		if ( ! win ) {
			return;
		}
		if ( ! data.active || data.available === false ) {
			store.state.activeEditors.delete( win.id );
			persistEditors();
			win.renderCustomTitleBarButtons?.();
		}
	} );
}

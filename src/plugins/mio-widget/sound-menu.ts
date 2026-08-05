import { openWithShellOverlays } from '../../shell-overlays/loader';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import type { MioCopy } from './copy';
import type { MioSfx } from './sfx';

const SOUND_STORAGE_KEY = 'sound-enabled';

type CloseReason = 'escape' | 'pick' | 'outside' | 'focusout' | 'replace' | 'teardown';

export function readMioSoundEnabled( ctx: WidgetContext ): boolean {
	return ctx.storage.get< boolean >( SOUND_STORAGE_KEY ) ?? true;
}

/** Add a keyboard-accessible mute action without changing Mio's visible UI. */
export function bindMioSoundMenu(
	root: HTMLElement,
	ctx: WidgetContext,
	copy: MioCopy,
	audio: MioSfx,
	showMessage: ( message: string ) => void,
): WidgetTeardown {
	let destroyed = false;
	let menu: HTMLElement | null = null;
	let invoker: HTMLElement | null = null;
	let generation = 0;
	const ownerDocument = root.ownerDocument;

	const close = ( reason: CloseReason ): void => {
		generation++;
		const focusTarget = invoker;
		invoker = null;
		if ( menu ) {
			menu.remove();
			menu = null;
		}
		document.removeEventListener( 'pointerdown', onOutside, true );
		document.removeEventListener( 'keydown', onDocumentKeydown, true );
		if (
			( reason === 'escape' || reason === 'pick' ) &&
			focusTarget?.isConnected
		) {
			queueMicrotask( () => {
				focusTarget.focus( { preventScroll: true } );
			} );
		}
	};

	const onOutside = ( event: Event ): void => {
		if ( menu && ! menu.contains( event.target as Node ) ) {
			close( 'outside' );
		}
	};

	const onDocumentKeydown = ( event: KeyboardEvent ): void => {
		if ( event.key === 'Escape' && menu ) {
			event.preventDefault();
			event.stopPropagation();
			close( 'escape' );
		}
	};

	const open = (
		position: { x: number; y: number },
		trigger: HTMLElement,
	): void => {
		close( 'replace' );
		invoker = trigger;
		const thisGeneration = ++generation;
		openWithShellOverlays(
			() =>
				! destroyed &&
				thisGeneration === generation &&
				trigger.isConnected,
			() => {
				if (
					! customElements.get( 'os-context-menu' ) ||
					! customElements.get( 'os-context-menu-option' )
				) {
					return;
				}

				const nextMenu = document.createElement( 'os-context-menu' );
				nextMenu.className = 'mio-companion__sound-menu';
				nextMenu.setAttribute( 'open', '' );
				nextMenu.style.position = 'fixed';
				nextMenu.style.left = `${ position.x }px`;
				nextMenu.style.top = `${ position.y }px`;
				nextMenu.style.zIndex = '10500';

				const option = document.createElement( 'os-context-menu-option' );
				option.setAttribute( 'value', 'toggle-sound' );
				option.dataset.menuItemId = 'toggle-sound';
				option.textContent = audio.isEnabled()
					? copy.sound.muteAction
					: copy.sound.unmuteAction;
				nextMenu.appendChild( option );
				nextMenu.addEventListener( 'os-context-menu-pick', ( event ) => {
					const value = ( event as CustomEvent< { value?: string } > ).detail
						?.value;
					if ( value !== 'toggle-sound' ) {
						return;
					}
					const enabled = ! audio.isEnabled();
					audio.setEnabled( enabled );
					ctx.storage.set( SOUND_STORAGE_KEY, enabled );
					showMessage( enabled ? copy.sound.on : copy.sound.off );
					close( 'pick' );
				} );
				nextMenu.addEventListener( 'focusout', () => {
					queueMicrotask( () => {
						if (
							menu === nextMenu &&
							! nextMenu.contains( nextMenu.ownerDocument.activeElement )
						) {
							close( 'focusout' );
						}
					} );
				} );

				document.body.appendChild( nextMenu );
				menu = nextMenu;
				const rect = nextMenu.getBoundingClientRect();
				nextMenu.style.left = `${ clamp(
					position.x,
					8,
					Math.max( 8, window.innerWidth - rect.width - 8 ),
				) }px`;
				nextMenu.style.top = `${ clamp(
					position.y,
					8,
					Math.max( 8, window.innerHeight - rect.height - 8 ),
				) }px`;

				queueMicrotask( () => {
					if ( menu === nextMenu && thisGeneration === generation ) {
						option.focus( { preventScroll: true } );
					}
				} );
				queueMicrotask( () => {
					if ( menu !== nextMenu ) {
						return;
					}
					document.addEventListener( 'pointerdown', onOutside, true );
					document.addEventListener( 'keydown', onDocumentKeydown, true );
				} );
			},
		);
	};

	const onContextMenu = ( event: MouseEvent ): void => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.target;
		const button =
			target instanceof Element
				? target.closest< HTMLElement >( 'button' )
				: null;
		const activeElement = ownerDocument.activeElement;
		const active =
			activeElement instanceof HTMLElement && root.contains( activeElement )
				? activeElement
				: null;
		open( { x: event.clientX, y: event.clientY }, button ?? active ?? root );
	};

	const onKeydown = ( event: KeyboardEvent ): void => {
		if ( event.key !== 'ContextMenu' && ! ( event.shiftKey && event.key === 'F10' ) ) {
			return;
		}
		const target = event.target;
		const button =
			target instanceof Element
				? target.closest< HTMLElement >( 'button' )
				: null;
		if ( ! button || ! root.contains( button ) ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const rect = button.getBoundingClientRect();
		open( { x: rect.left + 8, y: rect.bottom + 4 }, button );
	};

	root.addEventListener( 'contextmenu', onContextMenu );
	root.addEventListener( 'keydown', onKeydown );

	return () => {
		if ( destroyed ) {
			return;
		}
		destroyed = true;
		close( 'teardown' );
		root.removeEventListener( 'contextmenu', onContextMenu );
		root.removeEventListener( 'keydown', onKeydown );
	};
}

function clamp( value: number, min: number, max: number ): number {
	return Math.min( max, Math.max( min, value ) );
}

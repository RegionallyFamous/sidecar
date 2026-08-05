import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/ui/components/os-context-menu/os-context-menu';
import { createMioCopy } from '../../src/plugins/mio-widget/copy';
import {
	bindMioSoundMenu,
	readMioSoundEnabled,
} from '../../src/plugins/mio-widget/sound-menu';
import type { MioSfx } from '../../src/plugins/mio-widget/sfx';
import type { WidgetContext, WidgetStorage } from '../../src/widgets/types';

function createStorage(): WidgetStorage & {
	set: ReturnType< typeof vi.fn >;
} {
	const values = new Map< string, unknown >();
	return {
		get: < T, >( key: string ) => ( values.get( key ) as T | undefined ) ?? null,
		set: vi.fn( ( key: string, value: unknown ) => values.set( key, value ) ),
		remove: ( key ) => {
			values.delete( key );
		},
		clear: () => values.clear(),
	};
}

describe( 'Mio sound preference menu', () => {
	beforeEach( () => {
		document.body.innerHTML = '<section id="mio"><button>Explore</button></section>';
	} );

	afterEach( () => {
		document.querySelectorAll( '.mio-companion__sound-menu' ).forEach(
			( menu ) => menu.remove(),
		);
	} );

	test( 'defaults sound on without adding visible widget controls', () => {
		const storage = createStorage();
		const ctx = { id: 'openstation/mio', pluginUrl: '', storage };

		expect( readMioSoundEnabled( ctx ) ).toBe( true );
		expect( document.querySelectorAll( '#mio button' ) ).toHaveLength( 1 );
	} );

	test( 'opens from Shift+F10, toggles once, and restores button focus', async () => {
		const storage = createStorage();
		const ctx: WidgetContext = {
			id: 'openstation/mio',
			pluginUrl: '',
			storage,
		};
		let enabled = true;
		const audio = {
			isEnabled: () => enabled,
			setEnabled: ( next: boolean ) => {
				enabled = next;
			},
		} as MioSfx;
		const messages: string[] = [];
		const root = document.querySelector< HTMLElement >( '#mio' )!;
		const button = root.querySelector< HTMLButtonElement >( 'button' )!;
		const teardown = bindMioSoundMenu(
			root,
			ctx,
			createMioCopy(),
			audio,
			( message ) => messages.push( message ),
		);

		button.focus();
		button.dispatchEvent( new KeyboardEvent( 'keydown', {
			bubbles: true,
			key: 'F10',
			shiftKey: true,
		} ) );
		await Promise.resolve();
		const option = document.querySelector< HTMLElement >(
			'.mio-companion__sound-menu os-context-menu-option',
		)!;
		expect( option.textContent ).toBe( 'Mute sound effects' );
		expect( document.activeElement ).toBe( option );

		option.dispatchEvent( new KeyboardEvent( 'keydown', {
			bubbles: true,
			key: 'Enter',
		} ) );
		await Promise.resolve();

		expect( enabled ).toBe( false );
		expect( storage.set ).toHaveBeenCalledWith( 'sound-enabled', false );
		expect( messages ).toEqual( [ 'Sound effects off.' ] );
		expect( document.activeElement ).toBe( button );
		expect( document.querySelector( '.mio-companion__sound-menu' ) ).toBeNull();

		teardown();
	} );
} );

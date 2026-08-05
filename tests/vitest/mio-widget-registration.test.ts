import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetDef } from '../../src/widgets/types';
import { HOOKS } from '../../src/hooks';
import {
	AUTO_PIN_KEY,
	MIO_WIDGET_ID,
} from '../../src/plugins/mio-widget/auto-pin';
import {
	createHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

const WIDGET_ID = 'openstation/mio';

interface TestHost extends Window {
	openStationWidgets?: Record< string, WidgetDef[ 'mount' ] >;
	wp?: {
		hooks: FakeWpHooks;
		os?: {
			whenReady: ( callback: () => void ) => void;
			widgetLayer?: {
				ensureMounted: ( id: string ) => boolean;
			} | null;
		};
	};
}

const host = window as TestHost;

describe( 'Mio companion registration', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.useFakeTimers();
		window.localStorage.clear();
		delete host.openStationWidgets;
		delete host.wp;
	} );

	afterEach( () => {
		vi.useRealTimers();
		delete host.openStationWidgets;
		delete host.wp;
	} );

	test( 'auto-pins when registration follows shell readiness', async () => {
		const ensureMounted = vi.fn( () => true );
		const whenReady = vi.fn( ( callback: () => void ) => callback() );
		const hooks = createHooksStub();
		host.wp = { hooks, os: { whenReady, widgetLayer: { ensureMounted } } };

		const module = await import( '../../src/plugins/mio-widget/index' );

		expect( MIO_WIDGET_ID ).toBe( WIDGET_ID );
		expect( AUTO_PIN_KEY ).toBe( 'mio-companion.auto-pinned.v1' );
		expect( module.mountMioWidget ).toEqual( expect.any( Function ) );
		expect( host.openStationWidgets?.[ WIDGET_ID ] ).toEqual(
			expect.any( Function ),
		);
		expect( whenReady ).toHaveBeenCalledOnce();
		expect( ensureMounted ).not.toHaveBeenCalled();

		hooks.doAction( HOOKS.WIDGET_REGISTERED, { id: WIDGET_ID } );

		expect( ensureMounted ).toHaveBeenCalledOnce();
		expect( ensureMounted ).toHaveBeenCalledWith( WIDGET_ID );
		expect( window.localStorage.getItem( AUTO_PIN_KEY ) ).toBe( '1' );
	} );

	test( 'auto-pins when shell readiness follows registration', async () => {
		const ensureMounted = vi.fn( () => true );
		let markReady: ( () => void ) | undefined;
		const hooks = createHooksStub();
		host.wp = {
			hooks,
			os: {
				whenReady: ( callback ) => {
					markReady = callback;
				},
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		hooks.doAction( HOOKS.WIDGET_REGISTERED, { id: WIDGET_ID } );

		expect( ensureMounted ).not.toHaveBeenCalled();
		markReady?.();
		expect( ensureMounted ).toHaveBeenCalledOnce();
	} );

	test( 'preserves a later user removal after the one-time auto-pin', async () => {
		window.localStorage.setItem( AUTO_PIN_KEY, '1' );
		const ensureMounted = vi.fn( () => true );
		const hooks = createHooksStub();
		host.wp = {
			hooks,
			os: {
				whenReady: ( callback ) => callback(),
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		hooks.doAction( HOOKS.WIDGET_REGISTERED, { id: WIDGET_ID } );

		expect( ensureMounted ).not.toHaveBeenCalled();
	} );

	test( 'does not mark auto-pin complete when the widget layer cannot mount it', async () => {
		const ensureMounted = vi.fn( () => false );
		const hooks = createHooksStub();
		host.wp = {
			hooks,
			os: {
				whenReady: ( callback ) => callback(),
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		hooks.doAction( HOOKS.WIDGET_REGISTERED, { id: WIDGET_ID } );

		expect( ensureMounted ).toHaveBeenCalledOnce();
		expect( window.localStorage.getItem( AUTO_PIN_KEY ) ).toBeNull();
	} );

	test( 'ignores unrelated widget registrations', async () => {
		const ensureMounted = vi.fn( () => true );
		const hooks = createHooksStub();
		host.wp = {
			hooks,
			os: {
				whenReady: ( callback ) => callback(),
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		hooks.doAction( HOOKS.WIDGET_REGISTERED, { id: 'example/other' } );

		expect( ensureMounted ).not.toHaveBeenCalled();
		expect( window.localStorage.getItem( AUTO_PIN_KEY ) ).toBeNull();
	} );
} );

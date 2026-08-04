import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetDef } from '../../src/widgets/types';
import {
	AUTO_PIN_KEY,
	MIO_WIDGET_ID,
} from '../../src/plugins/mio-widget/auto-pin';

const WIDGET_ID = 'openstation/mio';

interface TestHost extends Window {
	openStationWidgets?: Record< string, WidgetDef[ 'mount' ] >;
	wp?: {
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

	test( 'publishes the stable widget id and auto-pins once after shell readiness', async () => {
		const ensureMounted = vi.fn( () => true );
		const whenReady = vi.fn( ( callback: () => void ) => callback() );
		host.wp = { os: { whenReady, widgetLayer: { ensureMounted } } };

		const module = await import( '../../src/plugins/mio-widget/index' );

		expect( MIO_WIDGET_ID ).toBe( WIDGET_ID );
		expect( AUTO_PIN_KEY ).toBe( 'mio-companion.auto-pinned.v1' );
		expect( module.mountMioWidget ).toEqual( expect.any( Function ) );
		expect( host.openStationWidgets?.[ WIDGET_ID ] ).toEqual(
			expect.any( Function ),
		);
		expect( whenReady ).toHaveBeenCalledOnce();
		expect( ensureMounted ).not.toHaveBeenCalled();
		expect( vi.getTimerCount() ).toBe( 1 );

		vi.runAllTimers();

		expect( ensureMounted ).toHaveBeenCalledOnce();
		expect( ensureMounted ).toHaveBeenCalledWith( WIDGET_ID );
		expect( window.localStorage.getItem( AUTO_PIN_KEY ) ).toBe( '1' );
		expect( vi.getTimerCount() ).toBe( 0 );
	} );

	test( 'preserves a later user removal after the one-time auto-pin', async () => {
		window.localStorage.setItem( AUTO_PIN_KEY, '1' );
		const ensureMounted = vi.fn( () => true );
		host.wp = {
			os: {
				whenReady: ( callback ) => callback(),
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		vi.runAllTimers();

		expect( ensureMounted ).not.toHaveBeenCalled();
		expect( vi.getTimerCount() ).toBe( 0 );
	} );

	test( 'does not mark auto-pin complete when the widget layer cannot mount it', async () => {
		const ensureMounted = vi.fn( () => false );
		host.wp = {
			os: {
				whenReady: ( callback ) => callback(),
				widgetLayer: { ensureMounted },
			},
		};

		await import( '../../src/plugins/mio-widget/index' );
		vi.runAllTimers();

		expect( ensureMounted ).toHaveBeenCalledOnce();
		expect( window.localStorage.getItem( AUTO_PIN_KEY ) ).toBeNull();
		expect( vi.getTimerCount() ).toBe( 0 );
	} );
} );

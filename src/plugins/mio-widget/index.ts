/**
 * OpenStation — Mio companion widget.
 *
 * Publishes a server-declared widget mount, then makes one deferred auto-pin
 * attempt after the shell and server-widget registry have finished booting.
 */

import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { attemptMioAutoPin, MIO_WIDGET_ID } from './auto-pin';
import { createMioCopy } from './copy';
import { mountMioWidget } from './mount';

type MioMount = (
	container: HTMLElement,
	ctx: WidgetContext,
) => WidgetTeardown | Promise< WidgetTeardown >;

interface MioWidgetGlobals {
	openStationWidgets?: Record< string, MioMount | undefined >;
}

const globals = window as unknown as MioWidgetGlobals;
globals.openStationWidgets = globals.openStationWidgets ?? {};
globals.openStationWidgets[ MIO_WIDGET_ID ] = ( container, ctx ) =>
	mountMioWidget( container, ctx, createMioCopy() );

const ready = window.wp?.os?.whenReady ?? window.wp?.os?.ready;
ready?.( () => {
	// Dynamic widget scripts resolve before server-sync registers their defs.
	// One macrotask lets that registration finish; this is not retry polling.
	window.setTimeout( () => {
		const layer = window.wp?.os?.widgetLayer;
		if ( ! layer ) {
			return;
		}
		let storage: Storage;
		try {
			storage = window.localStorage;
		} catch {
			return;
		}
		attemptMioAutoPin( storage, ( id ) =>
			layer.ensureMounted( id ),
		);
	}, 0 );
} );

export { mountMioWidget };

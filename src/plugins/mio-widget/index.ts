/**
 * OpenStation — Mio companion widget.
 *
 * Publishes a server-declared widget mount, then auto-pins once both the shell
 * and Mio's asynchronously-loaded widget definition are ready.
 */

import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { HOOKS } from '../../hooks';
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

const AUTO_PIN_NAMESPACE = 'desktop-mode/mio-auto-pin';
let shellReady = false;
let widgetRegistered = false;

const autoPin = (): boolean => {
	if ( ! shellReady || ! widgetRegistered ) {
		return false;
	}
	const layer = window.wp?.os?.widgetLayer;
	if ( ! layer ) {
		return false;
	}
	let storage: Storage;
	try {
		storage = window.localStorage;
	} catch {
		return false;
	}
	return attemptMioAutoPin(
		storage,
		( id ) => layer.ensureMounted( id ),
	);
};

const hooks = window.wp?.hooks;
hooks?.addAction(
	HOOKS.WIDGET_REGISTERED,
	AUTO_PIN_NAMESPACE,
	( payload: unknown ) => {
		if ( ( payload as { id?: unknown } )?.id !== MIO_WIDGET_ID ) {
			return;
		}
		widgetRegistered = true;
		if ( autoPin() ) {
			hooks.removeAction( HOOKS.WIDGET_REGISTERED, AUTO_PIN_NAMESPACE );
		}
	},
);

const ready = window.wp?.os?.whenReady ?? window.wp?.os?.ready;
ready?.( () => {
	shellReady = true;
	if ( autoPin() ) {
		hooks?.removeAction( HOOKS.WIDGET_REGISTERED, AUTO_PIN_NAMESPACE );
	}
} );

export { mountMioWidget };

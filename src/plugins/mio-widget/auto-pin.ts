export const MIO_WIDGET_ID = 'openstation/mio';
export const AUTO_PIN_KEY = 'mio-companion.auto-pinned.v1';

export interface MioAutoPinStorage {
	getItem( key: string ): string | null;
	setItem( key: string, value: string ): void;
}

/**
 * Opt Mio in once, then leave later removal entirely under user control.
 * Storage failures fail closed; a failed mount stays unmarked for a later boot.
 */
export function attemptMioAutoPin(
	storage: MioAutoPinStorage,
	ensureMounted: ( id: string ) => boolean,
): boolean {
	try {
		if ( storage.getItem( AUTO_PIN_KEY ) !== null ) {
			return true;
		}
	} catch {
		return false;
	}

	if ( ! ensureMounted( MIO_WIDGET_ID ) ) {
		return false;
	}

	try {
		storage.setItem( AUTO_PIN_KEY, '1' );
	} catch {
		// The successful in-memory pin is enough for this visit. A later
		// boot may retry because the marker could not be persisted.
	}
	return true;
}

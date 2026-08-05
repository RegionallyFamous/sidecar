import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = readFileSync(
	resolve( __dirname, '../../src/plugins/mio-widget/styles.css' ),
	'utf8',
);

function ruleBody( selector: string ): string {
	const escaped = selector.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	const match = CSS.match( new RegExp( `${ escaped }\\s*\\{([^}]+)\\}` ) );
	return match?.[ 1 ] ?? '';
}

describe( 'Mio compact layout', () => {
	test( 'lets transient messages grow instead of clipping translated copy', () => {
		const status = ruleBody( '.mio-companion__status' );

		expect( status ).toContain( 'height: auto' );
		expect( status ).toContain( 'min-height: 44px' );
		expect( status ).toContain( 'overflow: visible' );
		expect( status ).toContain( 'overflow-wrap: anywhere' );
		expect( status ).toContain( 'hyphens: auto' );
		expect( status ).toContain( 'pointer-events: none' );
		expect( status ).not.toMatch( /(?:^|\n)\s*height:\s*44px/ );
		expect( status ).not.toContain( 'overflow: hidden' );
	} );

	test( 'does not advertise disabled travel controls as clickable', () => {
		expect( CSS ).toContain(
			'body.os-active .mio-companion button:not(:disabled)',
		);
		expect( CSS ).toContain(
			'body.os-active .mio-companion button:disabled',
		);
	} );
} );

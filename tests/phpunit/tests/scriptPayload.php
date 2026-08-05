<?php
/**
 * Tests for script-handle payload URL resolution.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-script-payload
 */
class Tests_OpenStation_ScriptPayload extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		wp_scripts()->registered = array();
	}

	/**
	 * Lazy registry loads must receive the same final URL filters as scripts
	 * printed through WordPress's normal enqueue pipeline.
	 *
	 * @covers ::openstation_resolve_script_payload
	 */
	public function test_resolve_script_payload_applies_print_time_url_filter() {
		wp_register_script( 'scoped-demo', 'https://example.test/demo.js', array(), '3.0', true );
		$filter = static function ( $src, $handle ) {
			if ( 'scoped-demo' !== $handle ) {
				return $src;
			}
			return add_query_arg( 'runtime_scope', 'playground', $src );
		};
		add_filter( 'script_loader_src', $filter, 10, 2 );

		$payload = openstation_resolve_script_payload( 'scoped-demo' );

		remove_filter( 'script_loader_src', $filter, 10 );
		$this->assertStringContainsString( 'demo.js', $payload['url'] );
		$this->assertStringContainsString( 'ver=3.0', $payload['url'] );
		$this->assertStringContainsString( 'runtime_scope=playground', $payload['url'] );
	}
}

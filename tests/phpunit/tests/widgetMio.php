<?php
/**
 * Tests for the native Mio companion widget's PHP registration.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-mio-widget
 */
class Tests_OpenStation_WidgetMio extends WP_UnitTestCase {

	/**
	 * Administrator used to exercise the shell-only stylesheet enqueue.
	 *
	 * @var int
	 */
	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_dequeue_style( 'os-mio-widget' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
	}

	public function tear_down() {
		wp_dequeue_style( 'os-mio-widget' );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_register_mio_widget_assets
	 */
	public function test_registers_dedicated_translatable_script_and_style_assets() {
		openstation_register_mio_widget_assets();

		$this->assertTrue( wp_script_is( 'os-mio-widget', 'registered' ) );
		$this->assertTrue( wp_style_is( 'os-mio-widget', 'registered' ) );

		$suffix = openstation_asset_suffix();
		$script = wp_scripts()->registered['os-mio-widget'];
		$style  = wp_styles()->registered['os-mio-widget'];
		$this->assertStringEndsWith(
			'assets/js/widget-mio' . $suffix . '.js',
			$script->src
		);
		$this->assertStringEndsWith(
			'assets/js/widget-mio' . $suffix . '.css',
			$style->src
		);
		$this->assertContains( 'wp-i18n', $script->deps );
		$this->assertTrue( (bool) $script->extra['group'], 'script loads in the footer' );
	}

	/**
	 * The native widget resolves its habitat through WidgetContext::pluginUrl;
	 * it must not inherit the standalone plugin's localized asset-base shim.
	 *
	 * @covers ::openstation_register_mio_widget_assets
	 */
	public function test_does_not_localize_standalone_asset_configuration() {
		openstation_register_mio_widget_assets();

		$this->assertFalse( wp_scripts()->get_data( 'os-mio-widget', 'data' ) );
	}

	/**
	 * @covers ::openstation_register_mio_widget
	 */
	public function test_registers_the_stable_widget_contract() {
		openstation_register_mio_widget();

		$entry = openstation_desktop_widget_registry( 'openstation/mio' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'Mio', $entry['label'] );
		$this->assertSame( 'os-mio-widget', $entry['script'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
		$this->assertSame( 240, $entry['min_width'] );
		$this->assertSame( 360, $entry['min_height'] );
		$this->assertSame( 340, $entry['max_width'] );
		$this->assertSame( 460, $entry['max_height'] );
		$this->assertSame( 270, $entry['default_width'] );
		$this->assertSame( 390, $entry['default_height'] );
	}

	/**
	 * @covers ::openstation_enqueue_mio_widget_styles
	 */
	public function test_eagerly_enqueues_css_only_for_an_enabled_shell_user() {
		openstation_register_mio_widget_assets();
		wp_set_current_user( self::$admin_id );

		openstation_enqueue_mio_widget_styles();
		$this->assertFalse( wp_style_is( 'os-mio-widget', 'enqueued' ) );

		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		openstation_enqueue_mio_widget_styles();
		$this->assertTrue( wp_style_is( 'os-mio-widget', 'enqueued' ) );
	}

	public function test_registration_hooks_remain_wired() {
		$this->assertSame(
			5,
			has_action( 'init', 'openstation_register_mio_widget_assets' )
		);
		$this->assertSame(
			6,
			has_action( 'init', 'openstation_register_mio_widget' )
		);
		$this->assertSame(
			20,
			has_action(
				'admin_enqueue_scripts',
				'openstation_enqueue_mio_widget_styles'
			)
		);
	}
}

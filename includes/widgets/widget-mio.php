<?php
/**
 * OpenStation — Mio companion widget PHP registration.
 *
 * Registers Mio's dedicated bundle and co-located stylesheet, eagerly loads
 * only the CSS on shell pages, and announces the widget to OpenStation. The
 * companion is entirely local: no routes, server state, or external services.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register Mio's script and style handles.
 *
 * @return void
 */
function openstation_register_mio_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-mio' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-mio' . $suffix . '.css';

	wp_register_style(
		'os-mio-widget',
		OPENSTATION_URL . 'assets/js/widget-mio' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-mio-widget',
		OPENSTATION_URL . 'assets/js/widget-mio' . $suffix . '.js',
		// Mio coordinates its first auto-pin through `wp.os.whenReady`
		// and the client widget-registration action.
		// Keep the shell ahead of this bundle even when WordPress promotes
		// the main script to `defer`; otherwise Mio can evaluate while `wp.os`
		// is still absent and silently miss its only pin attempt.
		array( 'openstation', 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);
	wp_set_script_translations(
		'os-mio-widget',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_register_mio_widget_assets', 5 );

/**
 * Eagerly enqueue Mio's CSS on OpenStation shell pages.
 *
 * @return void
 */
function openstation_enqueue_mio_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-mio-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_mio_widget_styles', 20 );

/**
 * Announce Mio to the server-driven widget registry.
 *
 * @return void
 */
function openstation_register_mio_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}

	openstation_register_widget(
		'openstation/mio',
		array(
			'label'          => __( 'Mio', 'desktop-mode' ),
			'description'    => __( 'A gentle station companion who glows, drifts, and waits without worry.', 'desktop-mode' ),
			'icon'           => 'dashicons-star-filled',
			'script'         => 'os-mio-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 360,
			'max_width'      => 340,
			'max_height'     => 460,
			'default_width'  => 270,
			'default_height' => 390,
		)
	);
}
add_action( 'init', 'openstation_register_mio_widget', 6 );

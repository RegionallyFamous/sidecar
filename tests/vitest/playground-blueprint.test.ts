/**
 * The public Playground Blueprint installs OpenStation and creates its
 * Gutenberg Sidebar Window demo with one intentional, self-contained runPHP
 * step. It must not stage an extension or a must-use plugin.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

interface BlueprintStep {
	step: string;
	consts?: Record<string, string | number | boolean>;
	pluginData?: {
		resource?: string;
		url?: string;
		slug?: string;
	};
	options?: {
		activate?: boolean;
	};
	path?: string;
	code?: string;
}

interface Blueprint {
	$schema: string;
	landingPage: string;
	preferredVersions: {
		php: string;
		wp: string;
	};
	features: {
		networking: boolean;
	};
	siteOptions: {
		blogname: string;
	};
	steps: BlueprintStep[];
}

const ROOT = resolve(__dirname, "../..");
const BLUEPRINT = JSON.parse(
	readFileSync(
		resolve(ROOT, ".wordpress-org/blueprints/blueprint.json"),
		"utf8",
	),
) as Blueprint;
const RELEASE_ARTIFACT_FILES = [
	".github/workflows/ci.yml",
	".github/workflows/pr-preview-build.yml",
	".github/workflows/pr-preview-publish.yml",
	".github/workflows/release.yml",
	"bin/package.sh",
];

describe("public Playground Blueprint", () => {
	test("uses current stock WordPress with the OpenStation identity", () => {
		expect(BLUEPRINT.$schema).toBe(
			"https://playground.wordpress.net/blueprint-schema.json",
		);
		expect(BLUEPRINT.preferredVersions.wp).toBe("latest");
		expect(BLUEPRINT.siteOptions.blogname).toBe("OpenStation");
		expect(BLUEPRINT.landingPage).toBe("/openstation/");
		expect(BLUEPRINT.features.networking).toBe(true);
	});

	test("installs OpenStation and Jetpack before the intentional demo setup", () => {
		expect(BLUEPRINT.steps.map((step) => step.step)).toEqual([
			"login",
			"defineWpConfigConsts",
			"installPlugin",
			"installPlugin",
			"runPHP",
		]);

		expect(BLUEPRINT.steps[1].consts).toEqual({
			JETPACK_DEV_DEBUG: true,
		});

		const install = BLUEPRINT.steps[2];
		expect(install.pluginData).toEqual({
			resource: "url",
			url: "https://github.com/RegionallyFamous/sidecar/releases/latest/download/openstation.zip",
		});
		expect(install.options).toEqual({ activate: true });

		const jetpack = BLUEPRINT.steps[3];
		expect(jetpack.pluginData).toEqual({
			resource: "wordpress.org/plugins",
			slug: "jetpack",
		});
		expect(jetpack.options).toEqual({ activate: true });
	});

	test("does not stage extensions or must-use plugins", () => {
		expect(BLUEPRINT.steps).toHaveLength(5);
		expect(
			BLUEPRINT.steps.some(
				(step) =>
					step.step === "writeFile" ||
					step.path?.includes("/mu-plugins/"),
			),
		).toBe(false);

		const php = BLUEPRINT.steps[4].code ?? "";
		expect(php).not.toContain("/mu-plugins/");
		expect(php).not.toContain("openstation_register_extension");
		expect(php).not.toContain("file_put_contents");
	});

	test("creates the idempotent Sidebar Window demo and opens its editor", () => {
		const setup = BLUEPRINT.steps[4];
		expect(setup.step).toBe("runPHP");
		const php = setup.code ?? "";

		// Re-running the Blueprint updates the same page instead of duplicating it.
		expect(php).toContain(
			"get_page_by_path('meet-sidebar-window', OBJECT, 'page')",
		);
		expect(php).toContain("'post_title' => 'Meet Sidebar Window'");
		expect(php).toContain("'post_name' => 'meet-sidebar-window'");
		expect(php).toContain("wp_update_post($page_data, true)");
		expect(php).toContain("wp_insert_post($page_data, true)");

		// Start from a predictable OpenStation session with Desktop Mode enabled.
		expect(php).toContain(
			"update_user_meta((int) $admin->ID, 'desktop_mode_mode', '1')",
		);
		expect(php).toContain("openstation_clear_session((int) $admin->ID)");
		expect(php).toContain(
			"delete_user_meta((int) $admin->ID, 'desktop_mode_session')",
		);

		// The seeded page is the default editor and consumes the one-shot demo flag.
		expect(php).toContain("admin_url('post.php')");
		expect(php).toContain("'action' => 'edit'");
		expect(php).toContain("'openstation_sidebar_window_auto' => '1'");
		expect(php).toContain(
			"openstation_set_default_window((int) $admin->ID, $editor_url)",
		);
	});

	test("publishes the branded artifact used by the Blueprint URL", () => {
		for (const file of RELEASE_ARTIFACT_FILES) {
			const source = readFileSync(resolve(ROOT, file), "utf8");
			expect(source, file).toContain("openstation.zip");
			expect(source, file).not.toContain("desktop-mode.zip");
		}
	});
});

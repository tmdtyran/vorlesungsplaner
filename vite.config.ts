import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// WICHTIG: Vites SSR-ModuleRunner faengt auch dynamische `import()`-
	// Aufrufe ab und routet sie durch seinen eigenen Resolver, der das
	// "bun:"-Protokoll nicht kennt - das gilt selbst dann, wenn der
	// Prozess tatsaechlich mit `bun run dev` gestartet wurde. Ohne diesen
	// Eintrag schlaegt `import("bun:sqlite")` in src/lib/server/db.ts
	// immer fehl, unabhaengig davon, wie er im Code abgesichert ist.
	// "external" sorgt dafuer, dass Vite das Modul gar nicht erst
	// anfasst, sondern den Import 1:1 an die native Runtime durchreicht.
	ssr: {
		external: ['bun:sqlite']
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

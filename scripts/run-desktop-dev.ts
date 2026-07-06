#!/usr/bin/env bun
/**
 * Startet die Neutralino-Shell im Entwicklungsmodus (`neu run`).
 * Als eigenes Bun-Skript statt als package.json-Ein-Zeiler mit `cd ... && ...`,
 * da package.json-Skripte über die System-Shell laufen (unter Windows z.B.
 * PowerShell, das kein `&&` in älteren Versionen unterstützt). Bun selbst
 * ist hier plattformunabhängig.
 */
import { $ } from "bun";

await $`bunx neu run`.cwd("neutralino");

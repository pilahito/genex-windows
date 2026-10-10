/**
 * Genex Windows Community: which optional plugins the Windows installer left enabled. The wizard
 * (build/windows/genex-community.iss) writes `community-plugins.json` beside the bundled plugins,
 * e.g. `{ "mobile": true, "apk": false }`. A profile that installs its bundled plugins for the first
 * time starts each listed one enabled or disabled accordingly; the user can change it in Plugins.
 * No file (portable zip, other builds) means every bundled plugin starts enabled, as before.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const INSTALLER_PLUGINS_FILE = "community-plugins.json";

export function installerPluginChoices(resources: string): Record<string, boolean> {
  try {
    const saved = JSON.parse(readFileSync(path.join(resources, INSTALLER_PLUGINS_FILE), "utf8")) as unknown;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const out: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(saved)) if (typeof value === "boolean") out[id] = value;
    return out;
  } catch {
    return {};
  }
}

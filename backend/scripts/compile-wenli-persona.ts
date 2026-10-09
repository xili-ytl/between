import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileWenliPersona } from "../src/domain/wenli-persona-source.js";
import { selectWenliPersonaPath } from "./lib/wenli-persona-path.js";

const backendRoot = fileURLToPath(new URL("../", import.meta.url));
// The public exporter disables the private workspace's owner-document fallback.
const allowLegacyOwner = false;
const source = selectWenliPersonaPath(backendRoot, process.argv.slice(2), existsSync, allowLegacyOwner);
const ownerText = await readFile(source.path, "utf8");
const artifact = compileWenliPersona(ownerText, "2026-09-12");
const json = JSON.stringify(artifact, null, 2) + "\n";
const targets = [
  { path: resolve(backendRoot, "src/domain/wenli-persona.generated.ts"), text: `// Generated from the owner-reviewed persona. Run scripts/compile-wenli-persona.ts.\nimport type { WenliPersonaSource } from "./wenli-persona-source.js";\nexport const WENLI_SOURCE: WenliPersonaSource = ${json.trim()};\n` },
  { path: resolve(backendRoot, "resources/wenli/owner.md"), text: ownerText }
];
if (!source.check) await mkdir(resolve(backendRoot, "resources/wenli"),{recursive:true});
for (const target of targets) {
  if (source.check) {
    if (await readFile(target.path, "utf8") !== target.text) throw new Error("Wenli persona artifact is out of date");
  } else await writeFile(target.path, target.text, "utf8");
}
console.log(`Wenli persona ${source.check ? "verified" : "compiled"}: ${artifact.sourceHash}; ${artifact.facts.length} background facts`);

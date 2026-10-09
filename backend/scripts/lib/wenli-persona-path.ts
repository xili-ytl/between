import { resolve } from "node:path";

/** Select one explicit persona document; never scan engineering documents. */
export function selectWenliPersonaPath(
  backendRoot: string,
  args: string[],
  exists: (path: string) => boolean,
  allowLegacyOwner = false
): { path: string; check: boolean } {
  let source: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--check" && !check) check = true;
    else if (arg === "--source" && source === undefined) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--source requires a document path");
      source = resolve(value);
    } else throw new Error(`Unsupported or repeated persona argument: ${arg}`);
  }
  const legacy = resolve(backendRoot, "../../../backend/resources/wenli/owner.md");
  return {
    path: source ?? (allowLegacyOwner && exists(legacy) ? legacy : resolve(backendRoot, "resources/wenli/owner.md")),
    check
  };
}

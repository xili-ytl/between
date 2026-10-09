import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selectWenliPersonaPath } from "../scripts/lib/wenli-persona-path.js";

describe("portable persona source selection", () => {
  const root = resolve("synthetic-checkout", "backend");
  const owner = resolve(root, "resources/wenli/owner.md");
  const legacy = resolve(root, "../../../backend/resources/wenli/owner.md");

  it("uses the bundled snapshot in a standalone checkout", () => {
    expect(selectWenliPersonaPath(root, [], path => path === owner)).toEqual({ path: owner, check: false });
  });

  it("preserves the existing owner's editing workflow when its document exists", () => {
    expect(selectWenliPersonaPath(root, ["--check"], path => path === legacy || path === owner, true))
      .toEqual({ path: legacy, check: true });
  });

  it("does not discover an outside owner document unless the private workspace opts in", () => {
    expect(selectWenliPersonaPath(root, ["--check"], () => true))
      .toEqual({ path: owner, check: true });
  });

  it("honors an explicit source and rejects unknown or incomplete arguments", () => {
    const explicit = resolve("synthetic-persona.md");
    expect(selectWenliPersonaPath(root, ["--source", explicit, "--check"], () => true))
      .toEqual({ path: explicit, check: true });
    for (const args of [["--source"], ["--source", "--check"], ["--all"], ["--source", explicit, "--source", owner]]) {
      expect(() => selectWenliPersonaPath(root, args, () => true)).toThrow();
    }
  });
});

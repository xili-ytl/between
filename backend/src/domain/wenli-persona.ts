import { WENLI_SOURCE } from "./wenli-persona.generated.js";

/** Compatibility facade; the owner document is the only authored role source. */
export const PERSONA_DEV_CANARY = "DEV_ONLY_DO_NOT_LOAD_20260911";
export const WENLI_PERSONA = Object.freeze({
  sourceDocument: "backend/resources/wenli/owner.md",
  allowedSections: Object.freeze([1, 2, 3, 4, 7, 8]),
  sourceHash: WENLI_SOURCE.sourceHash
});
export function formatWenliPersona(): string { return WENLI_SOURCE.role; }

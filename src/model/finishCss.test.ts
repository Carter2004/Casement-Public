// finishCss.test.ts — the registry-resolution guard (cycle 015 audit #1): the black-default-
// kitchen bug was a CSS comment whose own prose contained a stray comment-close token, ending
// the comment mid-sentence. A real CSS parser then treats everything after that as one invalid
// declaration and discards it up through the NEXT bare semicolon — transparently skipping over
// any later, well-formed comment in between (comments are tokenized independently of "find the
// next ;" error recovery) — which is exactly how the swallowed declaration hid behind a second,
// perfectly normal-looking comment right above it. A naive "strip comments, then substring-search
// for the declaration" check does NOT reproduce this: the target text is still THERE as a raw
// substring even though no CSS parser would ever treat it as a live declaration. This test instead
// strips comments and then requires each variable to head its OWN semicolon-terminated segment —
// exactly what a real parser accepts — so it fails the moment a stray comment-close reappears.
// The var list is read from the registries themselves — never hand-duplicated here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKSPLASHES, CABINET_FINISHES, COUNTER_MATERIALS, FLOOR_MATERIALS, WALL_PAINTS } from "./finishes";

const CSS_PATH = resolve(__dirname, "../styles.css");

/** Mirrors real CSS comment parsing: non-greedy, so the first comment-close token always wins —
 * exactly the mechanism behind the original bug. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** True only if `cssVar` heads its own clean, semicolon-terminated declaration once comments are
 * stripped — not merely present as a substring somewhere. A declaration "eaten" by a preceding
 * invalid one (the original bug) sits in the MIDDLE of some other segment, never at its start. */
function declaredCleanly(strippedCss: string, cssVar: string): boolean {
  const escaped = cssVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}\\s*:\\s*\\S`);
  return strippedCss.split(";").some((segment) => pattern.test(segment));
}

const REGISTRIES = [CABINET_FINISHES, COUNTER_MATERIALS, FLOOR_MATERIALS, WALL_PAINTS, BACKSPLASHES];
const ALL_CSS_VARS = REGISTRIES.flatMap((registry) => Object.values(registry).map((entry) => entry.cssVar));

describe("every finishes.ts cssVar heads its own clean CSS declaration", () => {
  const stripped = stripComments(readFileSync(CSS_PATH, "utf8"));

  it("collected at least one variable per registry (the test isn't accidentally checking nothing)", () => {
    expect(ALL_CSS_VARS.length).toBeGreaterThanOrEqual(REGISTRIES.length);
  });

  it.each(ALL_CSS_VARS)("%s heads its own declaration, not swallowed by a prior invalid one", (cssVar) => {
    expect(declaredCleanly(stripped, cssVar)).toBe(true);
  });
});

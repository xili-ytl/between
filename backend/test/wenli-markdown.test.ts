import { describe, expect, it } from "vitest";
import { normalizeGeneratedWenliMarkdown } from "../src/domain/wenli-markdown.js";

describe("generated Wenli Markdown normalization", () => {
  it("repairs a lone model fence suffix before following prose", () => {
    const source = "说明\n\n```text\nresult = I\n```n\n\n后续正文";

    expect(normalizeGeneratedWenliMarkdown(source)).toBe(
      "说明\n\n```text\nresult = I\n```\n\n后续正文",
    );
  });

  it("preserves fence-like code when a valid closing fence follows", () => {
    const source = "```text\n```n\nkept as code\n```";

    expect(normalizeGeneratedWenliMarkdown(source)).toBe(source);
  });

  it("repairs a malformed close before prose and another fenced block", () => {
    const source = "思路：\n\n```text\nresult = I\n```n\n关键点是结合律。\n\n再看例子：\n\n```text\n| F(n+1) F(n) |\n```";

    expect(normalizeGeneratedWenliMarkdown(source)).toBe(
      "思路：\n\n```text\nresult = I\n```\n关键点是结合律。\n\n再看例子：\n\n```text\n| F(n+1) F(n) |\n```",
    );
  });

  it("repairs a malformed close before prose and an unlabeled fenced block", () => {
    const source = "```text\nresult = I\n```n\n关键点是结合律。\n\n再看矩阵：\n\n```\n| F(n+1) F(n) |\n```";

    expect(normalizeGeneratedWenliMarkdown(source)).toBe(
      "```text\nresult = I\n```\n关键点是结合律。\n\n再看矩阵：\n\n```\n| F(n+1) F(n) |\n```",
    );
  });

  it("preserves ordinary text and valid CommonMark and LaTeX", () => {
    const source = "公式：\\(A^n\\)\n\n```kotlin\nval n = 1\n```";

    expect(normalizeGeneratedWenliMarkdown(source)).toBe(source);
  });
});

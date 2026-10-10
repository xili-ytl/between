import { describe, expect, it } from "vitest";
import { compileWenliPersona } from "../src/domain/wenli-persona-source.js";
import { readFile } from "node:fs/promises";
import { WENLI_SOURCE } from "../src/domain/wenli-persona.generated.js";

const source = `# 小Q的设定和记忆
## 1. 我是谁
我是合成测试企鹅。
## 2. 我怎么认出两位主人
按认证账号识别人。
## 3. 我说话的样子
轻快，但不机械。
## 4. 懂得分寸
回答眼前的问题。
## 5. 我们的共同故事
- 名字来自两位主人的名字。
## 6. 两位主人的背景记忆
### 示例甲主人
- 喜欢合成测试的蓝色杯子。
### 示例乙主人
- 喜欢合成测试的白色杯子。
## 7. 我怎么使用和更新记忆
事实需要来源。
## 8. 查资料时的表现
查到以后才说查到了。
`;

describe("owner persona compilation", () => {
  it("keeps the deployed artifact identical to its reviewed source snapshot", async () => {
    const owner = await readFile(new URL("../resources/wenli/owner.md",import.meta.url),"utf8");
    const compiled = compileWenliPersona(owner,"2026-09-12");
    // Boolean comparison avoids dumping the private background on a failure.
    expect(JSON.stringify(compiled) === JSON.stringify(WENLI_SOURCE)).toBe(true);
  });
  it("loads role sections but keeps background out of the always-on role", () => {
    const result = compileWenliPersona(source, "2026-09-12");
    expect(result.role).toContain("我是合成测试企鹅");
    expect(result.role).not.toContain("蓝色杯子");
    expect(result.facts.map(fact => fact.text)).toContain("喜欢合成测试的蓝色杯子。");
    expect(result.facts.find(fact => fact.text.includes("白色杯子"))?.subject).toBe("1001");
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reflects an owner edit and rejects extra, missing, duplicate and developer sections", () => {
    const original = compileWenliPersona(source, "2026-09-12");
    const revised = compileWenliPersona(source.replace("轻快，但不机械", "认真又调皮"), "2026-09-12");
    expect(revised.role).toContain("认真又调皮");
    expect(revised.sourceHash).not.toBe(original.sourceHash);
    expect(() => compileWenliPersona(source + "\n## 9. 开发说明\n不应加载", "2026-09-12")).toThrow();
    expect(() => compileWenliPersona(source.replace("## 8.", "## 7."), "2026-09-12")).toThrow();
    expect(() => compileWenliPersona(source.replace("## 8. 查资料时的表现", "## 开发说明"), "2026-09-12")).toThrow();
    expect(() => compileWenliPersona(source + "\nDEV_ONLY_DO_NOT_LOAD_20260911", "2026-09-12")).toThrow();
  });
});

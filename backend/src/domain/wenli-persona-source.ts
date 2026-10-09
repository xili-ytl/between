import { createHash } from "node:crypto";

export interface WenliBackgroundFact {
  id: string;
  subject: "1002" | "1001" | "wenli" | "couple";
  text: string;
  topic: "origin" | "identity" | "birthday" | "school" | "competition" | "future-study" | "health" | "preference";
  sensitive: boolean;
  asOf: string;
}

export interface WenliPersonaSource {
  version: 1;
  sourceHash: string;
  role: string;
  facts: WenliBackgroundFact[];
}

/** Build-time only. Accept one explicitly selected owner document, never a directory. */
export function compileWenliPersona(markdown: string, asOf: string): WenliPersonaSource {
  const source = markdown.replace(/\r\n/g, "\n").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Invalid persona review date");
  if (/DEV_ONLY_DO_NOT_LOAD|(?:AGENTS|PROGRESS|PLAN|SPEC)\.md|<!--/u.test(source)) {
    throw new Error("Persona source contains developer material");
  }
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  if (headings.length !== 8 || headings.some((heading, index) => !heading[1]!.startsWith(`${index + 1}. `))) {
    throw new Error("Persona source must contain exactly reviewed sections 1 through 8");
  }
  const sections = headings.map((heading, index) => source.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? source.length).trim());
  if (sections.some(section => !section)) throw new Error("Persona section empty");
  const role = [0, 1, 2, 3, 6, 7].map(index => sections[index]!).join("\n\n");
  const facts: WenliBackgroundFact[] = [];
  for (const match of sections[4]!.matchAll(/^- (.+)$/gm)) {
    facts.push({ id: `origin_${facts.length}`, subject: "couple", text: match[1]!, topic: "origin", sensitive: false, asOf });
  }
  let subject: WenliBackgroundFact["subject"] | undefined;
  for (const line of sections[5]!.split("\n")) {
    if (line.startsWith("### ")) {
      if (line === "### 示例甲主人") subject = "1002";
      else if (line === "### 示例乙主人") subject = "1001";
      else throw new Error("Unknown profile owner heading");
    }
    if (!line.startsWith("- ")) continue;
    if (!subject) throw new Error("Profile fact without owner");
    // Usage bullets are policy, not personal facts. Their role equivalents live in sections 4/7.
    if (/^- (只在|不主动|她首先|不自行|不把|可以陪伴)/u.test(line)) continue;
    for (const fragment of line.slice(2).replace(/^当前情况：/u, "").split(/[；;]|(?<=在读)，/u).map(value => value.trim()).filter(Boolean)) {
      const topic = factTopic(fragment);
      facts.push({ id: `profile_${subject}_${facts.length}`, subject, text: fragment, topic, sensitive: topic === "health" || /休学|养病/u.test(fragment), asOf });
    }
  }
  if (facts.length === 0) throw new Error("Persona background is empty");
  return { version: 1, sourceHash: createHash("sha256").update(source).digest("hex"), role, facts };
}

function factTopic(text: string): WenliBackgroundFact["topic"] {
  if (/抑郁|养病|治疗|用药|休学/u.test(text)) return "health";
  if (/生日/u.test(text)) return "birthday";
  if (/考研|硕士|中科大/u.test(text)) return "future-study";
  if (/ACM|ICPC|蓝桥|竞赛|省.*金|国.*一等奖/iu.test(text)) return "competition";
  if (/大学|专业|大[一二三四]|高[一二三]|在读/u.test(text)) return "school";
  if (/性别|男朋友|女朋友/u.test(text)) return "identity";
  return "preference";
}

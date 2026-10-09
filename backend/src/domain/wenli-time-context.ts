/** Build an unambiguous, provider-facing current-time block for Wenli. */
export function wenliTimeContext(now: Date): string {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(now).replace(" ", "T");
  return [
    `Authoritative current Beijing time (Asia/Shanghai, UTC+08:00): ${local}+08:00`,
    `UTC reference only: ${now.toISOString()}`,
    "For 现在/今天/昨天/明天 use the Beijing value above. Do not read the UTC hour as local time.",
    "The server clock already provides the current time; do not search the web to determine it."
  ].join("\n");
}

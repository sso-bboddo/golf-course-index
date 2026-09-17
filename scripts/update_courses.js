const fs = require("fs");

const SOURCE_URL = "https://raw.githubusercontent.com/myphj01/my_golf_courses/main/index.html";
const OUT = "data/courses.json";

function extractCourses(html) {
  const startMarker = "const COURSES = [";
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error("COURSES array not found");
  const from = start + "const COURSES = ".length;
  let depth = 0, inString = false, quote = "", escape = false, end = -1;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') { inString = true; quote = ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error("COURSES array end not found");
  const literal = html.slice(from, end);
  return Function('"use strict"; return (' + literal + ')')();
}

function normalize(c, checkedAt) {
  const hasDetail = !c.stub;
  const fields = {
    weekdayFee: c.weekday ?? null,
    weekendFee: c.weekend ?? null,
    caddieFee: c.caddieFee ?? null,
    cartFee: c.cartFee ?? null,
    blackTee: c.blackTee ?? null,
    blueTee: c.blueTee ?? null,
    whiteTee: c.whiteTee ?? null,
    redTee: c.redTee ?? null,
    twoPlayer: c.twoPlayer ?? null,
    threePlayer: c.threePlayer ?? null,
    fourPlayer: c.fourPlayer ?? null,
    noCaddy: c.noCaddy ?? null,
    walking: c.walking ?? null,
    night: c.night ?? null
  };
  const filled = Object.values(fields).filter(v => v !== null && v !== undefined).length;
  const dataStatus = hasDetail && filled >= 3 ? "detail" : hasDetail ? "partial" : "list_only";
  return {
    id: String(c.id),
    name: c.name ?? null,
    region: c.region ?? null,
    city: c.city ?? null,
    address: c.address ?? null,
    phone: c.phone ?? null,
    homepage: c.homepage ?? null,
    type: c.type ?? null,
    holes: c.holes ?? null,
    par: c.par ?? null,
    ...fields,
    dataStatus,
    sourceName: "myphj01/my_golf_courses 공개 데이터셋",
    sourceUrl: SOURCE_URL,
    sourceType: "third_party_public_dataset",
    checkedAt
  };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "golf-course-index-data-updater" } });
  if (!res.ok) throw new Error(`Source fetch failed: ${res.status}`);
  const html = await res.text();
  const courses = extractCourses(html).map(c => normalize(c, checkedAt));

  if (courses.length < 500) throw new Error(`Expected 500+ courses, got ${courses.length}`);

  const payload = {
    generatedAt: checkedAt,
    sourceUrl: SOURCE_URL,
    total: courses.length,
    counts: {
      detail: courses.filter(c => c.dataStatus === "detail").length,
      partial: courses.filter(c => c.dataStatus === "partial").length,
      list_only: courses.filter(c => c.dataStatus === "list_only").length
    },
    courses
  };
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Generated ${courses.length} courses`);
  console.log(payload.counts);
}
main().catch(err => { console.error(err); process.exit(1); });

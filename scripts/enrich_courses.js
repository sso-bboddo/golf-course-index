const fs = require("fs");

const INPUT = "data/courses.json";
const OUTPUT = "data/courses.json";

const SEARCH_CONCURRENCY = 8;
const PAGE_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 7000;
const MAX_SEARCH_RESULTS = 5;
const MAX_RELEVANT_PAGES = 3;
const RETRY_COUNT = 1;

const BLOCKED_HOSTS = new Set([
  "google.com", "naver.com", "blog.naver.com", "youtube.com", "youtu.be",
  "instagram.com", "facebook.com", "x.com", "twitter.com",
  "tripadvisor.com", "booking.com", "agoda.com",
  "kakaomap.com", "map.kakao.com", "place.naver.com"
]);

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function isBlocked(url) {
  const h = hostOf(url);
  return !h || [...BLOCKED_HOSTS].some(x => h === x || h.endsWith("." + x));
}

function absUrl(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(m[1]) : null;
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } catch {}
  }
  return out;
}

function htmlLinks(html, base) {
  const arr = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = absUrl(base, m[1]);
    if (!url || isBlocked(url)) continue;
    arr.push({ url, text: cleanText(m[2]) });
  }
  return arr;
}

function parsePhone(text) {
  const m = text.match(/(?:0\d{1,2})[-.\s]\d{3,4}[-.\s]\d{4}/);
  return m ? m[0].replace(/\s+/g, "-") : null;
}

function parseAddress(text) {
  const m = text.match(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^。]{5,120}(?:로|길|읍|면|동|리)[^。]{0,60}/);
  return m ? m[0].trim() : null;
}

function money(s) {
  const n = s.replace(/,/g, "").match(/\d{2,3}(?:\d{3})?/);
  return n ? Number(n[0]) : null;
}

function parseFee(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + "[^\\d]{0,80}(\\d{2,3}(?:,\\d{3})?)\\s*(?:원|만원)?", "i");
    const m = text.match(re);
    if (m) {
      const v = money(m[1]);
      if (v != null) return v < 10000 ? v * 10000 : v;
    }
  }
  return null;
}

function parseDistance(text, names) {
  for (const name of names) {
    const re = new RegExp(name + "[^\\d]{0,50}(\\d{3,4})\\s*(?:m|M|미터)?", "i");
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function hasAny(text, words) {
  return words.some(w => text.includes(w));
}

async function fetchPage(url) {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GolfCourseIndexBot/2.0)"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      return { url: res.url, html };
    } catch (e) {
      if (attempt === RETRY_COUNT) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function searchHomepage(course) {
  const q = encodeURIComponent(`${course.name} ${course.city || ""} 골프장 공식 홈페이지`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;
  const { html } = await fetchPage(searchUrl);

  const candidates = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    let href = m[1];
    try {
      const u = new URL(href, "https://html.duckduckgo.com");
      const wrapped = u.searchParams.get("uddg");
      if (wrapped) href = decodeURIComponent(wrapped);
    } catch {}

    if (!/^https?:\/\//i.test(href) || isBlocked(href)) continue;

    const text = cleanText(m[2]);
    const hay = `${text} ${href}`.toLowerCase();
    let score = 0;

    if (hay.includes(String(course.name || "").toLowerCase())) score += 10;
    if (/(golf|cc|gc|country|club|resort|골프|컨트리|리조트)/i.test(href)) score += 4;
    if (/(공식|official|홈페이지)/i.test(text)) score += 5;

    candidates.push({ href, text, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates.slice(0, MAX_SEARCH_RESULTS)) {
    try {
      const page = await fetchPage(candidate.href);
      const body = cleanText(page.html).slice(0, 40000);
      const name = String(course.name || "").replace(/\s+/g, "");

      if (
        candidate.score >= 9 ||
        (name.length >= 2 && body.replace(/\s+/g, "").includes(name))
      ) {
        return {
          url: page.url,
          html: page.html,
          title: titleOf(page.html),
          source: "DuckDuckGo 검색 후 공식 홈페이지 후보 검증"
        };
      }
    } catch {}
  }

  return null;
}

function collectRelevantLinks(homeUrl, html) {
  const host = hostOf(homeUrl);
  const keywords = [
    "요금", "그린피", "이용요금", "이용료", "가격", "fee", "price",
    "코스", "course", "예약", "라운드", "이용안내",
    "캐디", "카트", "노캐디", "셀프", "워킹", "야간", "night",
    "티", "거리", "오시는길", "오시는 길"
  ];

  return htmlLinks(html, homeUrl)
    .filter(x => hostOf(x.url) === host)
    .map(x => {
      const hay = `${x.text} ${x.url}`.toLowerCase();
      let score = 0;
      for (const k of keywords) if (hay.includes(k.toLowerCase())) score += 2;
      return { ...x, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_PAGES);
}

function extractFields(course, pages) {
  const texts = pages.map(p => cleanText(p.html)).join("\n");
  const jsonlds = pages.flatMap(p => extractJsonLd(p.html));

  let address = null;
  let phone = null;

  for (const j of jsonlds) {
    if (!address && typeof j === "object" && j.address?.streetAddress) {
      address = [
        j.address.addressRegion,
        j.address.addressLocality,
        j.address.streetAddress
      ].filter(Boolean).join(" ");
    }
    if (!phone && typeof j === "object" && j.telephone) phone = j.telephone;
  }

  address ||= parseAddress(texts);
  phone ||= parsePhone(texts);

  return {
    address,
    phone,
    weekdayFee: course.weekdayFee ?? parseFee(texts, ["주중 그린피", "주중", "평일 그린피", "평일"]),
    weekendFee: course.weekendFee ?? parseFee(texts, ["주말 그린피", "주말", "토요일", "일요일"]),
    caddieFee: course.caddieFee ?? parseFee(texts, ["캐디피", "캐디 비용", "캐디비"]),
    cartFee: course.cartFee ?? parseFee(texts, ["카트피", "카트비", "카트 비용"]),
    blackTee: course.blackTee ?? parseDistance(texts, ["블랙티", "Black Tee", "Black"]),
    blueTee: course.blueTee ?? parseDistance(texts, ["블루티", "Blue Tee", "Blue"]),
    whiteTee: course.whiteTee ?? parseDistance(texts, ["화이트티", "White Tee", "White"]),
    redTee: course.redTee ?? parseDistance(texts, ["레드티", "Red Tee", "Red"]),
    threePlayer: course.threePlayer ?? (hasAny(texts, ["3인 플레이", "3인플레이", "3인 라운드"]) ? true : null),
    twoPlayer: course.twoPlayer ?? (hasAny(texts, ["2인 플레이", "2인플레이", "2인 라운드"]) ? true : null),
    fourPlayer: course.fourPlayer ?? (hasAny(texts, ["4인 플레이", "4인플레이", "4인 라운드"]) ? true : null),
    noCaddy: course.noCaddy ?? (hasAny(texts, ["노캐디", "노 캐디", "무캐디"]) ? true : null),
    walking: course.walking ?? (hasAny(texts, ["워킹", "도보 라운드", "셀프 라운드"]) ? true : null),
    night: course.night ?? (hasAny(texts, ["야간 라운드", "야간운영", "야간 티오프", "나이트"]) ? true : null)
  };
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const results = new Array(items.length);

  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { error: e };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runner)
  );

  return results;
}

async function processCourse(c, i, total) {
  const now = new Date().toISOString();

  // 이미 공식 홈페이지를 확인한 골프장은 매일 다시 검색하지 않음.
  // 단, 홈페이지가 미확인/오류인 경우에는 재시도.
  let home = null;

  if (c.homepage && c.homepageStatus === "found") {
    try {
      const page = await fetchPage(c.homepage);
      home = {
        url: page.url,
        html: page.html,
        title: titleOf(page.html),
        source: c.homepageSource || "기존 홈페이지"
      };
    } catch {
      // 기존 URL이 죽었으면 아래 검색으로 재시도
    }
  }

  if (!home) {
    try {
      home = await searchHomepage(c);
    } catch (e) {
      c.homepageStatus = "search_error";
      c.homepageCheckedAt = now;
      return;
    }
  }

  if (!home) {
    c.homepageStatus = "not_found";
    c.homepageCheckedAt = now;
    return;
  }

  c.homepage = home.url;
  c.homepageTitle = home.title;
  c.homepageStatus = "found";
  c.homepageCheckedAt = now;
  c.homepageSource = home.source;

  const links = collectRelevantLinks(home.url, home.html);
  const pages = [{ url: home.url, html: home.html }];

  const pageResults = await runPool(
    links,
    PAGE_CONCURRENCY,
    async link => fetchPage(link.url)
  );

  for (const result of pageResults) {
    if (result && !result.error) {
      pages.push({ url: result.url, html: result.html });
    }
  }

  const extracted = extractFields(c, pages);

  for (const [k, v] of Object.entries(extracted)) {
    if ((c[k] == null || c[k] === "") && v != null) c[k] = v;
  }

  c.officialPageSources = [...new Set(pages.map(p => p.url))].slice(0, 10);
  c.officialInfoCheckedAt = now;
  c.officialInfoSource = "골프장 공식 홈페이지 및 공식 홈페이지 내부 관련 페이지";

  return;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const courses = data.courses || [];

  console.log(`Starting official homepage enrichment: ${courses.length} courses`);
  console.log(`Concurrency: search ${SEARCH_CONCURRENCY}, pages ${PAGE_CONCURRENCY}`);
  console.log(`Fetch timeout: ${FETCH_TIMEOUT_MS}ms`);

  await runPool(courses, SEARCH_CONCURRENCY, async (c, i) => {
    console.log(`[${i + 1}/${courses.length}] ${c.name}`);
    await processCourse(c, i, courses.length);
    return true;
  });

  const homepageFound = courses.filter(c => c.homepageStatus === "found").length;
  const homepageNotFound = courses.filter(c => c.homepageStatus === "not_found").length;
  const searchErrors = courses.filter(c => c.homepageStatus === "search_error").length;

  data.generatedAt = new Date().toISOString();
  data.officialInfoSummary = {
    total: courses.length,
    homepageFound,
    homepageNotFound,
    searchErrors,
    updatedAt: data.generatedAt
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), "utf8");

  console.log("================================");
  console.log("Official homepage enrichment complete");
  console.log(data.officialInfoSummary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

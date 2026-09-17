const fs = require("fs");

const INPUT = "data/courses.json";
const OUTPUT = "data/courses.json";
const MAX_RELEVANT_PAGES = 6;
const DELAY_MS = 900;

const BLOCKED_HOSTS = [
  "google.com", "naver.com", "blog.naver.com", "youtube.com", "youtu.be",
  "instagram.com", "facebook.com", "x.com", "twitter.com", "tripadvisor.com",
  "booking.com", "agoda.com", "kakaomap.com", "map.kakao.com", "place.naver.com"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}
function isBlocked(url) {
  const h = hostOf(url);
  return !h || BLOCKED_HOSTS.some(x => h === x || h.endsWith("." + x));
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
    const text = cleanText(m[2]);
    arr.push({ url, text });
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
function parseDistance(text, teeNames) {
  for (const tee of teeNames) {
    const re = new RegExp(tee + "[^\\d]{0,50}(\\d{3,4})\\s*(?:m|M|미터)?", "i");
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}
function hasAny(text, words) {
  return words.some(w => text.includes(w));
}

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GolfCourseIndexBot/1.0)"
    }
  });
  if (!res.ok) throw new Error(String(res.status));
  const html = await res.text();
  return { url: res.url, html };
}

async function searchHomepage(course) {
  const q = encodeURIComponent(`${course.name} ${course.city || ""} 골프장 공식 홈페이지`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;
  const res = await fetch(searchUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GolfCourseIndexBot/1.0)" }
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const html = await res.text();

  const links = [];
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
    links.push({ href, text, score });
  }

  links.sort((a, b) => b.score - a.score);

  for (const candidate of links.slice(0, 10)) {
    try {
      const page = await fetchPage(candidate.href);
      const body = cleanText(page.html).slice(0, 60000);
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
    "코스", "course", "예약", "라운드", "이용안내", "안내",
    "캐디", "카트", "노캐디", "셀프", "워킹", "야간", "night",
    "티", "거리", "시설", "오시는길", "오시는 길"
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

  let address = null, phone = null;
  for (const j of jsonlds) {
    if (!address && typeof j === "object") {
      address = j.address?.streetAddress
        ? [j.address.addressRegion, j.address.addressLocality, j.address.streetAddress].filter(Boolean).join(" ")
        : null;
    }
    if (!phone && typeof j === "object" && j.telephone) phone = j.telephone;
  }

  address ||= parseAddress(texts);
  phone ||= parsePhone(texts);

  const fields = {
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

  return fields;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const courses = data.courses || [];

  let homepageFound = 0;
  let processed = 0;

  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    console.log(`\n[${i + 1}/${courses.length}] ${c.name}`);

    try {
      let home = null;

      if (c.homepage) {
        try {
          const page = await fetchPage(c.homepage);
          home = {
            url: page.url,
            html: page.html,
            title: titleOf(page.html),
            source: c.homepageSource || "기존 홈페이지"
          };
        } catch {}
      }

      if (!home) {
        home = await searchHomepage(c);
        await sleep(DELAY_MS);
      }

      if (!home) {
        c.homepageStatus = "not_found";
        c.homepageCheckedAt = new Date().toISOString();
        console.log("  공식 홈페이지: 미확인");
        continue;
      }

      c.homepage = home.url;
      c.homepageTitle = home.title;
      c.homepageStatus = "found";
      c.homepageCheckedAt = new Date().toISOString();
      c.homepageSource = home.source;
      homepageFound++;

      const links = collectRelevantLinks(home.url, home.html);
      const pages = [{ url: home.url, html: home.html }];

      for (const link of links) {
        try {
          const page = await fetchPage(link.url);
          pages.push({ url: page.url, html: page.html });
          await sleep(300);
        } catch {}
      }

      const extracted = extractFields(c, pages);

      // 홈페이지에서 확인된 값만 덮어씀. 기존 값은 유지.
      for (const [k, v] of Object.entries(extracted)) {
        if ((c[k] == null || c[k] === "") && v != null) c[k] = v;
      }

      c.officialPageSources = [...new Set(pages.map(p => p.url))].slice(0, 10);
      c.officialInfoCheckedAt = new Date().toISOString();
      c.officialInfoSource = "골프장 공식 홈페이지 및 공식 홈페이지 내부 관련 페이지";

      processed++;
      console.log(`  홈페이지: ${c.homepage}`);
      console.log(`  관련 페이지: ${pages.length}개`);
    } catch (err) {
      c.homepageStatus = c.homepage ? "existing_error" : "search_error";
      c.homepageCheckedAt = new Date().toISOString();
      console.log(`  오류: ${err.message}`);
    }

    // 528개를 한 번에 너무 빠르게 요청하지 않도록 대기
    await sleep(DELAY_MS);
  }

  data.generatedAt = new Date().toISOString();
  data.officialInfoSummary = {
    total: courses.length,
    homepageFound,
    processed,
    homepageNotFound: courses.filter(c => c.homepageStatus === "not_found").length
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), "utf8");

  console.log("\n================================");
  console.log("공식 홈페이지 정보 보강 완료");
  console.log(data.officialInfoSummary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

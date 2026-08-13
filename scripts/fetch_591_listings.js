#!/usr/bin/env node
/**
 * Fetch commercial office listings (kind=6 "辦公", >=300坪) from
 * business.591.com.tw for Taipei (region=1) and New Taipei (region=3),
 * both rent (type=1) and sale (type=2), plus each listing's precise
 * coordinates from its detail page (not present on the list page).
 *
 * The 300坪 floor is intentionally broader than any single search need —
 * it's the data floor. Higher minimums are applied later as a client-side
 * filter (see MIN_AREA_FETCHED in listings_data.py), so raising the
 * threshold in the UI doesn't require a re-fetch.
 *
 * robots.txt for business.591.com.tw allows all crawling. Requests are
 * rate-limited to be a considerate crawler.
 *
 * Usage: node scripts/fetch_591_listings.js > scripts/.cache/591_listings_raw.json
 */

const MIN_AREA_PING = 300;

const QUERIES = [
  { type: 1, region: 1, label: "rent-taipei" },
  { type: 1, region: 3, label: "rent-newtaipei" },
  { type: 2, region: 1, label: "sale-taipei" },
  { type: 2, region: 3, label: "sale-newtaipei" },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-TW,zh;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractNuxtData(html) {
  const match = html.match(/<script[^>]*>\s*(window\.__NUXT__=[\s\S]*?)<\/script>/);
  if (!match) return null;
  const window = {};
  eval(match[1]); // eslint-disable-line no-eval -- evaluating 591's own SSR payload, not user input
  return window.__NUXT__;
}

function findListItems(nuxt) {
  for (const value of Object.values(nuxt.data || {})) {
    if (value && value.data && Array.isArray(value.data.items)) {
      return { items: value.data.items, total: value.data.total };
    }
  }
  return { items: [], total: 0 };
}

function findMapInfo(nuxt) {
  for (const value of Object.values(nuxt.data || {})) {
    const d = value && value.data;
    if (d && d.mapInfo) return d.mapInfo;
  }
  return null;
}

async function fetchListingsForQuery(query) {
  const results = [];
  let page = 1;
  for (;;) {
    const url = `https://business.591.com.tw/list?type=${query.type}&kind=6&region=${query.region}&acreage=${MIN_AREA_PING}$_$&page=${page}`;
    const html = await fetchHtml(url);
    const nuxt = extractNuxtData(html);
    if (!nuxt) throw new Error(`No NUXT payload found for ${url}`);
    const { items, total } = findListItems(nuxt);
    if (items.length === 0) break;
    results.push(...items);
    process.stderr.write(`${query.label} page ${page}: +${items.length} (have ${results.length}/${total})\n`);
    if (results.length >= total) break;
    page += 1;
    await sleep(REQUEST_DELAY_MS);
  }
  return results;
}

async function fetchListingCoords(detailUrl) {
  const html = await fetchHtml(detailUrl);
  const nuxt = extractNuxtData(html);
  if (!nuxt) return null;
  const mapInfo = findMapInfo(nuxt);
  const detail = mapInfo && mapInfo.address && mapInfo.address.detail;
  if (!detail || !detail.lat || !detail.lng) return null;
  return { lat: parseFloat(detail.lat), lng: parseFloat(detail.lng) };
}

async function main() {
  const allListings = [];
  const seenIds = new Set();

  for (const query of QUERIES) {
    const items = await fetchListingsForQuery(query);
    for (const item of items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      allListings.push(item);
    }
  }

  process.stderr.write(
    `Total unique listings: ${allListings.length}. Fetching detail pages for coordinates...\n`
  );

  for (let i = 0; i < allListings.length; i++) {
    const listing = allListings[i];
    try {
      const coords = await fetchListingCoords(listing.url);
      listing.lat = coords ? coords.lat : null;
      listing.lng = coords ? coords.lng : null;
    } catch (err) {
      process.stderr.write(`Failed to fetch detail for ${listing.id}: ${err.message}\n`);
      listing.lat = null;
      listing.lng = null;
    }
    if ((i + 1) % 20 === 0 || i === allListings.length - 1) {
      process.stderr.write(`  ${i + 1}/${allListings.length} details fetched\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  process.stdout.write(JSON.stringify(allListings));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack}\n`);
  process.exit(1);
});

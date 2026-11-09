import assert from "node:assert/strict";
import test from "node:test";
import { searchSolarPlaces } from "../app/solar-place.ts";

const russian = { id: 524901, name: "Москва", country: "Россия", admin1: "Москва",
  latitude: 55.75, longitude: 37.62, timezone: "Europe/Moscow" };
const english = { ...russian, name: "Moscow", country: "Russia", admin1: "Moscow" };

test("city search accepts Russian input in English UI and localizes suggestions", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (value) => {
    const url = new URL(value);
    requests.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname.endsWith("/search")) {
      return Response.json({ results: url.searchParams.get("language") === "ru" ? [russian] : [] });
    }
    return Response.json(english);
  };
  try {
    const results = await searchSolarPlaces("Москва", "en");
    assert.equal(results[0].name, "Moscow");
    assert.equal(results[0].timeZone, "Europe/Moscow");
    assert.deepEqual(requests.map((url) => new URL(url, "https://example.test").searchParams.get("language")),
      ["en", "ru", "en"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("city search still offers fallback places if name localization fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (value) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/get")) return new Response(null, { status: 503 });
    return Response.json({ results: url.searchParams.get("language") === "ru" ? [russian] : [] });
  };
  try {
    const results = await searchSolarPlaces("Москва", "en");
    assert.equal(results[0].name, "Москва");
    assert.equal(results[0].latitude, russian.latitude);
  } finally { globalThis.fetch = originalFetch; }
});

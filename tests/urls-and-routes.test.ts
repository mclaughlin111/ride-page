import { describe, expect, it } from "vitest";
import {
  getRouteEmbed,
  detectProvider,
  isApprovedEmbedUrl,
} from "@/lib/route-embed";
import {
  isApprovedMapEmbedUrl,
  isValidGoogleMapsUrl,
  isValidHttpsUrl,
  isValidStravaPostUrl,
  resolveMapsUrl,
} from "@/lib/urls";
import { parseRideInput } from "@/lib/validation";

describe("detectProvider", () => {
  it.each([
    ["https://ridewithgps.com/routes/123", "ridewithgps"],
    ["https://www.ridewithgps.com/routes/123", "ridewithgps"],
    ["https://www.strava.com/routes/123", "strava"],
    ["https://strava.app.link/abc", "strava"],
    ["https://connect.garmin.com/modern/course/1", "garmin"],
    ["https://www.komoot.com/tour/123", "komoot"],
    ["https://www.komoot.de/tour/123", "komoot"],
    ["https://example.com/route", "other"],
    ["https://notridewithgps.com/routes/1", "other"],
    ["not a url", "other"],
    ["http://ridewithgps.com/routes/1", "other"],
  ])("%s -> %s", (url, expected) => {
    expect(detectProvider(url)).toBe(expected);
  });
});

describe("URL validation", () => {
  it("accepts only https URLs", () => {
    expect(isValidHttpsUrl("https://example.com/a")).toBe(true);
    expect(isValidHttpsUrl("http://example.com")).toBe(false);
    expect(isValidHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpsUrl("data:text/html,<b>x</b>")).toBe(false);
    expect(isValidHttpsUrl("https://user:pass@example.com")).toBe(false);
    expect(isValidHttpsUrl("//example.com")).toBe(false);
    expect(isValidHttpsUrl("")).toBe(false);
    expect(isValidHttpsUrl(42)).toBe(false);
  });
});

describe("Google Maps URL validation", () => {
  it.each([
    "https://maps.google.com/?q=cafe",
    "https://www.google.com/maps/place/Cafe",
    "https://google.com/maps?q=x",
    "https://maps.app.goo.gl/abc123",
    "https://goo.gl/maps/abc",
  ])("accepts %s", (url) => expect(isValidGoogleMapsUrl(url)).toBe(true));

  it.each([
    "http://maps.google.com/?q=x",
    "https://www.google.com/search?q=maps",
    "https://evil.com/maps/",
    "https://maps.google.com.evil.com/",
    "javascript:alert(1)",
    "ftp://maps.google.com",
    "not a url",
  ])("rejects %s", (url) => expect(isValidGoogleMapsUrl(url)).toBe(false));

  it("falls back to a keyless search link when no map URL is stored", () => {
    expect(resolveMapsUrl(undefined, "Cafe & Co", "1 High St")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Cafe%20%26%20Co%2C%201%20High%20St",
    );
    expect(resolveMapsUrl("https://evil.com", "Cafe")).toContain("google.com/maps/search");
    expect(resolveMapsUrl("https://maps.google.com/?q=x", "Cafe")).toBe(
      "https://maps.google.com/?q=x",
    );
  });
});

describe("Strava post URL validation", () => {
  it("accepts strava.com https links only", () => {
    expect(isValidStravaPostUrl("https://www.strava.com/activities/1")).toBe(true);
    expect(isValidStravaPostUrl("https://strava.app.link/x")).toBe(true);
    expect(isValidStravaPostUrl("http://www.strava.com/activities/1")).toBe(false);
    expect(isValidStravaPostUrl("https://evilstrava.com/activities/1")).toBe(false);
  });
});

describe("route embed adapters", () => {
  it("derives a Ride with GPS embed from a route link", () => {
    const result = getRouteEmbed({
      provider: "ridewithgps",
      url: "https://ridewithgps.com/routes/12345?privacy_code=abc",
    });
    expect(result.canEmbed).toBe(true);
    const embed = new URL(result.embedUrl!);
    expect(embed.origin + embed.pathname).toBe("https://ridewithgps.com/embeds");
    expect(embed.searchParams.get("type")).toBe("route");
    expect(embed.searchParams.get("id")).toBe("12345");
    expect(embed.searchParams.get("privacyCode")).toBe("abc");
    expect(result.fallbackUrl).toBe("https://ridewithgps.com/routes/12345?privacy_code=abc");
  });

  it("falls back for Ride with GPS links it cannot interpret", () => {
    const result = getRouteEmbed({ provider: "ridewithgps", url: "https://ridewithgps.com/s/xyz" });
    expect(result).toMatchObject({ canEmbed: false, fallbackUrl: "https://ridewithgps.com/s/xyz" });
    expect(result.embedUrl).toBeUndefined();
  });

  it("derives a Komoot embed for tour links", () => {
    const result = getRouteEmbed({
      provider: "komoot",
      url: "https://www.komoot.com/tour/987?share_token=tok",
    });
    expect(result.canEmbed).toBe(true);
    expect(result.embedUrl).toContain("https://www.komoot.com/tour/987/embed");
    expect(result.embedUrl).toContain("share_token=tok");
  });

  it("does not embed Strava or Garmin share links by default", () => {
    expect(getRouteEmbed({ provider: "strava", url: "https://www.strava.com/routes/1" }).canEmbed).toBe(false);
    expect(getRouteEmbed({ provider: "garmin", url: "https://connect.garmin.com/modern/course/1" }).canEmbed).toBe(false);
  });

  it("uses an approved supplied embed URL", () => {
    const embedUrl = "https://www.strava.com/activities/1/embed/abc123";
    const result = getRouteEmbed({ provider: "strava", url: "https://www.strava.com/activities/1", embedUrl });
    expect(result).toMatchObject({ canEmbed: true, embedUrl });
  });

  it("ignores embed URLs on unapproved domains at render time", () => {
    const result = getRouteEmbed({
      provider: "other",
      url: "https://example.com/r",
      embedUrl: "https://evil.example/embed",
    });
    expect(result.canEmbed).toBe(false);
  });

  it("only approves provider embed domains", () => {
    expect(isApprovedEmbedUrl("https://ridewithgps.com/embeds?type=route&id=1")).toBe(true);
    expect(isApprovedEmbedUrl("https://ridewithgps.com/routes/1")).toBe(false);
    expect(isApprovedEmbedUrl("http://ridewithgps.com/embeds?type=route&id=1")).toBe(false);
    expect(isApprovedEmbedUrl("https://ridewithgps.com.evil.com/embeds")).toBe(false);
    expect(isApprovedEmbedUrl("https://www.komoot.com/tour/1/embed")).toBe(true);
    expect(isApprovedEmbedUrl("https://connect.garmin.com/modern/course/embed/1")).toBe(true);
    expect(isApprovedEmbedUrl("<iframe src='https://ridewithgps.com/embeds'></iframe>")).toBe(false);
  });
});

describe("route validation through parseRideInput", () => {
  const base = {
    title: "T",
    date: "2026-10-11",
    time: "09:00",
    meetingLocation: { name: "Here" },
    stops: [],
  };

  it("auto-detects the provider", () => {
    const r = parseRideInput({ ...base, route: { provider: "auto", url: "https://www.komoot.com/tour/1" } });
    expect(r.ok && r.value.route?.provider).toBe("komoot");
  });

  it("rejects invalid route and embed URLs", () => {
    const r = parseRideInput({
      ...base,
      route: { provider: "other", url: "http://example.com", embedUrl: "https://evil.com/x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["route.url"]).toBeDefined();

    const r2 = parseRideInput({
      ...base,
      route: { provider: "other", url: "https://example.com/r", embedUrl: "https://evil.com/x" },
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors["route.embedUrl"]).toMatch(/approved/);
  });

  it("extracts the src from pasted iframe code and still checks the domain", () => {
    const ok = parseRideInput({
      ...base,
      route: {
        provider: "ridewithgps",
        url: "https://ridewithgps.com/routes/1",
        embedUrl: '<iframe src="https://ridewithgps.com/embeds?type=route&amp;id=1" style="width:1px"></iframe>',
      },
    });
    expect(ok.ok && ok.value.route?.embedUrl).toBe("https://ridewithgps.com/embeds?type=route&id=1");

    const bad = parseRideInput({
      ...base,
      route: {
        provider: "other",
        url: "https://example.com/r",
        embedUrl: '<iframe src="https://evil.example/x"></iframe>',
      },
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects embed text that has no usable src", () => {
    const r = parseRideInput({
      ...base,
      route: { provider: "other", url: "https://example.com/r", embedUrl: "<script>alert(1)</script>" },
    });
    expect(r.ok).toBe(false);
  });

  it("treats an empty route as no route", () => {
    const r = parseRideInput({ ...base, route: { provider: "auto", url: "", embedUrl: "" } });
    expect(r.ok && r.value.route).toBeUndefined();
  });
});

describe("meeting location", () => {
  const base = { title: "T", date: "2026-10-11", time: "09:00", stops: [] };
  const embed =
    '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2684.8858449210306!2d-2.3655861!3d51.3786316!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48718194b4edb9c9%3A0xd82061074a9a515!2sMokoko%20Bakery!5e1!3m2!1sen!2suk!4v1791380683301!5m2!1sen!2suk" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';

  it("is optional", () => {
    const r = parseRideInput(base);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.meetingLocation).toBeUndefined();
    const empty = parseRideInput({ ...base, meetingLocation: { name: "", address: "", mapUrl: "", embedUrl: "" } });
    expect(empty.ok && empty.value.meetingLocation).toBeUndefined();
  });

  it("needs a name when other meeting fields are filled", () => {
    const r = parseRideInput({ ...base, meetingLocation: { address: "1 High St" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["meetingLocation.name"]).toBeDefined();
  });

  it("accepts a Maps short link", () => {
    const url = "https://maps.app.goo.gl/uZGzNu2E74SU1ej38";
    expect(isValidGoogleMapsUrl(url)).toBe(true);
    const r = parseRideInput({ ...base, meetingLocation: { name: "Mokoko", mapUrl: url } });
    expect(r.ok && r.value.meetingLocation?.mapUrl).toBe(url);
  });

  it("accepts other Google country domains", () => {
    expect(isValidGoogleMapsUrl("https://www.google.com.au/maps/place/x")).toBe(true);
    expect(isValidGoogleMapsUrl("https://www.google.de/maps?q=x")).toBe(true);
    expect(isValidGoogleMapsUrl("https://www.google.evil.com/maps")).toBe(false);
  });

  it("accepts a pasted Google Maps embed iframe and keeps only the src", () => {
    const r = parseRideInput({ ...base, meetingLocation: { name: "Mokoko Bakery", embedUrl: embed } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const url = r.value.meetingLocation!.embedUrl!;
      expect(url.startsWith("https://www.google.com/maps/embed?pb=")).toBe(true);
      expect(url).not.toContain("<");
    }
  });

  it("rejects non-Google or non-embed map URLs", () => {
    expect(isApprovedMapEmbedUrl("https://www.google.com/maps/embed?pb=1")).toBe(true);
    expect(isApprovedMapEmbedUrl("https://maps.google.com/maps?q=cafe&output=embed")).toBe(true);
    expect(isApprovedMapEmbedUrl("https://www.google.com/maps/place/x")).toBe(false);
    expect(isApprovedMapEmbedUrl("https://evil.com/maps/embed")).toBe(false);
    expect(isApprovedMapEmbedUrl("http://www.google.com/maps/embed")).toBe(false);
    const r = parseRideInput({ ...base, meetingLocation: { name: "X", embedUrl: "https://evil.com/maps/embed" } });
    expect(r.ok).toBe(false);
  });
});

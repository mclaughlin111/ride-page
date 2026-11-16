import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachPreviewImages, extractImageFromHtml, fetchPreviewImage } from "@/lib/preview";
import { parseStravaEmbed, stravaEmbedSrc, stravaEmbedToSnippet } from "@/lib/strava";
import { isAllowedImageUrl } from "@/lib/urls";
import { parseRideInput, parseStoredRide } from "@/lib/validation";
import { makeRide } from "./fixtures";

const SNIPPET =
  '<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="20353371963" data-style="standard" data-from-embed="false" data-token="YEhdkDZjGGFVT3ZSVd4zAUjegDmkx586I14AQwOLdIw"></div><script src="https://strava-embeds.com/embed.js"></script>';

describe("Strava embed snippets", () => {
  it("reads the id, type and token from the official snippet", () => {
    expect(parseStravaEmbed(SNIPPET)).toEqual({
      type: "activity",
      id: "20353371963",
      token: "YEhdkDZjGGFVT3ZSVd4zAUjegDmkx586I14AQwOLdIw",
    });
  });

  it("reads a strava-embeds.com URL", () => {
    expect(parseStravaEmbed("https://strava-embeds.com/activity/123?style=standard&token=abc")).toEqual({
      type: "activity",
      id: "123",
      token: "abc",
    });
  });

  it.each([
    "",
    "<div>nothing</div>",
    '<div class="strava-embed-placeholder" data-embed-type="evil" data-embed-id="1"></div>',
    '<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="1;alert(1)"></div>',
    '<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="1" data-token="a b<c"></div>',
    "https://evil.com/activity/1",
    "http://strava-embeds.com/activity/1",
  ])("rejects %j", (input) => {
    expect(parseStravaEmbed(input)).toBeNull();
  });

  it("round-trips through the editable snippet form", () => {
    const embed = parseStravaEmbed(SNIPPET)!;
    expect(parseStravaEmbed(stravaEmbedToSnippet(embed))).toEqual(embed);
  });

  it("builds the same iframe URL Strava's script would", () => {
    const src = stravaEmbedSrc(parseStravaEmbed(SNIPPET)!, {
      ns: "abc",
      origin: "https://rides.example",
      path: "/",
      title: "Ride Board",
    });
    expect(src.startsWith("https://strava-embeds.com/activity/20353371963?style=standard&fromEmbed=false&token=")).toBe(true);
    expect(src).toContain("#ns=abc&hostOrigin=https%3A%2F%2Frides.example");
  });

  it("is stored from the form as validated values only", () => {
    const base = { title: "T", date: "2026-10-11", time: "09:00", stops: [], status: "complete" };
    const r = parseRideInput({ ...base, stravaEmbed: SNIPPET });
    expect(r.ok && r.value.stravaEmbed?.id).toBe("20353371963");
    expect(JSON.stringify(r)).not.toContain("<script");
    const bad = parseRideInput({ ...base, stravaEmbed: "<script>alert(1)</script>" });
    expect(bad.ok).toBe(false);
    // Stored objects (as sent back by quick actions) are accepted too.
    const again = parseRideInput({ ...base, stravaEmbed: r.ok ? r.value.stravaEmbed : null });
    expect(again.ok && again.value.stravaEmbed).toEqual(r.ok && r.value.stravaEmbed);
  });
});

describe("preview image extraction", () => {
  it("finds og:image in either attribute order and decodes entities", () => {
    expect(
      extractImageFromHtml(
        '<meta property="og:image" content="https://d3o5xota0a1fcr.cloudfront.net/v6/maps/ABC=" data-x="">',
        "https://www.strava.com/activities/1",
      ),
    ).toBe("https://d3o5xota0a1fcr.cloudfront.net/v6/maps/ABC=");
    expect(
      extractImageFromHtml(
        '<meta content="https://maps.google.com/maps/api/staticmap?center=1%2C2&amp;zoom=17" property="og:image">',
        "https://www.google.com/maps",
      ),
    ).toBe("https://maps.google.com/maps/api/staticmap?center=1%2C2&zoom=17");
  });

  it("ignores images from unknown hosts and non-https images", () => {
    expect(extractImageFromHtml('<meta property="og:image" content="https://evil.example/x.png">', "https://www.strava.com/")).toBeUndefined();
    expect(extractImageFromHtml('<meta property="og:image" content="http://d1.cloudfront.net/x.png">', "https://www.strava.com/")).toBeUndefined();
    expect(extractImageFromHtml("<html></html>", "https://www.strava.com/")).toBeUndefined();
  });

  it("only allows known image hosts", () => {
    expect(isAllowedImageUrl("https://d3o5xota0a1fcr.cloudfront.net/a")).toBe(true);
    expect(isAllowedImageUrl("https://maps.google.com/maps/api/staticmap?x=1")).toBe(true);
    expect(isAllowedImageUrl("https://cloudfront.net.evil.com/a")).toBe(false);
    expect(isAllowedImageUrl("javascript:alert(1)")).toBe(false);
  });
});

function htmlResponse(html: string, init: ResponseInit = {}) {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" }, ...init });
}

describe("fetchPreviewImage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the og:image of an allowed page", async () => {
    fetchMock.mockResolvedValue(
      htmlResponse('<head><meta property="og:image" content="https://d1.cloudfront.net/m.png"></head>'),
    );
    expect(await fetchPreviewImage("https://www.strava.com/activities/1")).toBe("https://d1.cloudfront.net/m.png");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("follows redirects between allowed hosts", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/x" } }))
      .mockResolvedValueOnce(htmlResponse('<meta property="og:image" content="https://maps.google.com/maps/api/staticmap?c=1">'));
    expect(await fetchPreviewImage("https://maps.app.goo.gl/abc")).toBe("https://maps.google.com/maps/api/staticmap?c=1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses redirects to other hosts", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }));
    expect(await fetchPreviewImage("https://maps.app.goo.gl/abc")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never fetches unknown hosts or non-https links", async () => {
    expect(await fetchPreviewImage("https://evil.example/page")).toBeUndefined();
    expect(await fetchPreviewImage("http://www.strava.com/activities/1")).toBeUndefined();
    expect(await fetchPreviewImage("https://localhost/")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined on errors, non-HTML and failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await fetchPreviewImage("https://www.strava.com/activities/1")).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    expect(await fetchPreviewImage("https://www.strava.com/activities/1")).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 404, headers: { "content-type": "text/html" } }));
    expect(await fetchPreviewImage("https://www.strava.com/activities/1")).toBeUndefined();
  });
});

describe("attachPreviewImages", () => {
  const og = (u: string) => htmlResponse(`<meta property="og:image" content="${u}">`);
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const input = (over = {}) => {
    const parsed = parseRideInput({
      title: "T",
      date: "2026-10-11",
      time: "09:00",
      status: "complete",
      stravaPostUrl: "https://www.strava.com/activities/1",
      stops: [{ id: "s1", name: "Cafe", mapUrl: "https://www.google.com/maps/place/Cafe" }],
      ...over,
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.value;
  };

  it("fetches images for stops and a completed Strava post", async () => {
    fetchMock.mockImplementation(async (url: URL) =>
      og(url.hostname.endsWith("strava.com") ? "https://d1.cloudfront.net/s.png" : "https://maps.google.com/maps/api/staticmap?c=1"),
    );
    const result = await attachPreviewImages(input());
    expect(result.stops[0].imageUrl).toBe("https://maps.google.com/maps/api/staticmap?c=1");
    expect(result.stravaImageUrl).toBe("https://d1.cloudfront.net/s.png");
  });

  it("does not fetch the Strava image for upcoming rides", async () => {
    fetchMock.mockResolvedValue(og("https://maps.google.com/maps/api/staticmap?c=1"));
    const result = await attachPreviewImages(input({ status: "upcoming" }));
    expect(result.stravaImageUrl).toBeUndefined();
  });

  it("reuses stored images when links are unchanged", async () => {
    const existing = makeRide({
      status: "complete",
      stravaPostUrl: "https://www.strava.com/activities/1",
      stravaImageUrl: "https://d1.cloudfront.net/old.png",
      stops: [{ id: "s1", name: "Cafe", mapUrl: "https://www.google.com/maps/place/Cafe", imageUrl: "https://maps.google.com/old" }],
    });
    const result = await attachPreviewImages(input(), existing);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stravaImageUrl).toBe("https://d1.cloudfront.net/old.png");
    expect(result.stops[0].imageUrl).toBe("https://maps.google.com/old");
  });

  it("saves the ride even when image lookups fail", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const result = await attachPreviewImages(input());
    expect(result.stops[0].imageUrl).toBeUndefined();
  });
});

describe("image fields are server-controlled", () => {
  it("ignores image URLs sent by clients but keeps them from storage", () => {
    const payload = {
      title: "T",
      date: "2026-10-11",
      time: "09:00",
      stravaImageUrl: "https://d1.cloudfront.net/x.png",
      stops: [{ name: "Cafe", imageUrl: "https://d1.cloudfront.net/x.png" }],
    };
    const fromClient = parseRideInput(payload);
    expect(fromClient.ok && fromClient.value.stravaImageUrl).toBeUndefined();
    expect(fromClient.ok && fromClient.value.stops[0].imageUrl).toBeUndefined();

    const stored = parseStoredRide({
      ...payload,
      id: "a",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    expect(stored.ok && stored.value.stravaImageUrl).toBe("https://d1.cloudfront.net/x.png");
    expect(stored.ok && stored.value.stops[0].imageUrl).toBe("https://d1.cloudfront.net/x.png");
  });

  it("drops stored image URLs from unknown hosts", () => {
    const stored = parseStoredRide({
      title: "T",
      date: "2026-10-11",
      time: "09:00",
      stravaImageUrl: "https://evil.example/x.png",
      stops: [],
      id: "a",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    });
    expect(stored.ok && stored.value.stravaImageUrl).toBeUndefined();
  });
});

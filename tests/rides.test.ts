import { describe, expect, it } from "vitest";
import {
  applyRideInput,
  buildMonthGrid,
  clampIndex,
  findRideIndex,
  getStravaPostUrl,
  nextIndex,
  prevIndex,
  rideStartMs,
  setRideStatus,
  sortRides,
  swipeDirection,
} from "@/lib/rides";
import { makeRide } from "./fixtures";

describe("sortRides", () => {
  it("orders upcoming rides by date then time", () => {
    const rides = [
      makeRide({ id: "c", date: "2026-10-12", time: "08:00" }),
      makeRide({ id: "b", date: "2026-10-11", time: "10:00" }),
      makeRide({ id: "a", date: "2026-10-11", time: "08:00" }),
    ];
    expect(sortRides(rides).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("puts completed rides after upcoming, most recent first", () => {
    const rides = [
      makeRide({ id: "old", date: "2026-09-01", status: "complete" }),
      makeRide({ id: "later", date: "2026-12-01" }),
      makeRide({ id: "recent", date: "2026-09-20", status: "complete" }),
      makeRide({ id: "soon", date: "2026-10-11" }),
    ];
    expect(sortRides(rides).map((r) => r.id)).toEqual([
      "soon",
      "later",
      "recent",
      "old",
    ]);
  });

  it("does not mutate the input array", () => {
    const rides = [makeRide({ id: "b", date: "2026-11-01" }), makeRide({ id: "a" })];
    sortRides(rides);
    expect(rides[0].id).toBe("b");
  });

  it("respects timezones when comparing instants", () => {
    const london = makeRide({ id: "london", time: "12:00", timezone: "Europe/London" });
    const newYork = makeRide({ id: "ny", time: "09:00", timezone: "America/New_York" });
    // 09:00 New York is 13:00/14:00 UK so it starts after 12:00 London.
    expect(sortRides([newYork, london]).map((r) => r.id)).toEqual(["london", "ny"]);
  });
});

describe("rideStartMs", () => {
  it("applies BST in summer and GMT in winter", () => {
    const summer = rideStartMs({ date: "2026-07-01", time: "12:00", timezone: "Europe/London" });
    const winter = rideStartMs({ date: "2026-01-01", time: "12:00", timezone: "Europe/London" });
    expect(new Date(summer).toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(new Date(winter).toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("defaults to Europe/London", () => {
    expect(rideStartMs({ date: "2026-07-01", time: "12:00" })).toBe(
      rideStartMs({ date: "2026-07-01", time: "12:00", timezone: "Europe/London" }),
    );
  });
});

describe("carousel navigation helpers", () => {
  it("clamps indices to the list", () => {
    expect(clampIndex(-3, 4)).toBe(0);
    expect(clampIndex(9, 4)).toBe(3);
    expect(clampIndex(2, 0)).toBe(0);
  });

  it("moves next and previous without wrapping", () => {
    expect(nextIndex(0, 4)).toBe(1);
    expect(nextIndex(3, 4)).toBe(3);
    expect(prevIndex(1, 4)).toBe(0);
    expect(prevIndex(0, 4)).toBe(0);
  });

  it("finds rides by id", () => {
    const rides = [makeRide({ id: "a" }), makeRide({ id: "b" })];
    expect(findRideIndex(rides, "b")).toBe(1);
    expect(findRideIndex(rides, "zzz")).toBe(-1);
    expect(findRideIndex(rides, undefined)).toBe(-1);
  });

  it("maps swipes to directions", () => {
    expect(swipeDirection(-80, 5)).toBe(1);
    expect(swipeDirection(80, -5)).toBe(-1);
    expect(swipeDirection(20, 0)).toBe(0);
    expect(swipeDirection(-60, 90)).toBe(0);
  });
});

describe("completed ride handling", () => {
  it("marks a ride complete and reopens it, updating the timestamp", () => {
    const ride = makeRide();
    const now = new Date("2026-10-12T12:00:00Z");
    const done = setRideStatus(ride, "complete", now);
    expect(done.status).toBe("complete");
    expect(done.updatedAt).toBe(now.toISOString());
    const reopened = setRideStatus(done, "upcoming", now);
    expect(reopened.status).toBe("upcoming");
  });

  it("returns the same ride when status is unchanged", () => {
    const ride = makeRide();
    expect(setRideStatus(ride, "upcoming")).toBe(ride);
  });

  it("keeps id and createdAt when applying edits", () => {
    const ride = makeRide();
    const { id, createdAt, updatedAt, ...input } = ride;
    void id; void createdAt; void updatedAt;
    const updated = applyRideInput(ride, { ...input, title: "New" }, new Date("2027-01-01T00:00:00Z"));
    expect(updated.id).toBe(ride.id);
    expect(updated.createdAt).toBe(ride.createdAt);
    expect(updated.updatedAt).toBe("2027-01-01T00:00:00.000Z");
    expect(updated.title).toBe("New");
  });
});

describe("Strava post link handling", () => {
  const url = "https://www.strava.com/activities/123";

  it("is exposed only for completed rides", () => {
    expect(getStravaPostUrl(makeRide({ stravaPostUrl: url }))).toBeUndefined();
    expect(getStravaPostUrl(makeRide({ status: "complete", stravaPostUrl: url }))).toBe(url);
  });

  it("is undefined for completed rides without a link", () => {
    expect(getStravaPostUrl(makeRide({ status: "complete" }))).toBeUndefined();
  });
});

describe("buildMonthGrid", () => {
  it("builds Monday-first weeks and marks the ride day", () => {
    const grid = buildMonthGrid("2026-10-11");
    expect(grid.label).toBe("October 2026");
    expect(grid.day).toBe(11);
    // 1 Oct 2026 is a Thursday.
    expect(grid.weeks[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(grid.weeks.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null]);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("handles February in a leap year and months starting on Monday", () => {
    const feb = buildMonthGrid("2028-02-10");
    expect(feb.weeks.flat().filter((n) => n !== null)).toHaveLength(29);
    expect(buildMonthGrid("2026-06-01").weeks[0][0]).toBe(1);
  });
});

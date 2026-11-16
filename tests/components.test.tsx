// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RideBoard } from "@/components/RideBoard";
import { RideCard } from "@/components/RideCard";
import { makeRide } from "./fixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const rides = [
  makeRide({ id: "a", title: "Ride A" }),
  makeRide({ id: "b", title: "Ride B", date: "2026-10-18" }),
  makeRide({ id: "c", title: "Ride C", date: "2026-10-25" }),
];

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => cleanup());

function title() {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("RideBoard navigation", () => {
  it("shows the first ride, counter and live region", () => {
    render(<RideBoard rides={rides} />);
    expect(title()).toBe("Ride A");
    expect(screen.getByLabelText("Ride 1 of 3").textContent).toBe("1 / 3");
    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Ride 1 of 3: Ride A");
  });

  it("navigates with the arrow buttons and disables them at the ends", () => {
    render(<RideBoard rides={rides} />);
    const prev = screen.getByRole("button", { name: "Previous ride" });
    const next = screen.getByRole("button", { name: "Next ride" });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next);
    expect(title()).toBe("Ride B");
    expect(screen.getByLabelText("Ride 2 of 3")).toBeTruthy();
    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Ride 2 of 3: Ride B");
    fireEvent.click(next);
    expect(title()).toBe("Ride C");
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(prev);
    expect(title()).toBe("Ride B");
  });

  it("navigates with the keyboard", () => {
    render(<RideBoard rides={rides} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(title()).toBe("Ride B");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(title()).toBe("Ride A");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(title()).toBe("Ride A");
  });

  it("swipes left for next and right for previous", () => {
    render(<RideBoard rides={rides} />);
    const main = screen.getByRole("main");
    const swipe = (x0: number, x1: number, y = 100) => {
      fireEvent.touchStart(main, { touches: [{ clientX: x0, clientY: y }] });
      fireEvent.touchEnd(main, { changedTouches: [{ clientX: x1, clientY: y }] });
    };
    swipe(300, 100);
    expect(title()).toBe("Ride B");
    swipe(100, 300);
    expect(title()).toBe("Ride A");
    swipe(100, 130);
    expect(title()).toBe("Ride A");
  });

  it("updates the URL with the active ride id", () => {
    render(<RideBoard rides={rides} />);
    fireEvent.click(screen.getByRole("button", { name: "Next ride" }));
    expect(window.location.search).toBe("?ride=b");
  });

  it("opens the ride from a deep link", () => {
    render(<RideBoard rides={rides} initialRideId="c" />);
    expect(title()).toBe("Ride C");
  });

  it("shows an invalid-id state, then lets the user continue", () => {
    render(<RideBoard rides={rides} initialRideId="nope" />);
    expect(screen.getByTestId("invalid-ride").textContent).toContain("nope");
    fireEvent.click(screen.getByRole("button", { name: "Show the rides" }));
    expect(title()).toBe("Ride A");
  });

  it("hides arrows with a single ride", () => {
    render(<RideBoard rides={[rides[0]]} />);
    expect(screen.queryByRole("button", { name: "Next ride" })).toBeNull();
    expect(screen.getByLabelText("Ride 1 of 1")).toBeTruthy();
  });

  it("shows the empty state and an admin link", () => {
    render(<RideBoard rides={[]} />);
    expect(screen.getByTestId("empty-state")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add the first ride" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
  });
});

describe("RideCard", () => {
  it("renders details, maps links and stops", () => {
    render(
      <RideCard
        ride={makeRide({
          comments: "Bring lights",
          meetingLocation: { name: "Clock Tower", address: "1 High St", mapUrl: "https://maps.google.com/?q=clock" },
          stops: [
            { id: "s1", name: "Cafe One", description: "Flat whites" },
            { id: "s2", name: "Pub", mapUrl: "https://www.google.com/maps/place/Pub" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Bring lights")).toBeTruthy();
    expect(screen.getByText("Flat whites")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /Open .* in Maps/ });
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute("href")).toBe("https://maps.google.com/?q=clock");
    expect(links[1].getAttribute("href")).toContain("google.com/maps/search");
    expect(links[2].getAttribute("href")).toBe("https://www.google.com/maps/place/Pub");
    expect(links[0].getAttribute("rel")).toContain("noopener");
  });

  it("marks completed rides and shows the Strava link", () => {
    render(
      <RideCard ride={makeRide({ status: "complete", stravaPostUrl: "https://www.strava.com/activities/1" })} />,
    );
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on Strava" }).getAttribute("href")).toBe(
      "https://www.strava.com/activities/1",
    );
  });

  it("explains when a completed ride has no Strava post", () => {
    render(<RideCard ride={makeRide({ status: "complete" })} />);
    expect(screen.getByText(/No Strava post has been added/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View on Strava" })).toBeNull();
  });

  it("hides the Strava link on upcoming rides", () => {
    render(<RideCard ride={makeRide({ stravaPostUrl: "https://www.strava.com/activities/1" })} />);
    expect(screen.queryByRole("link", { name: "View on Strava" })).toBeNull();
    expect(screen.getByText("Upcoming")).toBeTruthy();
  });

  it("embeds Ride with GPS routes in a sandboxed iframe and always offers the link", () => {
    render(
      <RideCard ride={makeRide({ route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/55" } })} />,
    );
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain("https://ridewithgps.com/embeds?type=route&id=55");
    expect(frame?.hasAttribute("sandbox")).toBe(true);
    expect(screen.getByRole("link", { name: "Open route" }).getAttribute("href")).toBe(
      "https://ridewithgps.com/routes/55",
    );
  });

  it("falls back to a link card when no embed is possible", () => {
    render(<RideCard ride={makeRide({ route: { provider: "garmin", url: "https://connect.garmin.com/modern/course/1" } })} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("route-fallback")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open route" })).toBeTruthy();
  });

  it("refuses to render an invalid stored route link", () => {
    render(<RideCard ride={makeRide({ route: { provider: "other", url: "javascript:alert(1)" } })} />);
    expect(screen.getByRole("alert").textContent).toMatch(/invalid/);
    expect(screen.queryByRole("link", { name: "Open route" })).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("admin edit actions", () => {
  it("shows an Edit link for admins only", () => {
    const { unmount } = render(<RideCard ride={makeRide({ id: "r9" })} />);
    expect(screen.queryByRole("link", { name: "Edit Sunday Social" })).toBeNull();
    unmount();
    render(<RideCard ride={makeRide({ id: "r9" })} isAdmin />);
    expect(screen.getByRole("link", { name: "Edit Sunday Social" }).getAttribute("href")).toBe("/admin?edit=r9");
  });

  it("shows the Edit link on completed rides too", () => {
    render(<RideCard ride={makeRide({ id: "r9", status: "complete" })} isAdmin />);
    expect(screen.getByRole("link", { name: "Edit Sunday Social" })).toBeTruthy();
  });

  it("passes isAdmin through the board", () => {
    render(<RideBoard rides={rides} isAdmin />);
    expect(screen.getByRole("link", { name: "Edit Ride A" })).toBeTruthy();
  });
});

describe("mini calendar", () => {
  it("expands and collapses for visitors on upcoming rides", () => {
    render(<RideCard ride={makeRide({ date: "2026-10-11" })} />);
    const toggle = screen.getByRole("button", { name: "Show calendar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("mini-calendar")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId("mini-calendar").textContent).toContain("October 2026");
    expect(document.querySelector("[aria-current=date]")?.textContent).toBe("11");
    expect(screen.getByRole("button", { name: "Hide calendar" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide calendar" }));
    expect(screen.queryByTestId("mini-calendar")).toBeNull();
  });

  it("goes straight to editing the date for admins", () => {
    render(<RideCard ride={makeRide({ id: "r9" })} isAdmin />);
    expect(screen.queryByRole("button", { name: /calendar/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Edit ride date" }).getAttribute("href")).toBe(
      "/admin?edit=r9&focus=date",
    );
  });

  it("is not shown on completed rides", () => {
    render(<RideCard ride={makeRide({ status: "complete" })} />);
    expect(screen.queryByRole("button", { name: /calendar/i })).toBeNull();
  });
});

describe("ride card layout and content", () => {
  it("shows the route directly after the title and dates", () => {
    render(
      <RideCard
        ride={makeRide({
          route: { provider: "ridewithgps", url: "https://ridewithgps.com/routes/5" },
          comments: "Hi",
        })}
      />,
    );
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.slice(0, 3)).toEqual(["Sunday Social", "Route", "Meeting point"]);
  });

  it("omits the meeting point when there is none", () => {
    render(<RideCard ride={makeRide({ meetingLocation: undefined })} />);
    expect(screen.queryByText("Meeting point")).toBeNull();
  });

  it("embeds a Google Maps map for the meeting point", () => {
    render(
      <RideCard
        ride={makeRide({
          meetingLocation: { name: "Mokoko", embedUrl: "https://www.google.com/maps/embed?pb=!1m18" },
        })}
      />,
    );
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://www.google.com/maps/embed?pb=!1m18");
  });

  it("never embeds an unapproved meeting map URL", () => {
    render(
      <RideCard
        ride={makeRide({ meetingLocation: { name: "X", embedUrl: "https://evil.example/maps/embed" } })}
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows stop preview images next to the stop", () => {
    render(
      <RideCard
        ride={makeRide({
          stops: [{ id: "s1", name: "Cafe", mapUrl: "https://maps.app.goo.gl/uZGzNu2E74SU1ej38", imageUrl: "https://maps.google.com/maps/api/staticmap?c=1" }],
        })}
      />,
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://maps.google.com/maps/api/staticmap?c=1");
    expect(screen.getByRole("link", { name: /Open Cafe in Maps/ })).toBeTruthy();
  });

  it("shows the Strava embed iframe for a completed ride", () => {
    render(
      <RideCard
        ride={makeRide({
          status: "complete",
          stravaPostUrl: "https://www.strava.com/activities/20353371963",
          stravaEmbed: { type: "activity", id: "20353371963", token: "tok" },
          stravaImageUrl: "https://d1.cloudfront.net/x.png",
        })}
      />,
    );
    const src = document.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src.startsWith("https://strava-embeds.com/activity/20353371963?style=standard")).toBe(true);
    expect(src).toContain("token=tok");
    expect(document.querySelector("img")).toBeNull();
  });

  it("falls back to the Strava preview image without an embed", () => {
    render(
      <RideCard
        ride={makeRide({
          status: "complete",
          stravaPostUrl: "https://www.strava.com/activities/1",
          stravaImageUrl: "https://d1.cloudfront.net/x.png",
        })}
      />,
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://d1.cloudfront.net/x.png");
    expect(screen.getByRole("link", { name: "Open the Strava post" })).toBeTruthy();
  });

  it("hides Strava embeds and images on upcoming rides", () => {
    render(
      <RideCard
        ride={makeRide({
          stravaEmbed: { type: "activity", id: "1" },
          stravaImageUrl: "https://d1.cloudfront.net/x.png",
        })}
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});

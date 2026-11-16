// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RideForm } from "@/components/RideForm";
import { makeRide } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(fetchImpl: () => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);
  const props = {
    onSaved: vi.fn(),
    onCancel: vi.fn(),
    onSessionExpired: vi.fn(),
    onDeleted: vi.fn(),
  };
  return { fetchMock, props };
}

describe("RideForm delete", () => {
  it("has no delete button when adding a ride", () => {
    const { props } = setup(async () => new Response("{}"));
    render(<RideForm {...props} />);
    expect(screen.queryByRole("button", { name: "Delete ride" })).toBeNull();
  });

  it("asks for confirmation, then deletes", async () => {
    const { fetchMock, props } = setup(async () => new Response('{"ok":true}', { status: 200 }));
    const ride = makeRide({ id: "r1" });
    render(<RideForm ride={ride} {...props} />);
    const button = screen.getByRole("button", { name: "Delete ride" });
    expect(button.className).toContain("btn-danger");
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete ride" }));
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith(ride));
    expect(fetchMock).toHaveBeenCalledWith("/api/rides/r1", { method: "DELETE" });
  });

  it("can back out of the confirmation", () => {
    const { fetchMock, props } = setup(async () => new Response("{}"));
    render(<RideForm ride={makeRide()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Delete ride" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an expired session", async () => {
    const { props } = setup(async () => new Response("{}", { status: 401 }));
    render(<RideForm ride={makeRide()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete ride" }));
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalled());
    expect(props.onDeleted).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the ride when deleting fails", async () => {
    const { props } = setup(async () => new Response('{"error":"disk full"}', { status: 500 }));
    render(<RideForm ride={makeRide()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete ride" }));
    await screen.findByText("disk full");
    expect(props.onDeleted).not.toHaveBeenCalled();
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageError, readRides, updateRides, writeRides } from "@/lib/storage";
import { makeRide } from "./fixtures";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ride-board-"));
  file = path.join(dir, "nested", "rides.json");
  process.env.DATA_FILE_PATH = file;
});

afterEach(async () => {
  delete process.env.DATA_FILE_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("JSON storage", () => {
  it("creates the directory and an empty file when missing", async () => {
    expect(await readRides()).toEqual([]);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual([]);
  });

  it("writes and reads rides back", async () => {
    const rides = [makeRide({ id: "a" }), makeRide({ id: "b", title: "Other" })];
    await writeRides(rides);
    expect(await readRides()).toEqual(rides);
  });

  it("leaves no temp files behind", async () => {
    await writeRides([makeRide()]);
    const files = await fs.readdir(path.dirname(file));
    expect(files).toEqual(["rides.json"]);
  });

  it("serializes concurrent updates without losing writes", async () => {
    await writeRides([]);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateRides((rides) => ({
          rides: [...rides, makeRide({ id: `ride-${i}` })],
          result: null,
        })),
      ),
    );
    const rides = await readRides();
    expect(rides).toHaveLength(20);
    expect(new Set(rides.map((r) => r.id)).size).toBe(20);
  });

  it("rejects invalid data before saving and keeps the old file", async () => {
    await writeRides([makeRide({ id: "keep" })]);
    const bad = { ...makeRide({ id: "bad" }), date: "not-a-date" };
    await expect(writeRides([bad])).rejects.toBeInstanceOf(StorageError);
    expect((await readRides()).map((r) => r.id)).toEqual(["keep"]);
  });

  it("aborts the write when the updater throws", async () => {
    await writeRides([makeRide({ id: "keep" })]);
    await expect(
      updateRides(() => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect((await readRides()).map((r) => r.id)).toEqual(["keep"]);
  });

  it("keeps working after a failed update", async () => {
    await expect(updateRides(() => { throw new Error("x"); })).rejects.toThrow();
    await writeRides([makeRide({ id: "ok" })]);
    expect(await readRides()).toHaveLength(1);
  });

  it("reports malformed JSON as an invalid-data error", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    await expect(readRides()).rejects.toMatchObject({ kind: "invalid" });
  });

  it("reports invalid ride data with the failing field", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify([{ id: "x", title: "no date" }]));
    await expect(readRides()).rejects.toThrow(/invalid data at \[0\]/);
  });

  it("rejects stored data with unsafe URLs", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const ride = makeRide({ route: { provider: "other", url: "javascript:alert(1)" } });
    await fs.writeFile(file, JSON.stringify([ride]));
    await expect(readRides()).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects duplicate ids", async () => {
    await expect(writeRides([makeRide(), makeRide()])).rejects.toThrow(/Duplicate/);
  });

  it("defaults to data/rides.json under the working directory", async () => {
    delete process.env.DATA_FILE_PATH;
    const { getDataFilePath } = await import("@/lib/storage");
    expect(getDataFilePath()).toBe(path.resolve(process.cwd(), "data/rides.json"));
  });
});

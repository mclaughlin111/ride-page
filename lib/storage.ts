import { promises as fs } from "node:fs";
import path from "node:path";
import { parseStoredRides } from "./validation";
import type { Ride } from "./types";

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly kind: "read" | "write" | "invalid",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export function getDataFilePath(): string {
  const configured = process.env.DATA_FILE_PATH?.trim();
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured || "data/rides.json");
}

async function ensureFile(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, "[]\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function readFromDisk(file: string): Promise<Ride[]> {
  let content: string;
  try {
    await ensureFile(file);
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new StorageError(
      `Could not read ${path.basename(file)}: ${(error as Error).message}`,
      "read",
    );
  }

  let json: unknown;
  try {
    json = content.trim() === "" ? [] : JSON.parse(content);
  } catch {
    throw new StorageError(
      `${path.basename(file)} is not valid JSON.`,
      "invalid",
    );
  }

  const result = parseStoredRides(json);
  if (!result.ok) {
    const [field, message] = Object.entries(result.errors)[0];
    throw new StorageError(
      `${path.basename(file)} has invalid data at ${field}: ${message}`,
      "invalid",
    );
  }
  return result.value;
}

async function writeToDisk(file: string, rides: Ride[]): Promise<void> {
  const result = parseStoredRides(rides);
  if (!result.ok) {
    const [field, message] = Object.entries(result.errors)[0];
    throw new StorageError(
      `Refusing to save invalid data at ${field}: ${message}`,
      "invalid",
    );
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, `${JSON.stringify(rides, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new StorageError(
      `Could not save rides: ${(error as Error).message}`,
      "write",
    );
  }
}

// All writes in this process run one at a time. Multiple server processes
// sharing one file are not supported.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

export async function readRides(): Promise<Ride[]> {
  // Wait for any in-flight write so reads never see a half-finished update.
  await queue;
  return readFromDisk(getDataFilePath());
}

/**
 * Read, transform and save the rides as one serialized step. The updater may
 * return `{ rides, result }`; throwing inside it aborts the write.
 */
export function updateRides<T>(
  updater: (rides: Ride[]) => { rides: Ride[]; result: T },
): Promise<T> {
  return enqueue(async () => {
    const file = getDataFilePath();
    const current = await readFromDisk(file);
    const { rides, result } = updater(current);
    await writeToDisk(file, rides);
    return result;
  });
}

export function writeRides(rides: Ride[]): Promise<void> {
  return enqueue(() => writeToDisk(getDataFilePath(), rides));
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database, License } from "./types.js";

export class LicenseRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<Database> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { licenses: [] };
    }
  }

  async mutate<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const database = await this.read();
      const result = await operation(database);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
      await rename(temporary, this.filePath);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async findByHash(keyHash: string): Promise<License | undefined> {
    return (await this.read()).licenses.find((license) => license.keyHash === keyHash);
  }
}


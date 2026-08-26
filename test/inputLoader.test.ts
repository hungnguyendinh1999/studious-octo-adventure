import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { loadInputDocsFromFolder } from "../src/inputLoader.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ai-sdlc-phase1-inputloader-"));
}

test("loads all files in a folder, sorted by filename, skipping dotfiles and subdirectories", async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, "b.md"), "content b");
  await fs.writeFile(path.join(dir, "a.md"), "content a");
  await fs.writeFile(path.join(dir, ".hidden.md"), "should be skipped");
  await fs.mkdir(path.join(dir, "sub"));
  await fs.writeFile(path.join(dir, "sub", "c.md"), "should also be skipped");

  const docs = await loadInputDocsFromFolder(dir);

  assert.deepEqual(docs, [
    { filename: "a.md", content: "content a" },
    { filename: "b.md", content: "content b" },
  ]);
});

test("throws a location-specific error when the folder has no documents", async () => {
  const dir = await makeTempDir();

  await assert.rejects(
    () => loadInputDocsFromFolder(dir),
    (err: Error) => {
      assert.match(err.message, /No documents found in/);
      assert.ok(err.message.includes(dir), "error should name the folder path");
      return true;
    }
  );
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { copyUpdateFeed } from "../src/update-feed-files.js";
import { tmpdir } from "node:os";

describe("copyUpdateFeed function", () => {
  let tempSourceDir: string;
  let tempDestDir: string;

  beforeEach(async () => {
    // Create temporary directories
    const timestamp = Date.now().toString();
    tempSourceDir = path.join(tmpdir(), `update-source-${timestamp}`);
    tempDestDir = path.join(tmpdir(), `update-dest-${timestamp}`);
    
    await fs.mkdir(tempSourceDir, { recursive: true });
    await fs.mkdir(tempDestDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directories
    try {
      await fs.rm(tempSourceDir, { recursive: true, force: true });
      await fs.rm(tempDestDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("copies valid manifest and artifacts correctly", async () => {
    // Create test files in source directory
    const manifestContent = `version: 0.52.0
files:
  - url: Brava-Setup-0.52.0.exe
    sha512: NB7EGhnGiX9w3zTtDWa+kO2MDqsB6zJmKW/HURWFhzKb3aeUoyqWCGpu+NLMUpSVi1O2DgOTexgn/UftSfVXhw==
    size: 98120929
path: Brava-Setup-0.52.0.exe
sha512: NB7EGhnGiX9w3zTtDWa+kO2MDqsB6zJmKW/HURWFhzKb3aeUoyqWCGpu+NLMUpSVi1O2DgOTexgn/UftSfVXhw==
releaseDate: '2026-09-02T03:09:00.738Z'`;
    
    await fs.writeFile(path.join(tempSourceDir, "latest.yml"), manifestContent);
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe"), "installer content");
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe.blockmap"), "blockmap content");

    // Call the function
    await copyUpdateFeed(tempSourceDir, tempDestDir);

    // Verify files were copied to destination
    const destFiles = await fs.readdir(tempDestDir);
    expect(destFiles).toContain("latest.yml");
    expect(destFiles).toContain("Brava-Setup-0.52.0.exe");
    expect(destFiles).toContain("Brava-Setup-0.52.0.exe.blockmap");

    // Verify manifest content
    const copiedManifest = await fs.readFile(path.join(tempDestDir, "latest.yml"), "utf8");
    expect(copiedManifest).toContain("path: Brava-Setup-0.52.0.exe");
  });

  it("rejects when manifest is missing", async () => {
    // Create only installer and blockmap files (no manifest)
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe"), "installer content");
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe.blockmap"), "blockmap content");

    // Call the function - should throw error
    await expect(copyUpdateFeed(tempSourceDir, tempDestDir)).rejects.toThrow("Required manifest file 'latest.yml' is missing");
  });

  it("rejects when installer is missing", async () => {
    // Create manifest and blockmap but no installer
    const manifestContent = `version: 0.52.0
path: Brava-Setup-0.52.0.exe`;
    
    await fs.writeFile(path.join(tempSourceDir, "latest.yml"), manifestContent);
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe.blockmap"), "blockmap content");

    // Call the function - should throw error
    await expect(copyUpdateFeed(tempSourceDir, tempDestDir)).rejects.toThrow("Installer file missing: Brava-Setup-0.52.0.exe");
  });

  it("rejects when blockmap is missing", async () => {
    // Create manifest and installer but no blockmap
    const manifestContent = `version: 0.52.0
path: Brava-Setup-0.52.0.exe`;
    
    await fs.writeFile(path.join(tempSourceDir, "latest.yml"), manifestContent);
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe"), "installer content");

    // Call the function - should throw error
    await expect(copyUpdateFeed(tempSourceDir, tempDestDir)).rejects.toThrow("Blockmap file missing: Brava-Setup-0.52.0.exe.blockmap");
  });

  it("rejects when installer is empty", async () => {
    // Create manifest and empty installer
    const manifestContent = `version: 0.52.0
path: Brava-Setup-0.52.0.exe`;
    
    await fs.writeFile(path.join(tempSourceDir, "latest.yml"), manifestContent);
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe"), ""); // Empty file
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe.blockmap"), "blockmap content");

    // Call the function - should throw error
    await expect(copyUpdateFeed(tempSourceDir, tempDestDir)).rejects.toThrow("Installer file is empty: Brava-Setup-0.52.0.exe");
  });

  it("rejects when blockmap is empty", async () => {
    // Create manifest and non-empty installer but empty blockmap
    const manifestContent = `version: 0.52.0
path: Brava-Setup-0.52.0.exe`;
    
    await fs.writeFile(path.join(tempSourceDir, "latest.yml"), manifestContent);
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe"), "installer content");
    await fs.writeFile(path.join(tempSourceDir, "Brava-Setup-0.52.0.exe.blockmap"), ""); // Empty file

    // Call the function - should throw error
    await expect(copyUpdateFeed(tempSourceDir, tempDestDir)).rejects.toThrow("Blockmap file is empty: Brava-Setup-0.52.0.exe.blockmap");
  });
});
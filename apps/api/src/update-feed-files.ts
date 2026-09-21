import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy update feed files with validation
 * @param sourceDir - Source directory containing update files
 * @param destinationDir - Destination directory to copy files to
 */
export async function copyUpdateFeed(sourceDir: string, destinationDir: string): Promise<void> {
  try {
    // Remove and recreate the destination directory
    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.mkdir(destinationDir, { recursive: true });

    // Read source directory contents
    const files = await fs.readdir(sourceDir);

    // Validate that latest.yml exists
    if (!files.includes("latest.yml")) {
      throw new Error("Required manifest file 'latest.yml' is missing");
    }

    // Copy all files from source to destination
    for (const file of files) {
      const sourcePath = path.resolve(sourceDir, file);
      const destPath = path.resolve(destinationDir, file);
      
      await fs.copyFile(sourcePath, destPath);
    }

    // Validate the manifest file and extract installer information
    const manifestPath = path.resolve(destinationDir, "latest.yml");
    const manifestContent = await fs.readFile(manifestPath, "utf8");

    // Parse the path field from latest.yml (not hardcoded)
    const pathMatch = manifestContent.match(/path:\s*(.+)$/m);
    if (!pathMatch || !pathMatch[1]) {
      throw new Error("Could not find installer path in latest.yml");
    }

    const installerPath = pathMatch[1].trim();
    
    // Validate that the installer exists and is not empty
    const installerFullPath = path.resolve(destinationDir, installerPath);
    try {
      await fs.access(installerFullPath);
    } catch (error: any) {
      throw new Error(`Installer file missing: ${installerPath}`);
    }

    // Check that installer file is not empty
    const installerStats = await fs.stat(installerFullPath);
    if (installerStats.size === 0) {
      throw new Error(`Installer file is empty: ${installerPath}`);
    }

    // Validate that the blockmap exists and is not empty
    const blockmapPath = `${installerPath}.blockmap`;
    const blockmapFullPath = path.resolve(destinationDir, blockmapPath);
    try {
      await fs.access(blockmapFullPath);
    } catch (error: any) {
      throw new Error(`Blockmap file missing: ${blockmapPath}`);
    }

    // Check that blockmap file is not empty
    const blockmapStats = await fs.stat(blockmapFullPath);
    if (blockmapStats.size === 0) {
      throw new Error(`Blockmap file is empty: ${blockmapPath}`);
    }

    console.log("✓ Update feed validation passed");
    console.log("✓ Manifest exists");
    console.log("✓ Installer exists and is not empty");
    console.log("✓ Blockmap exists and is not empty");
  } catch (error: any) {
    console.error("Update feed copy/validation failed:", error.message);
    throw error;
  }
}
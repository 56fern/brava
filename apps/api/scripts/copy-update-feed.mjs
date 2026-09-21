import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyUpdateFeed } from "../dist/src/update-feed-files.js";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    // Define source and destination paths
    const sourceDir = path.resolve(__dirname, "../public/updates");
    const destDir = path.resolve(__dirname, "../dist/public/updates");
    
    console.log(`Copying update feed from ${sourceDir} to ${destDir}`);
    
    await copyUpdateFeed(sourceDir, destDir);
    
    console.log("✓ Update feed copied and validated successfully");
  } catch (error) {
    console.error("Update feed copy/validation failed:", error.message);
    process.exit(1);
  }
}

// Run the main function directly
await main();
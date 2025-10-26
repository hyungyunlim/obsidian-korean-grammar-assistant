import { mkdir, copyFile } from 'fs/promises';
import path from 'path';

const DEFAULT_OBSIDIAN_PATH = '/Users/hyungyunlim/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian';
const obRoot = process.env.KGA_TEST_OBSIDIAN_PATH ?? DEFAULT_OBSIDIAN_PATH;
const pluginId = 'korean-grammar-assistant';
const pluginDir = path.join(obRoot, 'plugins', pluginId);

const filesToCopy = ['main.js', 'manifest.json', 'styles.css'];

async function copyFiles() {
  console.log(`[deploy] Copying build output to ${pluginDir}`);
  await mkdir(pluginDir, { recursive: true });

  await Promise.all(
    filesToCopy.map(async (file) => {
      const src = path.join(process.cwd(), file);
      const dest = path.join(pluginDir, file);
      await copyFile(src, dest);
      console.log(`  • ${file}`);
    })
  );

  console.log('[deploy] Done. Enable/reload the plugin inside the test vault.');
}

copyFiles().catch((error) => {
  console.error('[deploy] Failed to copy files:', error);
  process.exitCode = 1;
});

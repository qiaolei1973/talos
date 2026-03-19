import { defineConfig } from "tsup";
import { copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: true,
  outDir: "dist",
  // Bundle all @talos/* packages
  noExternal: [/^@talos\//],
  external: [
    "commander",
    "prompts",
    "node:*",
    "ink",
    "react",
    "open",
    // simple-git and its dependencies (they use dynamic require)
    "simple-git",
    "@kwsites/file-exists",
    "@kwsites/promise-deferred",
  ],
  async onSuccess() {
    const { promises } = await import('fs');
    const { join } = await import('path');
    const distPath = join(process.cwd(), 'dist');

    const files = await promises.readdir(distPath);
    const jsFiles = files.filter(f => f.endsWith('.js') && !f.endsWith('.map'));

    for (const file of jsFiles) {
      const filePath = join(distPath, file);
      let content = await promises.readFile(filePath, 'utf-8');

      // Replace @/ aliases with relative paths
      content = content
        .replace(/from ['"]\/client\//g, 'from "./client/')
        .replace(/from ['"]\/ui\//g, 'from "./ui/')
        .replace(/from ['"]\/utils\//g, 'from "./utils/')
        .replace(/from ['"]\/tasks\//g, 'from "./tasks/')
        .replace(/from ['"]\/config\//g, 'from "./config/');

      await promises.writeFile(filePath, content);
    }

    // Copy daemon entry file from @talos/core
    const coreDistPath = join(process.cwd(), '../core/dist/entry.js');
    const daemonDestPath = join(distPath, 'daemon-entry.js');

    if (existsSync(coreDistPath)) {
      copyFileSync(coreDistPath, daemonDestPath);
      console.log('Copied daemon entry file to dist/daemon-entry.js');
    } else {
      console.warn(`Warning: ${coreDistPath} not found. Daemon may not work correctly.`);
    }

    // Copy ralph-cli entry file from @talos/executor
    const ralphCliPath = join(process.cwd(), '../executor/dist/ralph-cli.js');
    const ralphDestPath = join(distPath, 'ralph-cli.js');

    if (existsSync(ralphCliPath)) {
      copyFileSync(ralphCliPath, ralphDestPath);
      console.log('Copied ralph-cli.js to dist/ralph-cli.js');
    } else {
      console.warn(`Warning: ${ralphCliPath} not found. Ralph executor may not work.`);
    }

    // Copy skill.md for ralph-cli to assets directory
    const skillMdPath = join(process.cwd(), '../executor/dist/skill.md');
    const assetsDir = join(distPath, 'assets');

    // Ensure assets directory exists
    await promises.mkdir(assetsDir, { recursive: true });

    if (existsSync(skillMdPath)) {
      const skillDestPath = join(assetsDir, 'skill.md');
      copyFileSync(skillMdPath, skillDestPath);
      console.log('Copied skill.md to dist/assets/skill.md');
    } else {
      console.warn(`Warning: ${skillMdPath} not found. Ralph executor may not work correctly.`);
    }
  },
});

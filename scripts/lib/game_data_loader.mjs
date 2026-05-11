import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const PROJECT_ROOT = process.cwd();

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function compactText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

async function buildAndImport(entryFile, bundleName) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boardgame-data-loader-'));
  const bundleFile = path.join(tempDir, bundleName);

  await build({
    entryPoints: [path.join(PROJECT_ROOT, entryFile)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    alias: {
      '@': path.join(PROJECT_ROOT, 'src'),
    },
    target: ['node18'],
    logLevel: 'silent',
  });

  try {
    return await import(pathToFileURL(bundleFile).href);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function loadGameDatabase() {
  const module = await buildAndImport('src/data/gameDatabase.ts', 'gameDatabase.bundle.mjs');
  return toArray(module.GAME_DATABASE);
}

export async function loadAutoExpansionDatabase() {
  const module = await buildAndImport(
    'src/data/gameDatabaseAutoExpansion.ts',
    'gameDatabaseAutoExpansion.bundle.mjs',
  );
  return toArray(module.GAME_DATABASE_AUTO_EXPANSION);
}

export async function readJsonLines(filePath) {
  const payload = await fs.readFile(path.join(PROJECT_ROOT, filePath), 'utf8');
  return payload
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function writeJsonLines(filePath, records) {
  const absolutePath = path.join(PROJECT_ROOT, filePath);
  const payload = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, payload, 'utf8');
}


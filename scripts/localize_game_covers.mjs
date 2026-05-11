import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const coverDirName = 'game-covers';
const coverDir = path.join(projectRoot, 'public', coverDirName);
const sourceFiles = [
  path.join(projectRoot, 'src/data/gameDatabase.ts'),
  path.join(projectRoot, 'src/data/gameDatabaseExpansion.ts'),
  path.join(projectRoot, 'src/data/gameDatabaseAutoExpansion.ts'),
  path.join(projectRoot, 'src/data/gameDatabaseCatalogExpansion.ts'),
];

const entryPattern = /((?:id|"id")\s*:\s*['"])([^'"]+)(['"][\s\S]*?(?:coverUrl|"coverUrl")\s*:\s*['"])([^'"]*)(['"])/g;
const mimeExtensionMap = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function inferExtension(coverUrl, contentType = '') {
  const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();
  if (mimeExtensionMap[normalizedContentType]) {
    return mimeExtensionMap[normalizedContentType];
  }

  try {
    const pathname = new URL(coverUrl).pathname;
    const ext = path.extname(pathname).replace(/^\./, '').toLowerCase();
    if (ext) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    // Ignore malformed URLs and fall through to the default extension.
  }

  return 'jpg';
}

function localCoverPath(id, extension) {
  return `/${coverDirName}/${id}.${extension}`;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function hashHue(seed) {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }
  return hash;
}

async function findExistingLocalCover(id) {
  const existingFiles = await fs.readdir(coverDir).catch(() => []);
  const matchedFileName = existingFiles.find((fileName) => fileName.startsWith(`${id}.`));
  return matchedFileName ? `/${coverDirName}/${matchedFileName}` : null;
}

async function removeStaleLocalFiles(id) {
  const existingFiles = await fs.readdir(coverDir).catch(() => []);
  const staleFiles = existingFiles.filter((fileName) => fileName.startsWith(`${id}.`));
  await Promise.all(staleFiles.map((fileName) => fs.rm(path.join(coverDir, fileName), { force: true })));
}

async function writePlaceholderCover(id, titleCn, titleEn = '') {
  const hue = hashHue(id);
  const accentHue = (hue + 36) % 360;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840" role="img" aria-labelledby="title subtitle">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue} 88% 70%)" />
      <stop offset="100%" stop-color="hsl(${accentHue} 82% 56%)" />
    </linearGradient>
  </defs>
  <rect width="600" height="840" rx="40" fill="url(#bg)" />
  <rect x="36" y="36" width="528" height="768" rx="32" fill="rgba(255,255,255,0.78)" stroke="#111111" stroke-width="6" />
  <circle cx="512" cy="96" r="42" fill="rgba(17,17,17,0.08)" />
  <circle cx="102" cy="710" r="64" fill="rgba(17,17,17,0.08)" />
  <text id="title" x="72" y="250" font-size="56" font-weight="800" font-family="Arial, sans-serif" fill="#111111">${escapeXml(titleCn || id)}</text>
  <text id="subtitle" x="72" y="320" font-size="28" font-weight="600" font-family="Arial, sans-serif" fill="rgba(17,17,17,0.72)">${escapeXml(titleEn)}</text>
  <text x="72" y="624" font-size="30" font-weight="700" font-family="Arial, sans-serif" fill="#111111">Board Game Cover</text>
  <text x="72" y="676" font-size="22" font-weight="500" font-family="Arial, sans-serif" fill="rgba(17,17,17,0.72)">Auto-generated local fallback</text>
</svg>`;
  const relativePath = localCoverPath(id, 'svg');
  const absolutePath = path.join(projectRoot, 'public', relativePath.slice(1));

  await removeStaleLocalFiles(id);
  await fs.writeFile(absolutePath, svg, 'utf8');

  return relativePath;
}

async function downloadCover(id, coverUrl) {
  const response = await fetch(coverUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept': 'image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const extension = inferExtension(coverUrl, response.headers.get('content-type') || '');
  const relativePath = localCoverPath(id, extension);
  const absolutePath = path.join(projectRoot, 'public', relativePath.slice(1));
  const bytes = Buffer.from(await response.arrayBuffer());

  await removeStaleLocalFiles(id);
  await fs.writeFile(absolutePath, bytes);

  return relativePath;
}

async function runWithConcurrency(items, worker, concurrency = 6) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function main() {
  await fs.mkdir(coverDir, { recursive: true });

  const fileContents = new Map();
  const remoteEntries = new Map();
  const localizedEntries = new Map();
  const blankCoverEntries = new Map();

  for (const sourceFile of sourceFiles) {
    const text = await fs.readFile(sourceFile, 'utf8');
    fileContents.set(sourceFile, text);

    for (const match of text.matchAll(entryPattern)) {
      const id = match[2];
      const middle = match[3];
      const coverUrl = match[4].trim();
      const titleCn = middle.match(/(?:titleCn|"titleCn")\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? id;
      const titleEn = middle.match(/(?:titleEn|"titleEn")\s*:\s*['"]([^'"]*)['"]/)?.[1] ?? '';

      if (!coverUrl) {
        if (!blankCoverEntries.has(id)) {
          blankCoverEntries.set(id, {
            titleCn,
            titleEn,
          });
        }
        continue;
      }

      if (coverUrl.startsWith(`/${coverDirName}/`)) {
        localizedEntries.set(id, coverUrl);
        continue;
      }

      if (!remoteEntries.has(id)) {
        remoteEntries.set(id, {
          coverUrl,
          titleCn,
          titleEn,
        });
      }
    }
  }

  const localizedPathById = new Map(localizedEntries);
  let downloadedCount = 0;
  let reusedCount = 0;
  let placeholderCount = 0;

  await runWithConcurrency([...remoteEntries.entries()], async ([id, entry]) => {
    const existingLocalPath = await findExistingLocalCover(id);
    if (existingLocalPath) {
      localizedPathById.set(id, existingLocalPath);
      reusedCount += 1;
      console.log(`reused ${id} -> ${existingLocalPath}`);
      return;
    }

    try {
      const localPath = await downloadCover(id, entry.coverUrl);
      localizedPathById.set(id, localPath);
      downloadedCount += 1;
      console.log(`localized ${id} -> ${localPath}`);
    } catch (error) {
      const placeholderPath = await writePlaceholderCover(id, entry.titleCn, entry.titleEn);
      localizedPathById.set(id, placeholderPath);
      placeholderCount += 1;
      console.warn(`placeholder ${id} -> ${placeholderPath} (${error instanceof Error ? error.message : String(error)})`);
    }
  });

  await runWithConcurrency([...blankCoverEntries.entries()], async ([id]) => {
    if (localizedPathById.has(id)) {
      return;
    }

    const existingLocalPath = await findExistingLocalCover(id);
    if (!existingLocalPath) {
      return;
    }

    localizedPathById.set(id, existingLocalPath);
    reusedCount += 1;
    console.log(`reused blank ${id} -> ${existingLocalPath}`);
  });

  for (const [sourceFile, text] of fileContents.entries()) {
    const updatedText = text.replace(entryPattern, (fullMatch, start, id, middle, _coverUrl, end) => {
      const localPath = localizedPathById.get(id);
      if (!localPath) {
        return fullMatch;
      }

      return `${start}${id}${middle}${localPath}${end}`;
    });

    if (updatedText !== text) {
      await fs.writeFile(sourceFile, updatedText);
      console.log(`updated ${path.relative(projectRoot, sourceFile)}`);
    }
  }

  console.log(
    `Localized ${localizedPathById.size} game cover(s) into public/${coverDirName} `
    + `(downloaded: ${downloadedCount}, reused: ${reusedCount}, placeholders: ${placeholderCount}).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

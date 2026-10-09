import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRequire = createRequire(join(root, "apps/web/package.json"));
const engine = webRequire.resolve("tesseract.js/package.json");
const core = createRequire(engine).resolve("tesseract.js-core/package.json");
const output = join(root, "apps/web/public/ocr");
await mkdir(join(output, "core"), { recursive: true });
await mkdir(join(output, "lang"), { recursive: true });
await copyFile(join(dirname(engine), "dist/worker.min.js"), join(output, "worker.min.js"));
await copyFile(join(dirname(engine), "LICENSE.md"), join(output, "TESSERACT-JS-LICENSE.md"));
await copyFile(join(dirname(core), "LICENSE"), join(output, "CORE-LICENSE"));
for (const name of await readdir(dirname(core))) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(name)) {
    await copyFile(join(dirname(core), name), join(output, "core", name));
  }
}
const manifest = JSON.parse(await readFile(join(root, "scripts/ocr-assets.json"), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
for (const file of manifest.files) {
  const path = join(output, "lang", file.name);
  const existing = await readFile(path).catch(() => null);
  if (existing && hash(existing) === file.sha256) continue;
  const url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${file.name}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OCR 모델을 준비하지 못했습니다: ${file.name} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== file.sha256) throw new Error(`OCR 모델 검증에 실패했습니다: ${file.name}`);
  await writeFile(path, bytes);
}
console.log("한국어·영어 OCR 파일 준비 완료 (로컬 Web Worker)");

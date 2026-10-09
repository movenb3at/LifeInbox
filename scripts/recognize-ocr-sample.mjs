import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireWeb = createRequire(join(root, "apps/web/package.json"));
const { createWorker, OEM } = requireWeb("tesseract.js");
const worker = await createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
  langPath: join(root, "apps/web/public/ocr/lang"), gzip: false, cacheMethod: "none",
});
try {
  const { data } = await worker.recognize(join(root, "e2e/fixtures/ocr-korean.png"));
  assert.ok(data.text.includes("10월 20일까지 35,000원 입금해주세요."));
  await mkdir(join(root, ".local"), { recursive: true });
  await writeFile(join(root, ".local/ocr-sample-result.json"), JSON.stringify({ text: data.text, confidence: data.confidence }), "utf8");
  console.log(`한국어 샘플의 날짜·금액 판독 확인 (엔진 신뢰도 ${data.confidence}%)`);
} finally { await worker.terminate(); }

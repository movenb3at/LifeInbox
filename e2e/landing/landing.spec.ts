import { test, expect, type Page } from "@playwright/test";

const chapters = ["home", "capture", "spaces", "ocr", "automation", "overview", "search", "start"];

async function atChapter(page: Page, chapter: string) {
  await page.evaluate(id => {
    const section = document.getElementById(id)!;
    window.scrollTo({ top: section.offsetTop, behavior: "instant" });
  }, chapter);
}

test("모든 기능과 공개 링크를 정적 본문으로 제공한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator(".chapter")).toHaveCount(8);
  await expect(page.locator("h1")).toContainText("흩어진 생활 정보");
  await expect(page.locator(".example-label")).toHaveCount(6);
  await expect(page.getByRole("link", { name: "로컬에서 실행하기", exact: true })).toHaveAttribute("href", "https://github.com/movenb3at/LifeInbox/blob/main/README.md");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "webgl");
  expect(errors).toEqual([]);
});

test("실제 3D 카드가 모든 장면을 진행하고 역방향으로 돌아온다", async ({ page }) => {
  await page.goto("./");
  const stage = page.locator("#scene-stage");
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  const firstPose = await stage.getAttribute("data-pose");
  for (let i = 1; i < chapters.length; i++) {
    await atChapter(page, chapters[i]);
    await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeCloseTo(i, 1);
    expect(await stage.getAttribute("data-pose")).not.toBe(firstPose);
  }
  await atChapter(page, "ocr");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeCloseTo(3, 1);
  await atChapter(page, "home");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeCloseTo(0, 2);
  await expect(stage).toHaveAttribute("data-pose", firstPose!);
});

test("빠른 이동과 크기 변경 후에도 장면과 경로가 맞는다", async ({ page }) => {
  await page.goto("./#automation");
  const stage = page.locator("#scene-stage");
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeGreaterThan(3.8);
  await page.reload();
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeGreaterThan(3.8);
  await atChapter(page, "automation");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeCloseTo(4, 1);
  await page.setViewportSize({ width: 820, height: 900 });
  await atChapter(page, "spaces");
  await expect.poll(async () => Number(await stage.getAttribute("data-progress"))).toBeCloseTo(2, 1);
  await expect(page.locator(".chapter-navigation a[aria-current]")).toHaveAttribute("href", "#spaces");
  const size = await page.locator("canvas").evaluate(canvas => ({ width: canvas.width, rect: canvas.getBoundingClientRect().width }));
  expect(size.width / size.rect).toBeLessThanOrEqual(1.51);
});

test("데스크톱 포인터의 작은 기울기를 스크롤 위치와 합성한다", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "포인터 반응은 데스크톱에서만 제공합니다.");
  await page.goto("./");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "webgl");
  await page.mouse.move(20, 100);
  await page.waitForTimeout(500);
  const before = await page.locator("canvas").screenshot();
  await page.mouse.move(1400, 800);
  await page.waitForTimeout(500);
  const after = await page.locator("canvas").screenshot();
  expect(before.equals(after)).toBe(false);
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-progress", "0.000");
});

test("휴대폰과 좁은 화면에서 수평 넘침 없이 모델과 본문을 분리한다", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "webgl");
  for (const width of [390, 320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await atChapter(page, "home");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width < 768) {
      const model = await page.locator("#scene-stage").boundingBox();
      const text = await page.locator("#home .chapter-content").boundingBox();
      expect(text!.y).toBeGreaterThanOrEqual(model!.y + model!.height);
      const size = await page.locator("canvas").evaluate(canvas => ({ width: canvas.width, rect: canvas.getBoundingClientRect().width }));
      expect(size.width / size.rect).toBeLessThanOrEqual(1.01);
    }
  }
  await page.setViewportSize(testInfo.project.use.viewport!);
});

test("모션 감소 설정은 정적 SVG를 사용하고 런타임 변경도 반영한다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const stage = page.locator("#scene-stage");
  await expect(stage).toHaveAttribute("data-renderer", "static");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".scene-fallback")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stage).toHaveAttribute("data-renderer", "static");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-running", "false");
});

test("WebGL 초기화 실패 시에도 기능과 링크를 사용할 수 있다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (id: string, ...args: unknown[]) {
      if (id.startsWith("webgl")) return null;
      return Reflect.apply(original, this, [id, ...args]);
    } as typeof original;
  });
  await page.goto("./");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "fallback");
  await expect(page.locator(".scene-fallback")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "반복하는 정리는, 나만의 규칙으로." })).toBeVisible();
});

test("WebGL 컨텍스트 손실과 3D 청크 오류를 정적 화면으로 복구한다", async ({ page }) => {
  await page.goto("./");
  const stage = page.locator("#scene-stage");
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  await page.locator("canvas").evaluate(canvas => canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await expect(stage).toHaveAttribute("data-renderer", "fallback");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.route("**/assets/renderer-*.js", route => route.abort());
  await page.reload();
  await expect(stage).toHaveAttribute("data-renderer", "fallback");
  await expect(page.locator(".scene-fallback")).toBeVisible();
});

test("JavaScript 없이 본문, 그림, 링크와 앵커를 제공한다", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/LifeInbox/");
  await expect(page.locator(".chapter")).toHaveCount(8);
  await expect(page.locator(".scene-fallback")).toBeVisible();
  expect(await page.locator(".scene-fallback").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator(".hero-actions a").first().click();
  await expect(page).toHaveURL(/#capture$/);
  await expect(page.locator("#capture h2")).toBeVisible();
  await context.close();
});

test("키보드 바로가기와 이미지가 Pages 하위 경로에서 작동한다", async ({ page }) => {
  const broken: string[] = [];
  page.on("response", response => { if (response.status() >= 400) broken.push(response.url()); });
  await page.goto("./");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/LifeInbox\/#capture$/);
  await expect(page.locator("#capture h2")).toBeInViewport();
  await expect(page.locator(".scene-fallback")).toHaveAttribute("src", "/LifeInbox/inbox-illustration.svg");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "webgl");
  expect(broken).toEqual([]);
});

test("첫 화면과 기능 화면의 검증 이미지를 남긴다", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.locator("#scene-stage")).toHaveAttribute("data-renderer", "webgl");
  await page.screenshot({ path: `.local/landing-screenshots/${testInfo.project.name}-home.png` });
  for (const chapter of ["spaces", "ocr", "overview"]) {
    await atChapter(page, chapter);
    await expect.poll(async () => Number(await page.locator("#scene-stage").getAttribute("data-progress"))).toBeCloseTo(chapters.indexOf(chapter), 1);
    await page.screenshot({ path: `.local/landing-screenshots/${testInfo.project.name}-${chapter}.png` });
  }
});

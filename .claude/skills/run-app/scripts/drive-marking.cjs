/**
 * Drive the AI-grading marking screen in a headless browser and capture the
 * evidence crops a teacher actually sees.
 *
 * Handles the four things that otherwise waste a run (all explained in
 * SKILL.md): the pinned Chromium path, fulfilling Supabase requests from Node
 * because Chromium cannot TLS through the agent proxy, waiting for the roster
 * to hydrate well past networkidle, and the Why? / Student's work accordion
 * that only keeps one part open at a time.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules NO_PROXY=localhost,127.0.0.1 \
 *     node drive-marking.cjs --test <testId> --session session.json \
 *       --out shots/ [--parts "Q1(c),Q4(a)"] [--student 0] [--base http://localhost:3000]
 *
 * Without --parts it opens the first few parts it finds. With --parts it walks
 * exactly those, one at a time, screenshotting each.
 *
 * Prints a JSON report: per part, the crop's natural size and provenance badge.
 * A decoded image is not a correct image -- look at the screenshots.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const TEST_ID = arg("--test");
const SESSION = arg("--session");
const OUT = arg("--out", "shots");
const BASE = arg("--base", "http://localhost:3000");
const STUDENT = parseInt(arg("--student", "0"), 10);
const PARTS = (arg("--parts") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (!TEST_ID || !SESSION) {
  console.error("--test <testId> and --session <session.json> are required");
  process.exit(1);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { cookies } = JSON.parse(fs.readFileSync(SESSION, "utf8"));
  const host = new URL(BASE).hostname;

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies(
    cookies.map((c) => ({
      name: c.name, value: c.value, domain: host, path: "/",
      httpOnly: false, secure: BASE.startsWith("https"), sameSite: "Lax",
    }))
  );

  // Chromium does not trust the agent proxy's CA, so every signed Supabase URL
  // fails silently and crops render blank. Node does trust it.
  let proxied = 0, proxyFailed = 0;
  await ctx.route("**://*.supabase.co/**", async (route) => {
    try {
      const req = route.request();
      const res = await fetch(req.url(), { method: req.method() });
      const body = Buffer.from(await res.arrayBuffer());
      proxied++;
      await route.fulfill({
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" },
        body,
      });
    } catch {
      proxyFailed++;
      await route.abort();
    }
  });

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(`${BASE}/dashboard/tests/${TEST_ID}/ai-grade`, {
    waitUntil: "networkidle", timeout: 90000,
  });
  if (page.url().includes("/login")) {
    console.error("redirected to /login -- the session cookie was rejected (expired? wrong project ref?)");
    await page.screenshot({ path: path.join(OUT, "00-login.png") });
    await browser.close();
    process.exit(2);
  }

  // The roster hydrates long after networkidle.
  try {
    await page.getByText("Loading this assessment…").waitFor({ state: "detached", timeout: 60000 });
  } catch { /* already gone */ }
  const reviewButtons = page.getByRole("button", { name: /Review\s*→/ });
  await reviewButtons.first().waitFor({ state: "visible", timeout: 60000 });
  const students = await reviewButtons.count();
  await page.screenshot({ path: path.join(OUT, "01-roster.png") });

  await reviewButtons.nth(Math.min(STUDENT, students - 1)).click();
  const heading = page.getByText(/^Review —/).first();
  await heading.waitFor({ state: "visible", timeout: 90000 });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  const whys = page.getByRole("button", { name: /^Why\?$/ });
  const partCount = await whys.count();
  const wanted = PARTS.length > 0 ? PARTS : null;
  const report = [];

  const openAndCapture = async (opener, label) => {
    await opener.scrollIntoViewIfNeeded();
    await opener.click({ timeout: 8000 });
    await page.waitForTimeout(700);

    const toggle = page.getByRole("button", { name: /Student's work/ });
    if ((await toggle.count()) === 0) {
      report.push({ label, error: "no Student's work toggle -- this part has no crop" });
      return;
    }
    await toggle.first().scrollIntoViewIfNeeded();
    await toggle.first().click();
    try {
      await page.waitForFunction(() => {
        const ims = Array.from(document.querySelectorAll('img[alt*="Cropped scan region"]'));
        return ims.length > 0 && ims.every((i) => i.complete && i.naturalWidth > 0);
      }, { timeout: 40000 });
    } catch { /* reported below via naturalWidth */ }
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const im = document.querySelector('img[alt*="Cropped scan region"]');
      const badge = Array.from(document.querySelectorAll("span"))
        .find((s) => /Paper layout|Region set by you/.test(s.textContent || ""));
      return im
        ? { w: im.naturalWidth, h: im.naturalHeight, badge: badge ? badge.textContent.trim() : null }
        : null;
    });

    const safe = (label || "part").replace(/[^\w]+/g, "");
    const shot = path.join(OUT, `part-${safe}.png`);
    const img = page.locator('img[alt*="Cropped scan region"]').first();
    try {
      await img.scrollIntoViewIfNeeded();
      const box = await img.boundingBox();
      if (box) {
        await page.screenshot({
          path: shot,
          clip: {
            x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 120),
            width: Math.min(1360, box.width + 60), height: Math.min(700, box.height + 180),
          },
        });
      }
    } catch { /* screenshot is best-effort */ }

    report.push({ label, ...(info ?? { error: "crop image did not decode" }),
                  shot: fs.existsSync(shot) ? shot : null });

    // Why? is an accordion -- close before moving on or the next open is ambiguous.
    try { await toggle.first().click({ timeout: 4000 }); } catch { /* ignore */ }
    try { await opener.click({ timeout: 4000 }); } catch { /* ignore */ }
    await page.waitForTimeout(300);
  };

  if (wanted) {
    for (const label of wanted) {
      const why = page.locator(`tr:has(td:text-is("${label}")) button:text-is("Why?")`).first();
      if ((await why.count()) === 0) {
        report.push({ label, error: "no row found for this part label" });
        continue;
      }
      await openAndCapture(why, label);
    }
  } else {
    for (let i = 0; i < Math.min(partCount, 4); i++) {
      await openAndCapture(whys.nth(i), `row-${i}`);
    }
  }

  console.log(JSON.stringify({
    students, partsOnScreen: partCount,
    proxiedSupabaseRequests: proxied, proxyFailures: proxyFailed,
    consoleErrors: consoleErrors.slice(0, 10),
    report,
  }, null, 2));

  await browser.close();
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});

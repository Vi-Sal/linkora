import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
test("analyze an approved link, consume job progress and download valid audio and video", async ({
  page,
}, info) => {
  const custom = Boolean(process.env.TEST_MEDIA_URL);
  if (custom) test.setTimeout(750000);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Media link", exact: true })
    .fill(
      process.env.TEST_MEDIA_URL ||
        "https://media.w3.org/2010/05/bunny/trailer.mp4",
    );
  await page.getByRole("button", { name: "Analyze link" }).click();
  for (const kind of ["Audio", "Video"]) {
    await page
      .getByRole("button", { name: kind, exact: true })
      .click({ timeout: 90000 });
    const progress = page.waitForResponse(
      (r) => r.url().endsWith("/progress") && r.status() === 200,
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await progress;
    const link = page.getByRole("link", { name: "Download file" });
    await expect(link).toBeVisible({ timeout: custom ? 320000 : 60000 });
    const event = page.waitForEvent("download");
    await link.click();
    const d = await event;
    const out = info.outputPath(d.suggestedFilename());
    await d.saveAs(out);
    const meta = JSON.parse(
      execFileSync(
        process.env.FFPROBE_BIN || "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", out],
        { encoding: "utf8" },
      ),
    );
    expect(
      meta.streams.some(
        (s: { codec_name: string }) =>
          s.codec_name === (kind === "Audio" ? "mp3" : "h264"),
      ),
    ).toBe(true);
    expect(Number(meta.format.duration)).toBeGreaterThan(0);
  }
  await page.goto("/history");
  await expect(page.locator(".history-name")).toHaveCount(2);
});
test("all requested widths and appearances retain navigation and fit the viewport", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 375, 768, 1024, 1440, 1920])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      for (const path of ["/", "/tools", "/settings", "/history"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (path === "/" && width === 1440 && colorScheme === "light")
          await page.screenshot({
            path: info.outputPath("home.png"),
            animations: "disabled",
            fullPage: true,
          });
      }
    }
  expect(errors).toEqual([]);
});
test("English and Khmer preferences persist", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("combobox", { name: /Language/ }).selectOption("km");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "km");
  await expect(
    page.getByRole("heading", { name: "ការកំណត់", exact: true }),
  ).toBeVisible();
});

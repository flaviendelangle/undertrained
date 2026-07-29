import { chromium } from "@playwright/test";
import fs from "node:fs";

const token = fs.readFileSync("/tmp/token.txt", "utf8").trim();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
await ctx.addCookies([{ name: "next-auth.session-token", value: token, domain: "localhost", path: "/", httpOnly: true }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://localhost:3000/workouts", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/wkverify/11-list-wide.png" });

await page.goto("http://localhost:3000/workouts/new", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/wkverify/12-builder-wide.png" });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/wkverify/13-builder-mobile.png" });

console.log("errors:", errors.slice(0, 3));
await browser.close();

// Local mock UI acceptance. Uses an installed Playwright Core; no live wallet or provider credentials.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core");
const base = process.env.MERIT_QA_URL ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "only a local mock server may be mutated");
const root = process.argv[2] ?? fileURLToPath(new URL("../../output/verification/", import.meta.url));
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, "non-qn-"));
const results = { startedAt: new Date().toISOString(), mode: "simulated", base, runs: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (let run = 1; run <= 2; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const record = { run, checks: [], screenshots: [], pageErrors: errors };
    results.runs.push(record);
    const shot = async (name) => {
      const path = join(output, `run-${run}-${name}.png`);
      await page.screenshot({ path, fullPage: true });
      record.screenshots.push(path);
    };
    const persona = (name) => page.getByRole("radiogroup", { name: "Sample persona" }).getByRole("radio", { name, exact: true }).click();
    const mock = async () => {
      await page.getByText("Sample data. No real GitHub, backend or transactions.", { exact: false }).waitFor();
    };
    const indexed = (event) => page.getByText(event, { exact: true }).waitFor();
    const nav = (path) => page.locator(`a[href="${path}"]`).first().click();
    const dashboard = async (expected) => {
      await page.getByRole("link", { name: "Maintainer", exact: true }).click();
      await page.locator('a[href="/bounties/b-111"]').first().waitFor();
      if (expected) await page.waitForFunction(({ held, paid }) => {
        const read = (label) => [...document.querySelectorAll("p")].find((p) => p.textContent === label)?.parentElement?.querySelector("[aria-label]")?.getAttribute("aria-label");
        const cents = (s) => s?.replace(/[$,.]/g, "");
        return cents(read("Held in escrow")) === held && cents(read("Paid to reviewers")) === paid;
      }, { held: expected.held.toString(), paid: expected.paid.toString() });
      const read = async (label) => {
        const value = await page.getByText(label, { exact: true }).locator("..").locator("[aria-label]").first().getAttribute("aria-label");
        assert.match(value, /^\$[\d,]+\.\d{2}$/);
        return BigInt(value.replace(/[$,.]/g, ""));
      };
      return { held: await read("Held in escrow"), paid: await read("Paid to reviewers") };
    };
    try {
      // Deposit timeout: its hash survives the receipt error and only one funding event appears.
      await page.goto(`${base}/bounties/b-110`);
      await mock();
      await page.getByRole("button", { name: "Fund $5.00 USDC", exact: true }).waitFor();
      await page.evaluate(() => sessionStorage.setItem("merit.mock.fault", "receipt-timeout"));
      await page.getByRole("button", { name: "Fund $5.00 USDC", exact: true }).click();
      await page.getByText("Deposit confirmed on Arc", { exact: true }).waitFor();
      const hashes = await page.locator('a[href*="/tx/"]').evaluateAll((links) => links.map((a) => a.href));
      assert.ok(hashes.length >= 2, "allowance and deposit hashes stay visible separately");
      await shot("deposit-timeout");
      await indexed("BountyFunded");
      assert.equal(await page.getByText("BountyFunded", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: /^Fund / }).count(), 0);
      assert.ok((await page.locator('a[href*="/tx/"]').evaluateAll((links) => links.map((a) => a.href))).some((h) => hashes.includes(h)));
      record.checks.push("receipt timeout retains hash; one deposit; no Fund action while indexing resolves");

      // A known revert permits a new attempt; the allowance is not mistaken for a deposit.
      await page.goto(`${base}/bounties/b-110`);
      await page.getByRole("button", { name: "Fund $5.00 USDC", exact: true }).waitFor();
      await page.evaluate(() => sessionStorage.setItem("merit.mock.fault", "revert-after-broadcast"));
      await page.getByRole("button", { name: "Fund $5.00 USDC", exact: true }).click();
      await page.getByRole("button", { name: "Fund again", exact: true }).waitFor();
      assert.equal(await page.getByText("BountyFunded", { exact: true }).count(), 0);
      await shot("known-revert");
      await page.getByRole("button", { name: "Fund again", exact: true }).click();
      await indexed("BountyFunded");
      assert.equal(await page.getByText("BountyFunded", { exact: true }).count(), 1);
      record.checks.push("known reverted deposit permits one successful retry");

      // Exercise the create form too: the new id must not open partial-payout fixture b-111.
      await page.goto(`${base}/maintainer/new`);
      await page.getByRole("radio", { name: "7 days", exact: true }).waitFor();
      assert.equal(await page.getByRole("radio", { name: "7 days", exact: true }).getAttribute("aria-checked"), "true");
      await page.getByRole("radio", { name: "45 min", exact: true }).click();
      await page.getByText("open for 45 minutes after you create it (testnet demo).", { exact: false }).waitFor();
      await page.getByRole("button", { name: /Persist scroll position per document/ }).click();
      await page.getByRole("button", { name: "Create bounty and continue to funding", exact: true }).click();
      await page.waitForURL(/\/bounties\/b-\d+$/);
      assert.ok(Number(page.url().match(/b-(\d+)$/)[1]) > 112);
      await page.getByRole("heading", { name: "Fund this bounty", exact: true }).waitFor();
      await shot("new-bounty");
      record.checks.push("45-minute demo window is optional; new bounty receives an id above all seeded fixtures");

      for (const ordering of ["refund-first", "claim-first"]) {
        await page.goto(`${base}/bounties/b-111`); // new page intentionally restores the sample fixtures
        await mock();
        const before = await dashboard();
        await nav("/bounties/b-111");
        if (ordering === "refund-first") {
          await page.getByRole("button", { name: "Refund $6.00 USDC to the funder", exact: true }).click();
          await indexed("BountyRefunded");
          await nav("/bounties/b-111/receipt");
          await page.getByRole("heading", { name: "Unapproved funds, returned.", exact: true }).waitFor();
          await page.getByText("Waiting to be claimed", { exact: true }).waitFor();
          await shot("refunded-reward-reserved");
          await page.getByRole("link", { name: "View bounty", exact: true }).click();
        }
        await persona("Reviewer");
        await page.getByRole("button", { name: "Claim $4.00 USDC", exact: true }).click();
        await indexed("RewardPaid");
        if (ordering === "claim-first") {
          await persona("Maintainer");
          await page.getByRole("button", { name: "Refund $6.00 USDC to the funder", exact: true }).click();
          await indexed("BountyRefunded");
        }
        assert.equal(await page.getByRole("button", { name: "Refund $6.00 USDC to the funder", exact: true }).count(), 0);
        await page.getByRole("button", { name: "Try a second claim", exact: true }).click();
        await page.getByText("Duplicate claim rejected", { exact: true }).waitFor();
        assert.equal(await page.getByText("RewardPaid", { exact: true }).count(), 1);
        await shot(`${ordering}-duplicate-refused`);
        await nav("/bounties/b-111/receipt");
        await page.getByRole("heading", { name: "A good catch, rewarded.", exact: true }).waitFor();
        await page.getByText("Returned to funder", { exact: true }).waitFor();
        await shot(`${ordering}-receipt`);
        await persona("Maintainer");
        const after = await dashboard({ held: before.held - 1000n, paid: before.paid + 400n });
        assert.equal(after.held, before.held - 1000n, "ten USDC leaves escrow across payout and refund");
        assert.equal(after.paid, before.paid + 400n, "only four USDC counts as paid");
        record.checks.push(`${ordering}: four paid, six refunded, zero held; duplicate claim refused; totals correct`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/bounties/b-112`);
      await page.getByRole("button", { name: "Refund $6.00 USDC to the funder", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow at 390px");
      await shot("mobile-partial-paid");
      record.checks.push("paid remainder refund remains reachable at 390px without horizontal overflow");
      assert.deepEqual(errors, [], "no uncaught browser page errors");
      record.passed = true;
    } catch (error) {
      record.passed = false;
      record.failure = error.stack;
      await shot("failure");
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
  console.log(output);
}

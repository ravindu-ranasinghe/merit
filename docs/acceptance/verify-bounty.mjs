// Cross-check one Merit bounty: the app's API vs Arc's transaction receipts vs the escrow contract's own storage.
// Read-only: public HTTPS reads, eth_getTransactionReceipt, eth_call. No key, no signature, no transaction.
//
//   npm --prefix backend ci                    # once, provides viem
//   node docs/acceptance/verify-bounty.mjs <appBountyId> [--simulate] [--json out.json] [--api <origin>]
//
// --simulate adds eth_call simulations of claim / refundExpired from the relevant public address and reports the
// contract's refusal (e.g. AlreadyClaimed). A simulation is NOT a reverted onchain transaction; it is labelled as such.
// Exit code 1 if any check FAILs. PENDING means the chain shows something the app has not indexed (or vice versa).
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http } from "../../backend/node_modules/viem/_esm/index.js";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const appId = args.find((a) => /^\d+$/.test(a));
if (!appId) { console.error("usage: node docs/acceptance/verify-bounty.mjs <appBountyId> [--simulate] [--json out.json] [--api origin]"); process.exit(2); }
const API = (opt("--api") ?? "https://merit-theta-beige.vercel.app/api/merit").replace(/\/$/, "");
const EXPECT = { chainId: 5042002, escrow: "0x924525bf3f3a39f9c7f298e71aff43f4c27a4727", usdc: "0x3600000000000000000000000000000000000000" };
const abi = JSON.parse(readFileSync(new URL("../escrow-abi.json", import.meta.url), "utf8"));
const client = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });

const results = [];
const rec = (status, check, detail = "") => { results.push({ status, check, detail }); console.log(`${status.padEnd(7)} ${check}${detail ? `  (${detail})` : ""}`); };
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const getJson = async (path) => { const r = await fetch(`${API}${path}`); if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`); return r.json(); };

// 1. Configuration: app, RPC and the frozen SPEC values agree.
const cfg = await getJson("/config");
const chainId = await client.getChainId();
rec(cfg.chain_id === EXPECT.chainId && chainId === EXPECT.chainId ? "PASS" : "FAIL", "chain id: API /config = RPC = 5042002", `api ${cfg.chain_id}, rpc ${chainId}`);
rec(eq(cfg.escrow_address, EXPECT.escrow) ? "PASS" : "FAIL", "escrow address matches the documented deployment", cfg.escrow_address);
rec(eq(cfg.usdc_address, EXPECT.usdc) && cfg.usdc_decimals === 6 ? "PASS" : "FAIL", "USDC address and 6 decimals");
const ESCROW = cfg.escrow_address;

// 2. The app's view.
const b = await getJson(`/bounties/${appId}`);
console.log(`\napp bounty ${b.id}: status ${b.status}, onchain id ${b.onchain_bounty_id}, ${b.repo.name}#${b.pr.github_pr_number}, amount ${b.amount_units} units`);
if (b.onchain_bounty_id === null) { rec("PENDING", "no BountyFunded indexed yet; nothing onchain to compare"); finish(); }
const onchainId = BigInt(b.onchain_bounty_id);

// 3. Every indexed event matches its transaction receipt on Arc.
const seen = {};
for (const e of [...b.events].sort((x, y) => x.block_number - y.block_number || x.log_index - y.log_index)) {
  const label = `${e.event_type} tx ${e.tx_hash.slice(0, 10)}… log ${e.log_index}`;
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: e.tx_hash }); } catch { rec("FAIL", `${label}: receipt not found on Arc`); continue; }
  const log = receipt.logs.find((l) => l.logIndex === e.log_index);
  if (receipt.status !== "success") { rec("FAIL", `${label}: transaction status ${receipt.status}`); continue; }
  if (!log) { rec("FAIL", `${label}: no log at that index in the receipt`); continue; }
  if (!eq(log.address, ESCROW)) { rec("FAIL", `${label}: log emitted by ${log.address}, not the escrow`); continue; }
  const d = decodeEventLog({ abi, topics: log.topics, data: log.data });
  const argsOk = Object.entries(e.payload).every(([k, v]) => k === "bountyId" ? BigInt(v) === onchainId : (d.args[k] === undefined || eq(d.args[k], v)));
  const ok = d.eventName === e.event_type && d.args.bountyId === onchainId && Number(receipt.blockNumber) === e.block_number && argsOk;
  rec(ok ? "PASS" : "FAIL", `${label} matches the receipt (name, bounty id, block ${e.block_number}, args)`, ok ? e.explorer_url ?? "" : JSON.stringify({ decoded: d.eventName, block: Number(receipt.blockNumber) }));
  seen[e.event_type] = { ...e, decoded: d.args };
}

// 4. Contract storage agrees with the app and the events.
const [funder, expiry, paid, refunded, recipient, prHash, claimId, amount, approvedAmount] =
  await client.readContract({ address: ESCROW, abi, functionName: "bounties", args: [onchainId] });
const zero = "0x0000000000000000000000000000000000000000";
console.log(`\nescrow storage for onchain ${onchainId}: funder ${funder}, amount ${amount}, approved ${approvedAmount}, recipient ${recipient}, paid ${paid}, refunded ${refunded}, expiry ${new Date(Number(expiry) * 1000).toISOString()}`);
rec(eq(funder, b.funder_wallet ?? "") ? "PASS" : "FAIL", "funder: contract = app funder_wallet", funder);
rec(String(amount) === String(b.amount_units) ? "PASS" : "FAIL", "funded amount: contract = app (integer units)", String(amount));
rec(eq(prHash, b.pr.pr_hash) ? "PASS" : "FAIL", "PR hash: contract = app");
rec(Number(expiry) * 1000 === new Date(b.deadline).getTime() ? "PASS" : "FAIL", "expiry: contract = app deadline", b.deadline);
const expect = (flag, ev, what) => {
  if (flag && seen[ev]) rec("PASS", `${what}: contract and app agree (${ev} indexed)`);
  else if (!flag && !seen[ev]) rec("PASS", `${what}: not yet, in both contract and app`);
  else if (flag) rec("PENDING", `${what}: contract says yes but ${ev} is not indexed by the app yet`);
  else rec("FAIL", `${what}: app has ${ev} but the contract says no`);
};
expect(recipient !== zero, "RewardApproved", "approved");
expect(paid, "RewardPaid", "paid");
expect(refunded, "BountyRefunded", "refunded");
if (recipient !== zero) {
  const a = (b.approvals ?? []).find((x) => eq(x.claim_id, claimId));
  rec(a ? "PASS" : "PENDING", "approval row in the app matches the onchain claim id", claimId);
  if (a) rec(eq(a.approved_recipient, recipient) && String(a.amount_units) === String(approvedAmount) ? "PASS" : "FAIL", "approval recipient and amount: contract = app", `${recipient} ${approvedAmount}`);
  const used = await client.readContract({ address: ESCROW, abi, functionName: "claimIdUsed", args: [claimId] });
  rec(used ? "PASS" : "FAIL", "claim id is marked used on the escrow (single-use)");
  rec(!eq(recipient, funder) ? "PASS" : "FAIL", "recipient differs from funder");
}

// 5. Where the money is, from contract storage.
const paidOut = paid ? approvedAmount : 0n;
const refundedOut = refunded ? amount - approvedAmount : 0n;
console.log(`\naccounting (units): funded ${amount} / approved ${approvedAmount} / paid ${paidOut} / refunded ${refundedOut} / held ${amount - paidOut - refundedOut}`);

// 6. Optional refusal simulations (eth_call, labelled; not reverted transactions).
if (args.includes("--simulate")) {
  console.log("\nsimulations (eth_call; nothing is sent):");
  const sim = async (fn, account, expected) => {
    try {
      await client.simulateContract({ address: ESCROW, abi, functionName: fn, args: [onchainId], account });
      rec(expected ? "FAIL" : "INFO", `SIMULATION ${fn}(${onchainId}) from ${account.slice(0, 8)}… would succeed`, expected ? `expected ${expected}` : "");
    } catch (err) {
      const name = err?.cause?.data?.errorName ?? err?.data?.errorName ?? (err.shortMessage || "").match(/reverted with the following reason:\s*(\w+)|error:\s*(\w+)/)?.slice(1).find(Boolean) ?? "revert";
      rec(!expected || name === expected ? "PASS" : "FAIL", `SIMULATION ${fn}(${onchainId}) refused: ${name}`, expected ? `expected ${expected}` : "");
    }
  };
  const now = Math.floor(Date.now() / 1000);
  if (paid) await sim("claim", recipient, "AlreadyClaimed");
  else if (recipient === zero) await sim("claim", funder, "NotApprovedRecipient");
  if (now < Number(expiry)) await sim("refundExpired", funder, "NotExpired");
  else if (refunded) await sim("refundExpired", funder, "AlreadyRefunded");
  else if (approvedAmount === amount) await sim("refundExpired", funder, "NothingToRefund");
}
finish();

function finish() {
  const fails = results.filter((r) => r.status === "FAIL").length;
  const pending = results.filter((r) => r.status === "PENDING").length;
  console.log(`\n${fails ? "FAILED" : pending ? "PASSED with pending indexing" : "PASSED"}: ${results.length} checks, ${fails} fail, ${pending} pending  [${new Date().toISOString()}]`);
  const out = opt("--json");
  if (out) writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), api: API, appBountyId: Number(appId), results }, null, 2));
  process.exit(fails ? 1 : 0);
}

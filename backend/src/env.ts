import { z } from "zod";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const ZERO = "0x0000000000000000000000000000000000000000";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  CHAIN_ID: z.coerce.number().default(5042002),
  EXPLORER_URL: z.string().default("https://explorer.testnet.arc.io"),
  USDC_ADDRESS: addr.default("0x3600000000000000000000000000000000000000"),
  ESCROW_ADDRESS: addr.optional().or(z.literal("").transform(() => undefined)),
  SESSION_SECRET: z.string().min(16).optional().or(z.literal("").transform(() => undefined)),
  QN_SECURITY_TOKEN: z.string().min(1).optional().or(z.literal("").transform(() => undefined)),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // "0" turns off the PR status comment (src/github/pr-status.ts) without a redeploy of code.
  GITHUB_PR_COMMENTS: z.enum(["0", "1"]).default("1"),
  // Bearer token for POST /internal/sweep (called by a scheduler). Unset = the route does not exist.
  SWEEP_SECRET: z.string().min(16).optional().or(z.literal("").transform(() => undefined)),
});

export interface Env {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  webOrigin: string;
  chainId: number;
  explorerUrl: string;
  usdcAddress: `0x${string}`;
  escrowAddress: `0x${string}`;
  sessionSecret: string;
  qnSecurityToken: string;
  /** null = POST /internal/sweep is disabled (404). */
  sweepSecret: string | null;
  github: {
    mock: boolean;
    appId: string;
    privateKey: string;
    webhookSecret: string;
    clientId: string;
    clientSecret: string;
    /** Post and update one Merit status comment on each funded PR, driven by indexed events. */
    prComments: boolean;
  };
  warnings: string[];
}

export function loadEnv(src: Record<string, string | undefined> = process.env): Env {
  const e = schema.parse(src);
  const prod = e.NODE_ENV === "production";
  const warnings: string[] = [];
  let usedDefault = false;
  const secret = (v: string | undefined, name: string, dev: string) => {
    if (v) return v;
    if (prod) throw new Error(`${name} is required in production`);
    warnings.push(`${name} unset: using an insecure dev default`);
    usedDefault = true;
    return dev;
  };

  const sessionSecret = secret(e.SESSION_SECRET, "SESSION_SECRET", "dev-session-secret-change-me");
  const qnSecurityToken = secret(e.QN_SECURITY_TOKEN, "QN_SECURITY_TOKEN", "dev-qn-token");

  const gh = [e.GITHUB_APP_ID, e.GITHUB_PRIVATE_KEY, e.GITHUB_WEBHOOK_SECRET, e.GITHUB_CLIENT_ID, e.GITHUB_CLIENT_SECRET];
  const mock = gh.some((v) => !v);
  if (mock) {
    // Mock mode accepts `code=mock:<id>:<login>` at OAuth and a public webhook secret: dev only, never production.
    if (prod) throw new Error("GitHub App credentials are required in production (mock client is dev-only)");
    usedDefault = true;
    warnings.push("GitHub App credentials missing: running with the IN-MEMORY MOCK GitHub client. Nothing talks to github.com.");
  }
  if (usedDefault) warnings.push("DEV DEFAULT SECRETS IN USE: webhooks and sessions are forgeable by anyone who reads this repo. Never expose this instance publicly.");
  if (!e.ESCROW_ADDRESS) warnings.push("ESCROW_ADDRESS unset: using the zero address, Streams events will not match a real contract");

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    webOrigin: e.WEB_ORIGIN,
    chainId: e.CHAIN_ID,
    explorerUrl: e.EXPLORER_URL,
    usdcAddress: e.USDC_ADDRESS as `0x${string}`,
    escrowAddress: (e.ESCROW_ADDRESS ?? ZERO) as `0x${string}`,
    sessionSecret,
    qnSecurityToken,
    sweepSecret: e.SWEEP_SECRET ?? null,
    github: {
      mock,
      appId: e.GITHUB_APP_ID ?? "",
      privateKey: (e.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      webhookSecret: mock ? (e.GITHUB_WEBHOOK_SECRET ?? "dev-webhook-secret") : e.GITHUB_WEBHOOK_SECRET!,
      clientId: e.GITHUB_CLIENT_ID ?? "",
      clientSecret: e.GITHUB_CLIENT_SECRET ?? "",
      prComments: e.GITHUB_PR_COMMENTS === "1",
    },
    warnings,
  };
}

import type { Db } from "./db/index.js";
import type { Env } from "./env.js";
import type { GitHubClient } from "./github/client.js";

import type { CanonicalChain } from "./chain/canonical.js";

export interface Ctx { db: Db; env: Env; gh: GitHubClient; canonical?: CanonicalChain }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

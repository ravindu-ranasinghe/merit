import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../docs/escrow-abi.json", import.meta.url));
const target = fileURLToPath(new URL("../src/chain/escrow-abi.json", import.meta.url));
copyFileSync(source, target);

// Deletes the LOCAL development database so migrations and seed can be re-applied from scratch.
// Only touches .wrangler/state inside this project; it cannot affect a deployed database.
import { rmSync } from "node:fs";
rmSync(".wrangler/state/v3/d1", { recursive: true, force: true });
console.log("Local D1 database removed.");

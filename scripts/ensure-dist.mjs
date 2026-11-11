// wrangler needs the assets directory to exist even when Vite serves the UI in dev.
import { mkdirSync } from "node:fs";
mkdirSync("dist/client", { recursive: true });

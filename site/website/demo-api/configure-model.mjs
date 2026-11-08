import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { piModelCatalog } from "./model-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, ".local/demo/models.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(piModelCatalog(), null, 2) + "\n");
console.log(`Set CHEMRXN_PI_MODELS_PATH to ${target}`);

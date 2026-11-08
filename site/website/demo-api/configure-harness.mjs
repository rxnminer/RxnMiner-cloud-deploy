import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Pass the absolute RxnMiner-dev checkout path.');
const target = path.join(root, 'runtime/models.example.json');
const profiles = JSON.parse(await readFile(target, 'utf8'));
const models = profiles.profiles?.['openai-compat']?.config?.models;
if (!Array.isArray(models) || models.length !== 1) throw new Error('Unexpected RxnMiner model profile schema.');
// Capacity confirmed by this Qwen deployment's /v1/models response.
// Preserve the harness's original compatibility and reasoning settings.
models[0].contextWindow = 262144;
models[0].maxTokens = 32000;
await writeFile(target, JSON.stringify(profiles, null, 2) + '\n');
console.log('Configured Qwen capacity; harness prompts, extension and tools are unchanged.');

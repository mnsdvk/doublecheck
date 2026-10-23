// Writes the labelled-synthetic demo history to a data file (default data/events.jsonl).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.ts';
import { seedDemo } from '../server/seed.ts';
const file = resolve(process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'events.jsonl'));
rmSync(file, { force: true });
const s = new Store(file); seedDemo(s);
console.log(`Seeded ${s.size} synthetic records into ${file}`);

/**
 * Regenerate golden master snapshots.
 * This is run when the IR output changes intentionally (e.g., F5 fix adding
 * locators to assertion targets). Captures current build() output as the
 * new golden snapshots.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildCorpus } from './corpus';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ExecutionIRPlan } from '../../src/domain/execution-ir/types';
import type { ComponentInteraction } from '../../src/shared/component-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOTS_DIR = join(__dirname, 'snapshots');

function buildViaUnifiedPath(interactions: ComponentInteraction[]): ExecutionIRPlan {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' },
    testCaseName: 'Golden Master Test',
  };
  return buildIRPlan(input);
}

const corpus = buildCorpus();
mkdirSync(SNAPSHOTS_DIR, { recursive: true });

let count = 0;
for (const entry of corpus) {
  const plan = buildViaUnifiedPath(entry.interactions);
  const filepath = join(SNAPSHOTS_DIR, `${entry.id}.json`);
  writeFileSync(filepath, JSON.stringify(plan, null, 2));
  count++;
}

console.log(`Regenerated ${count} golden snapshots in ${SNAPSHOTS_DIR}`);

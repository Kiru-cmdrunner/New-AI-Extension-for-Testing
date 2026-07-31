/**
 * Golden Master Output Capture
 *
 * Writes baseline IR plan snapshots through the CURRENT adapter path.
 * These JSON files are the comparison baseline for post-migration differential testing.
 *
 * Run: npx vitest run tests/golden-master/capture-golden-outputs.test.ts
 *
 * Architecture: .drytis/PHASE3_DESIGN.md §9.2
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildCorpus } from './corpus';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ExecutionIRPlan } from '../../src/domain/execution-ir/types';
import type { ComponentInteraction } from '../../src/shared/component-types';

const OUTPUT_DIR = path.join(__dirname, 'snapshots');

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

describe('Capture golden outputs', () => {
  it('writes all corpus snapshots', () => {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const corpus = buildCorpus();
    const manifest: Record<string, { description: string; stepCount: number; serializedHash: string }> = {};

    for (const entry of corpus) {
      const plan = buildViaUnifiedPath(entry.interactions);
      const serialized = JSON.stringify(plan, null, 2);

      // Write individual snapshot file
      const filename = `${entry.id}.json`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), serialized);

      // Compute a simple hash for manifest
      let hash = 0;
      for (let i = 0; i < serialized.length; i++) {
        const char = serialized.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
      }

      manifest[entry.id] = {
        description: entry.description,
        stepCount: plan.steps.length,
        serializedHash: String(hash),
      };
    }

    // Write manifest
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    expect(Object.keys(manifest).length).toBe(corpus.length);
  });
});

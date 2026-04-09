/**
 * scorer.ts — Re-export scoring utilities for use by other modules.
 * The actual scoring logic lives in walker.ts but is exposed here
 * for a clean API surface.
 */

export { computeMetrics, extractComplexityNodes } from './walker';

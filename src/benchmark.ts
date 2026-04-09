/**
 * benchmark.ts — Real-time type performance benchmarking via tsserver.
 * 
 * Uses VSCode's built-in TypeScript Language Server to measure actual
 * type checking time for specific positions in the editor.
 * This supplements the AST-based static analysis with runtime performance data.
 */

import * as vscode from 'vscode';

/** Result of a benchmark measurement */
export interface BenchmarkResult {
  /** File URI */
  uri: string;
  /** Line number (0-indexed) */
  line: number;
  /** Character offset (0-indexed) */
  offset: number;
  /** Text at position */
  text: string;
  /** Quick info response time in microseconds */
  quickInfoDuration: number;
  /** Completion response time in microseconds */
  completionDuration: number;
  /** Whether the benchmark was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/** Configuration for benchmark runs */
export interface BenchmarkConfig {
  /** Number of measurements to take (median will be used) */
  iterations: number;
  /** Delay between measurements (ms) */
  delayMs: number;
  /** Timeout per measurement (ms) */
  timeoutMs: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  iterations: 3,
  delayMs: 100,
  timeoutMs: 10000,
};

/**
 * Run a benchmark on a specific position in a document.
 */
export async function benchmarkPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  config: Partial<BenchmarkConfig> = {}
): Promise<BenchmarkResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const uri = document.uri.toString();
  const line = position.line + 1; // tsserver is 1-indexed
  const offset = position.character + 1;

  // Get the word at position for context
  const wordRange = document.getWordRangeAtPosition(position);
  const text = wordRange ? document.getText(wordRange) : document.getText(document.lineAt(position).range);

  try {
    // Measure quick info (hover type information)
    const quickInfoDurations: number[] = [];
    const completionDurations: number[] = [];

    for (let i = 0; i < cfg.iterations; i++) {
      if (i > 0) {
        await sleep(cfg.delayMs);
      }

      // Quick info measurement
      try {
        const qiStart = performance.now();
        await vscode.commands.executeCommand('typescript.tsserverRequest', 'quickinfo-full', {
          file: uri,
          line,
          offset,
        });
        const qiEnd = performance.now();
        quickInfoDurations.push(Math.round((qiEnd - qiStart) * 1000)); // microseconds
      } catch {
        // quickinfo may fail for non-type positions
      }

      // Completion measurement
      try {
        const compStart = performance.now();
        await vscode.commands.executeCommand('typescript.tsserverRequest', 'completionInfo', {
          file: uri,
          line,
          offset,
          prefix: text,
        });
        const compEnd = performance.now();
        completionDurations.push(Math.round((compEnd - compStart) * 1000));
      } catch {
        // completions may fail
      }
    }

    // Use median for more stable results
    const quickInfoDuration = quickInfoDurations.length > 0
      ? median(quickInfoDurations)
      : -1;

    const completionDuration = completionDurations.length > 0
      ? median(completionDurations)
      : -1;

    return {
      uri,
      line: position.line,
      offset: position.character,
      text,
      quickInfoDuration,
      completionDuration,
      success: true,
    };
  } catch (err) {
    return {
      uri,
      line: position.line,
      offset: position.character,
      text,
      quickInfoDuration: -1,
      completionDuration: -1,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run benchmarks on all type positions in a document.
 * Returns results sorted by slowest first.
 */
export async function benchmarkDocument(
  document: vscode.TextDocument,
  positions: vscode.Position[],
  config: Partial<BenchmarkConfig> = {}
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  // Run benchmarks sequentially to avoid overloading tsserver
  for (const position of positions) {
    const result = await benchmarkPosition(document, position, config);
    if (result.success && (result.quickInfoDuration > 0 || result.completionDuration > 0)) {
      results.push(result);
    }
  }

  // Sort by combined duration (slowest first)
  results.sort((a, b) => {
    const aMax = Math.max(a.quickInfoDuration, a.completionDuration);
    const bMax = Math.max(b.quickInfoDuration, b.completionDuration);
    return bMax - aMax;
  });

  return results;
}

/**
 * Convert benchmark results to a proportional complexity score (0-100).
 * Uses the P95 of all durations as the baseline for normalization.
 */
export function benchmarkToScore(
  results: BenchmarkResult[]
): Map<number, { score: number; quickInfo: number; completion: number }> {
  const scoreMap = new Map<number, { score: number; quickInfo: number; completion: number }>();

  if (results.length === 0) {
    return scoreMap;
  }

  // Find max duration for normalization
  const maxQuickInfo = Math.max(...results.map(r => r.quickInfoDuration).filter(d => d > 0));
  const maxCompletion = Math.max(...results.map(r => r.completionDuration).filter(d => d > 0));

  for (const result of results) {
    // Proportional score: how much slower than the median
    const qiScore = result.quickInfoDuration > 0
      ? Math.min(100, Math.round((result.quickInfoDuration / Math.max(maxQuickInfo, 1)) * 100))
      : 0;

    const compScore = result.completionDuration > 0
      ? Math.min(100, Math.round((result.completionDuration / Math.max(maxCompletion, 1)) * 100))
      : 0;

    const score = Math.round((qiScore + compScore) / 2);

    scoreMap.set(result.line, { score, quickInfo: result.quickInfoDuration, completion: result.completionDuration });
  }

  return scoreMap;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

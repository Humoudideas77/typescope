/**
 * types.ts — Core type definitions for TypeScope complexity analysis.
 */

/** Raw metrics extracted from AST walking */
export interface ComplexityMetrics {
  /** Maximum nesting depth of type expressions */
  depth: number;
  /** Number of constituents in unions/intersections */
  width: number;
  /** Number of `extends` clauses in conditional types */
  conditionals: number;
  /** Number of distinct type references */
  references: Set<string>;
  /** Count of generic type parameters and their constraints */
  generics: number;
  /** Complexity of mapped type key patterns */
  mappedKeys: number;
  /** Number of `infer` declarations */
  inferSites: number;
}

/** Normalized complexity score (0-100) with full metrics breakdown */
export interface ComplexityScore {
  /** Normalized score 0-100 */
  score: number;
  /** Raw metric values */
  metrics: ComplexityMetrics;
  /** Severity category */
  severity: ComplexitySeverity;
  /** Color representation (hex) */
  color: string;
  /** CSS color for decorations */
  cssColor: string;
}

export type ComplexitySeverity = 'low' | 'medium' | 'high';

/** Per-node complexity result, mapped to source positions */
export interface NodeComplexity {
  /** File URI */
  uri: string;
  /** 0-indexed line number */
  line: number;
  /** 0-indexed column */
  column: number;
  /** End line (exclusive) */
  endLine: number;
  /** End column (exclusive) */
  endColumn: number;
  /** Text content of the node */
  text: string;
  /** Kind of AST node (e.g., 'type alias', 'variable', 'function parameter') */
  kind: string;
  /** Complexity score */
  score: ComplexityScore;
  /** Detected patterns (anti-patterns) */
  patterns: ComplexityPattern[];
}

/** Per-line complexity aggregation */
export interface LineComplexity {
  line: number;
  maxScore: number;
  avgScore: number;
  count: number;
}

/** Per-file complexity summary */
export interface FileComplexity {
  uri: string;
  fileName: string;
  nodes: NodeComplexity[];
  lines: Map<number, LineComplexity>;
  averageScore: number;
  maxScore: number;
  totalNodes: number;
  highComplexityCount: number;
}

/** Analysis result for a workspace */
export interface WorkspaceAnalysis {
  files: Map<string, FileComplexity>;
  totalFiles: number;
  totalNodes: number;
  workspaceAverageScore: number;
  timestamp: number;
}

/** Complexity pattern (anti-pattern detected) */
export interface ComplexityPattern {
  id: string;
  name: string;
  description: string;
  severity: ComplexitySeverity;
  suggestion: string;
  /** Positions where this pattern was detected */
  locations: Array<{
    line: number;
    column: number;
    text: string;
  }>;
}

/** Trend data point for tracking complexity over time */
export interface ComplexityTrendPoint {
  commit: string;
  commitMessage: string;
  timestamp: number;
  averageScore: number;
  maxScore: number;
  totalHighComplexity: number;
  fileCount: number;
}

/** Configuration for complexity thresholds */
export interface ThresholdConfig {
  low: number;
  medium: number;
}

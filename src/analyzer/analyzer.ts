/**
 * analyzer.ts — Main analyzer orchestrator for TypeScope.
 * 
 * Manages parsing, caching, file watching, and analysis scheduling.
 * All analysis runs asynchronously and never blocks the editor.
 */

import * as vscode from 'vscode';
import * as ts from 'typescript';
import { extractComplexityNodes } from './walker';
import {
  FileComplexity,
  NodeComplexity,
  LineComplexity,
  WorkspaceAnalysis,
  ThresholdConfig,
  ComplexityPattern,
} from './types';

/** Maximum age of a cached analysis before it's considered stale (ms) */
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Debounce delay for on-edit analysis (ms) */
const EDIT_DEBOUNCE_MS = 1500;

/**
 * The main TypeScope analyzer. Singleton-like class that manages
 * analysis for the entire workspace.
 */
export class TypeScopeAnalyzer {
  private context: vscode.ExtensionContext;
  private cache: Map<string, { result: FileComplexity; timestamp: number }> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private _onAnalysisComplete = new vscode.EventEmitter<Uri>();
  private _onWorkspaceAnalysisComplete = new vscode.EventEmitter<WorkspaceAnalysis>();
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  /** Fires when a single file analysis completes */
  readonly onAnalysisComplete = this._onAnalysisComplete.event;

  /** Fires when a full workspace analysis completes */
  readonly onWorkspaceAnalysisComplete = this._onWorkspaceAnalysisComplete.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.setupFileWatcher();
  }

  /** Set up a file system watcher for TypeScript files */
  private setupFileWatcher(): void {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,tsx}',
      false, // ignoreCreateEvents — analyze on open instead
      true,  // watch for changes
      false  // don't watch deletes
    );

    this.fileWatcher.onDidChange((uri) => {
      if (this.getConfig('analysis.autoOnSave', true)) {
        this.invalidateCache(uri.toString());
        this.analyzeFile(uri);
      }
    });
  }

  /** Read a VSCode configuration value */
  private getConfig<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration('typescope').get(key, defaultValue);
  }

  /** Get the current threshold configuration */
  getThresholds(): ThresholdConfig {
    return {
      low: this.getConfig('thresholds.low', 30),
      medium: this.getConfig('thresholds.medium', 60),
    };
  }

  /** Get excluded patterns */
  getExcludedPatterns(): string[] {
    return this.getConfig('excludedPatterns', ['**/node_modules/**', '**/dist/**', '**/.d.ts']);
  }

  /**
   * Analyze a single file. Returns cached result if fresh.
   */
  async analyzeFile(uri: vscode.Uri, force = false): Promise<FileComplexity | null> {
    const key = uri.toString();

    // Check cache first
    if (!force && this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.result;
      }
    }

    // Check exclusions
    const excludedPatterns = this.getExcludedPatterns();
    for (const pattern of excludedPatterns) {
      const relative = vscode.workspace.asRelativePath(uri);
      if (this.matchGlob(relative, pattern)) {
        return null;
      }
    }

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const result = this.analyzeDocument(document);

      if (result) {
        this.cache.set(key, { result, timestamp: Date.now() });
        this._onAnalysisComplete.fire(uri);
      }

      return result;
    } catch {
      // Silently fail — don't block the editor for parse errors
      return null;
    }
  }

  /**
   * Analyze an already-opened document directly.
   */
  analyzeDocument(document: vscode.TextDocument): FileComplexity | null {
    const key = document.uri.toString();

    // Skip non-TypeScript files
    if (!this.isTypeScriptFile(document)) {
      return null;
    }

    try {
      const source = document.getText();
      const sourceFile = ts.createSourceFile(
        document.fileName,
        source,
        ts.ScriptTarget.Latest,
        true // setParentNodes for proper AST walking
      );

      const thresholds = this.getThresholds();
      const nodes = extractComplexityNodes(sourceFile, document.uri.toString(), thresholds);
      const lines = this.aggregateLineComplexity(nodes);
      const averageScore = nodes.length > 0
        ? Math.round(nodes.reduce((s, n) => s + n.score.score, 0) / nodes.length)
        : 0;
      const maxScore = nodes.length > 0
        ? Math.max(...nodes.map(n => n.score.score))
        : 0;
      const highComplexityCount = nodes.filter(n => n.score.severity === 'high').length;

      const result: FileComplexity = {
        uri: document.uri.toString(),
        fileName: document.fileName,
        nodes,
        lines,
        averageScore,
        maxScore,
        totalNodes: nodes.length,
        highComplexityCount,
      };

      this.cache.set(key, { result, timestamp: Date.now() });

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Schedule an analysis with debouncing (for on-edit).
   */
  scheduleAnalysis(uri: vscode.Uri, delayMs = EDIT_DEBOUNCE_MS): void {
    const key = uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      this.invalidateCache(key);
      this.analyzeFile(uri);
    }, delayMs));
  }

  /**
   * Analyze all TypeScript files in the workspace.
   */
  async analyzeWorkspace(): Promise<WorkspaceAnalysis> {
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx}',
      '{**/node_modules/**,**/dist/**,**/.d.ts,**/out/**,**/build/**}'
    );

    const maxFiles = this.getConfig('treeView.maxFiles', 100);
    const limitedFiles = files.slice(0, maxFiles);

    const results = await Promise.allSettled(
      limitedFiles.map(uri => this.analyzeFile(uri, true))
    );

    const fileMap = new Map<string, FileComplexity>();
    let totalNodes = 0;
    let totalScore = 0;
    let scoreCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        fileMap.set(result.value.uri, result.value);
        totalNodes += result.value.totalNodes;
        if (result.value.totalNodes > 0) {
          totalScore += result.value.averageScore;
          scoreCount++;
        }
      }
    }

    const workspaceAnalysis: WorkspaceAnalysis = {
      files: fileMap,
      totalFiles: fileMap.size,
      totalNodes,
      workspaceAverageScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      timestamp: Date.now(),
    };

    this._onWorkspaceAnalysisComplete.fire(workspaceAnalysis);
    return workspaceAnalysis;
  }

  /**
   * Get cached analysis for a file.
   */
  getCachedAnalysis(uri: string): FileComplexity | null {
    const cached = this.cache.get(uri);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }
    return null;
  }

  /**
   * Invalidate the cache for a specific file.
   */
  invalidateCache(uri: string): void {
    this.cache.delete(uri);
  }

  /**
   * Clear all cached analysis.
   */
  clearAll(): void {
    this.cache.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Collect all detected patterns across analyzed files.
   */
  getAllPatterns(): ComplexityPattern[] {
    const patterns: ComplexityPattern[] = [];
    for (const cached of this.cache.values()) {
      for (const node of cached.result.nodes) {
        patterns.push(...node.patterns);
      }
    }
    return patterns;
  }

  /**
   * Aggregate node complexities per line.
   */
  private aggregateLineComplexity(nodes: NodeComplexity[]): Map<number, LineComplexity> {
    const lineMap = new Map<number, { total: number; count: number; max: number }>();

    for (const node of nodes) {
      for (let line = node.line; line <= node.endLine; line++) {
        const existing = lineMap.get(line) || { total: 0, count: 0, max: 0 };
        existing.total += node.score.score;
        existing.count += 1;
        existing.max = Math.max(existing.max, node.score.score);
        lineMap.set(line, existing);
      }
    }

    const result = new Map<number, LineComplexity>();
    for (const [line, data] of lineMap) {
      result.set(line, {
        line,
        maxScore: data.max,
        avgScore: Math.round(data.total / data.count),
        count: data.count,
      });
    }

    return result;
  }

  /**
   * Check if a document is a TypeScript file.
   */
  private isTypeScriptFile(document: vscode.TextDocument): boolean {
    const langId = document.languageId;
    return langId === 'typescript' || langId === 'typescriptreact';
  }

  /**
   * Simple glob matching for exclusion patterns.
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Normalize separators
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Convert glob to regex
    const regexStr = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{GLOBSTAR}}/g, '.*');

    const regex = new RegExp(`(^|/)${regexStr}$`);
    return regex.test(normalizedPath);
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.clearAll();
    this.fileWatcher?.dispose();
    this._onAnalysisComplete.dispose();
    this._onWorkspaceAnalysisComplete.dispose();
  }
}

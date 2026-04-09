/**
 * provider.ts — Tree data providers for the TypeScope tree view.
 * 
 * Provides two tree views:
 * 1. Complexity Explorer — file → node hierarchy with scores
 * 2. Insights & Suggestions — detected patterns and refactoring hints
 */

import * as vscode from 'vscode';
import { TypeScopeAnalyzer } from '../analyzer/analyzer';
import {
  TypeScopeTreeItem,
  WorkspaceRootItem,
  FileItem,
  ComplexityNodeItem,
  InsightItem,
} from './nodes';

/**
 * Tree data provider for the Complexity Explorer view.
 * Shows: Workspace → Files → Complexity Nodes
 */
export class ComplexityTreeProvider implements vscode.TreeDataProvider<TypeScopeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TypeScopeTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private analyzer: TypeScopeAnalyzer;
  private workspaceAnalysis: {
    totalFiles: number;
    avgScore: number;
    files: Array<{ uri: vscode.Uri; complexity: import('../analyzer/types').FileComplexity }>;
  } | null = null;

  constructor(analyzer: TypeScopeAnalyzer) {
    this.analyzer = analyzer;

    // Refresh tree when analysis completes
    this.analyzer.onAnalysisComplete(() => {
      this._onDidChangeTreeData.fire(undefined);
    });

    this.analyzer.onWorkspaceAnalysisComplete((ws) => {
      this.workspaceAnalysis = {
        totalFiles: ws.totalFiles,
        avgScore: ws.workspaceAverageScore,
        files: Array.from(ws.files.entries()).map(([uri, complexity]) => ({
          uri: vscode.Uri.parse(uri),
          complexity,
        })),
      };
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  /**
   * Refresh the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TypeScopeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TypeScopeTreeItem): TypeScopeTreeItem[] {
    if (!element) {
      // Root level — show workspace or prompt to analyze
      if (this.workspaceAnalysis) {
        return [new WorkspaceRootItem(this.workspaceAnalysis.totalFiles, this.workspaceAnalysis.avgScore)];
      }
      return [new vscode.TreeItem('Open a TypeScript file to begin analysis', vscode.TreeItemCollapsibleState.None)];
    }

    if (element instanceof WorkspaceRootItem && this.workspaceAnalysis) {
      // Show files sorted by complexity (highest first)
      const sortedFiles = [...this.workspaceAnalysis.files]
        .sort((a, b) => b.complexity.averageScore - a.complexity.averageScore);

      return sortedFiles.map(({ uri, complexity }) => new FileItem(uri, complexity));
    }

    if (element instanceof FileItem) {
      // Show complexity nodes for this file, sorted by score (highest first)
      const sorted = [...element.fileComplexity.nodes]
        .sort((a, b) => b.score.score - a.score.score);

      return sorted.map(nc => new ComplexityNodeItem(nc, element.uri));
    }

    return [];
  }

  resolveTreeItem(item: vscode.TreeItem, element: TypeScopeTreeItem): vscode.TreeItem {
    return item;
  }
}

/**
 * Tree data provider for the Insights & Suggestions view.
 * Shows detected patterns and refactoring suggestions across all analyzed files.
 */
export class InsightsTreeProvider implements vscode.TreeDataProvider<TypeScopeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TypeScopeTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private analyzer: TypeScopeAnalyzer;

  constructor(analyzer: TypeScopeAnalyzer) {
    this.analyzer = analyzer;

    this.analyzer.onAnalysisComplete(() => {
      this._onDidChangeTreeData.fire(undefined);
    });

    this.analyzer.onWorkspaceAnalysisComplete(() => {
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TypeScopeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TypeScopeTreeItem): TypeScopeTreeItem[] {
    if (element) {
      return []; // Insights are leaf nodes
    }

    // Collect all patterns from analyzed files
    const patterns = this.analyzer.getAllPatterns();
    if (patterns.length === 0) {
      return [new vscode.TreeItem('No insights yet — analyze files to detect patterns', vscode.TreeItemCollapsibleState.None)];
    }

    // Deduplicate by pattern ID and aggregate locations
    const patternMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      severity: import('../analyzer/types').ComplexitySeverity;
      suggestion: string;
      locations: Array<{ line: number; column: number; text: string }>;
      uri: string;
    }>();

    for (const pattern of patterns) {
      const existing = patternMap.get(pattern.id);
      if (existing) {
        existing.locations.push(...pattern.locations);
      } else {
        // Get URI from the first location's context
        patternMap.set(pattern.id, {
          id: pattern.id,
          name: pattern.name,
          description: pattern.description,
          severity: pattern.severity,
          suggestion: pattern.suggestion,
          locations: [...pattern.locations],
          uri: pattern.locations[0]?.text ? '' : '',
        });
      }
    }

    // Sort: high severity first, then by occurrence count
    const sorted = Array.from(patternMap.values())
      .sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        const diff = severityOrder[a.severity] - severityOrder[b.severity];
        return diff !== 0 ? diff : b.locations.length - a.locations.length;
      });

    return sorted.map(p => {
      // Find the URI from cached analysis
      let uri = vscode.Uri.parse(''); // fallback
      for (const [key, cached] of (this.analyzer as any).cache.entries()) {
        const found = cached.result.nodes.find(n =>
          n.patterns.some(pat => pat.id === p.id)
        );
        if (found) {
          uri = vscode.Uri.parse(key);
          break;
        }
      }

      return new InsightItem(
        p.id,
        p.name,
        p.severity,
        p.description,
        p.suggestion,
        p.locations,
        uri
      );
    });
  }
}

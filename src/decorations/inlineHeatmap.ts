/**
 * inlineHeatmap.ts — Inline heat map decorations for TypeScope.
 * 
 * Colors the background of type annotations and identifiers based on
 * their complexity score: green (simple) → yellow (moderate) → red (complex).
 */

import * as vscode from 'vscode';
import { FileComplexity, ComplexitySeverity } from '../analyzer/types';
import { TypeScopeAnalyzer } from '../analyzer/analyzer';

/** Decoration type keys for each severity */
const DECORATION_KEYS = ['low', 'medium', 'high'] as const;

export class InlineHeatmap {
  private analyzer: TypeScopeAnalyzer;
  private decorations: Map<string, Map<ComplexitySeverity, vscode.TextEditorDecorationType>> = new Map();
  private activeEditor: vscode.TextEditor | undefined;
  private disposable: vscode.Disposable;

  constructor(analyzer: TypeScopeAnalyzer) {
    this.analyzer = analyzer;

    // Listen for active editor changes
    this.activeEditor = vscode.window.activeTextEditor;

    const subscriptions: vscode.Disposable[] = [];

    subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.activeEditor = editor;
        this.updateDecorations();
      })
    );

    subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.activeEditor || event.document !== this.activeEditor.document) {
          return;
        }
        const autoOnEdit = vscode.workspace.getConfiguration('typescope').get('analysis.autoOnEdit', false);
        if (autoOnEdit) {
          this.analyzer.scheduleAnalysis(event.document.uri);
        }
      })
    );

    subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('typescope.heatmap') ||
            event.affectsConfiguration('typescope.thresholds')) {
          this.rebuildDecorations();
          this.updateDecorations();
        }
      })
    );

    subscriptions.push(
      this.analyzer.onAnalysisComplete(() => {
        this.updateDecorations();
      })
    );

    this.disposable = vscode.Disposable.from(...subscriptions);
  }

  /**
   * Update decorations for the active editor.
   */
  updateDecorations(): void {
    if (!this.activeEditor) {
      return;
    }

    const enabled = vscode.workspace.getConfiguration('typescope').get('heatmap.enabled', true);
    if (!enabled) {
      this.clearDecorations();
      return;
    }

    const fileUri = this.activeEditor.document.uri.toString();
    const analysis = this.analyzer.getCachedAnalysis(fileUri);
    if (!analysis) {
      this.clearDecorations();
      return;
    }

    const opacity = vscode.workspace.getConfiguration('typescope').get('heatmap.opacity', 0.15);

    // Create decorations for each severity
    const ranges: Record<ComplexitySeverity, vscode.Range[]> = {
      low: [],
      medium: [],
      high: [],
    };

    for (const node of analysis.nodes) {
      const start = new vscode.Position(node.line, node.column);
      const end = new vscode.Position(node.endLine, node.endColumn);
      ranges[node.score.severity].push(new vscode.Range(start, end));
    }

    // Apply decorations
    for (const severity of DECORATION_KEYS) {
      const decorationType = this.getDecorationType(fileUri, severity, opacity);
      this.activeEditor.setDecorations(decorationType, ranges[severity]);
    }
  }

  /**
   * Clear all decorations from the active editor.
   */
  clearDecorations(): void {
    if (!this.activeEditor) {
      return;
    }

    const fileUri = this.activeEditor.document.uri.toString();
    const fileDecorations = this.decorations.get(fileUri);
    if (fileDecorations) {
      for (const decorationType of fileDecorations.values()) {
        this.activeEditor.setDecorations(decorationType, []);
      }
    }
  }

  /**
   * Get or create a decoration type for the given file and severity.
   */
  private getDecorationType(
    fileUri: string,
    severity: ComplexitySeverity,
    opacity: number
  ): vscode.TextEditorDecorationType {
    let fileDecorations = this.decorations.get(fileUri);
    if (!fileDecorations) {
      fileDecorations = new Map();
      this.decorations.set(fileUri, fileDecorations);
    }

    let decorationType = fileDecorations.get(severity);
    if (!decorationType) {
      decorationType = this.createDecorationType(severity, opacity);
      fileDecorations.set(severity, decorationType);
    }

    return decorationType;
  }

  /**
   * Create a TextEditorDecorationType for the given severity.
   */
  private createDecorationType(severity: ComplexitySeverity, opacity: number): vscode.TextEditorDecorationType {
    const colors: Record<ComplexitySeverity, string> = {
      low: `rgba(76, 175, 80, ${opacity})`,
      medium: `rgba(255, 152, 0, ${opacity})`,
      high: `rgba(244, 67, 54, ${opacity})`,
    };

    const borderColors: Record<ComplexitySeverity, string> = {
      low: 'rgba(76, 175, 80, 0.3)',
      medium: 'rgba(255, 152, 0, 0.3)',
      high: 'rgba(244, 67, 54, 0.3)',
    };

    return vscode.window.createTextEditorDecorationType({
      backgroundColor: colors[severity],
      border: `1px solid ${borderColors[severity]}`,
      borderRadius: '2px',
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      overviewRuler: {
        color: colors[severity],
        position: vscode.OverviewRulerLane.Full,
      },
    });
  }

  /**
   * Rebuild all decoration types (when config changes).
   */
  private rebuildDecorations(): void {
    // Dispose all existing decorations
    for (const fileDecorations of this.decorations.values()) {
      for (const decorationType of fileDecorations.values()) {
        decorationType.dispose();
      }
    }
    this.decorations.clear();
  }

  dispose(): void {
    this.rebuildDecorations();
    this.disposable.dispose();
  }
}

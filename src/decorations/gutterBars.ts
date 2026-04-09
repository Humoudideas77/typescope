/**
 * gutterBars.ts — Gutter complexity bars for TypeScope.
 * 
 * Renders small colored bars in the editor gutter indicating the
 * complexity score of each line. Bar width and color reflect complexity.
 */

import * as vscode from 'vscode';
import { FileComplexity, LineComplexity, ComplexitySeverity } from '../analyzer/types';
import { TypeScopeAnalyzer } from '../analyzer/analyzer';

/** We create a pool of decoration types for different complexity levels */
const BAR_SEGMENTS = 10; // 10 segments of complexity (0-10, 10-20, ... 90-100)

export class GutterBars {
  private analyzer: TypeScopeAnalyzer;
  private decorationTypes: vscode.TextEditorDecorationType[] = [];
  private activeEditor: vscode.TextEditor | undefined;
  private disposable: vscode.Disposable;

  constructor(analyzer: TypeScopeAnalyzer) {
    this.analyzer = analyzer;
    this.activeEditor = vscode.window.activeTextEditor;

    // Build decoration type pool
    this.buildDecorationTypes();

    const subscriptions: vscode.Disposable[] = [];

    subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.activeEditor = editor;
        this.updateGutterBars();
      })
    );

    subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('typescope.gutterBars') ||
            event.affectsConfiguration('typescope.thresholds')) {
          this.buildDecorationTypes();
          this.updateGutterBars();
        }
      })
    );

    subscriptions.push(
      this.analyzer.onAnalysisComplete(() => {
        this.updateGutterBars();
      })
    );

    subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.updateGutterBars();
      })
    );

    this.disposable = vscode.Disposable.from(...subscriptions);
  }

  /**
   * Build the pool of gutter bar decoration types.
   * Each segment represents a 10-point range of complexity.
   */
  private buildDecorationTypes(): void {
    // Dispose old types
    for (const dt of this.decorationTypes) {
      dt.dispose();
    }
    this.decorationTypes = [];

    for (let i = 0; i <= BAR_SEGMENTS; i++) {
      const score = i * (100 / BAR_SEGMENTS);
      const severity = this.scoreToSeverity(score);
      const color = this.severityToColor(severity, score);

      this.decorationTypes.push(
        vscode.window.createTextEditorDecorationType({
          gutterIconPath: this.createGutterIcon(color, score),
          gutterIconSize: 'contain',
          isWholeLine: true,
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        })
      );
    }
  }

  /**
   * Create an SVG gutter icon with the given color and complexity score.
   * The bar width represents the complexity proportionally.
   */
  private createGutterIcon(color: string, score: number): vscode.Uri {
    const barWidth = Math.max(2, Math.round((score / 100) * 16));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16">
      <rect x="0" y="3" width="${barWidth}" height="10" rx="1.5" ry="1.5" fill="${color}" opacity="0.9"/>
    </svg>`;

    // Use data URI for inline SVG
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return vscode.Uri.parse(dataUri);
  }

  /**
   * Update gutter bars for the active editor.
   */
  updateGutterBars(): void {
    if (!this.activeEditor) {
      return;
    }

    const enabled = vscode.workspace.getConfiguration('typescope').get('gutterBars.enabled', true);
    if (!enabled) {
      this.clearGutterBars();
      return;
    }

    const fileUri = this.activeEditor.document.uri.toString();
    const analysis = this.analyzer.getCachedAnalysis(fileUri);
    if (!analysis) {
      this.clearGutterBars();
      return;
    }

    // Group lines by their complexity segment
    const segmentRanges: vscode.Range[][] = this.decorationTypes.map(() => []);

    for (const [lineStr, lineData] of analysis.lines) {
      const line = parseInt(lineStr, 10);
      if (line < this.activeEditor.document.lineCount) {
        const segmentIndex = Math.min(
          BAR_SEGMENTS,
          Math.floor(lineData.maxScore / (100 / BAR_SEGMENTS))
        );
        segmentRanges[segmentIndex].push(
          new vscode.Range(line, 0, line, 0)
        );
      }
    }

    // Apply decorations
    for (let i = 0; i < this.decorationTypes.length; i++) {
      this.activeEditor.setDecorations(this.decorationTypes[i], segmentRanges[i]);
    }
  }

  /**
   * Clear gutter bar decorations.
   */
  private clearGutterBars(): void {
    if (!this.activeEditor) {
      return;
    }

    for (const dt of this.decorationTypes) {
      this.activeEditor.setDecorations(dt, []);
    }
  }

  /**
   * Determine severity from a raw score.
   */
  private scoreToSeverity(score: number): ComplexitySeverity {
    const thresholds = this.analyzer.getThresholds();
    if (score <= thresholds.low) return 'low';
    if (score <= thresholds.medium) return 'medium';
    return 'high';
  }

  /**
   * Get a color for the given severity with intensity based on score.
   */
  private severityToColor(severity: ComplexitySeverity, score: number): string {
    const intensity = 0.5 + (score / 100) * 0.5; // 0.5 to 1.0

    const colors: Record<ComplexitySeverity, [number, number, number]> = {
      low: [76, 175, 80],
      medium: [255, 152, 0],
      high: [244, 67, 54],
    };

    const [r, g, b] = colors[severity];
    return `rgb(${Math.round(r * intensity)}, ${Math.round(g * intensity)}, ${Math.round(b * intensity)})`;
  }

  dispose(): void {
    for (const dt of this.decorationTypes) {
      dt.dispose();
    }
    this.decorationTypes = [];
    this.disposable.dispose();
  }
}

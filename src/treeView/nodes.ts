/**
 * nodes.ts — Tree item types for the TypeScope tree view.
 */

import * as vscode from 'vscode';
import { ComplexitySeverity, FileComplexity, NodeComplexity } from '../analyzer/types';

/**
 * Base tree item for TypeScope complexity tree.
 */
export abstract class TypeScopeTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }

  /** Tooltip showing complexity details */
  abstract get tooltip(): string | vscode.MarkdownString;
}

/**
 * Workspace root node in the tree.
 */
export class WorkspaceRootItem extends TypeScopeTreeItem {
  constructor(private totalFiles: number, private avgScore: number) {
    super(`Workspace (${totalFiles} files)`, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.description = `avg: ${avgScore}`;
    this.contextValue = 'workspace';
  }

  get tooltip(): string | vscode.MarkdownString {
    return new vscode.MarkdownString(`**Workspace Complexity**\n\n- Files analyzed: ${this.totalFiles}\n- Average score: ${this.avgScore}/100`);
  }
}

/**
 * File node in the tree.
 */
export class FileItem extends TypeScopeTreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly fileComplexity: FileComplexity
  ) {
    const fileName = vscode.workspace.asRelativePath(uri);
    super(fileName, fileComplexity.totalNodes > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('file-code', this.severityToThemeColor(fileComplexity.averageScore));
    this.description = `${fileComplexity.averageScore}/100 (${fileComplexity.totalNodes} nodes)`;
    this.contextValue = 'file';
    this.resourceUri = uri;
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [uri],
    };
  }

  get tooltip(): string | vscode.MarkdownString {
    const fc = this.fileComplexity;
    return new vscode.MarkdownString(
      `**${vscode.workspace.asRelativePath(this.uri)}**\n\n` +
      `- Average complexity: **${fc.averageScore}/100**\n` +
      `- Max complexity: **${fc.maxScore}/100**\n` +
      `- Total type nodes: ${fc.totalNodes}\n` +
      `- High complexity nodes: ${fc.highComplexityCount}`
    );
  }

  private severityToThemeColor(score: number): vscode.ThemeColor {
    if (score <= 30) return new vscode.ThemeColor('charts.green');
    if (score <= 60) return new vscode.ThemeColor('charts.yellow');
    return new vscode.ThemeColor('charts.red');
  }
}

/**
 * Individual complexity node (type alias, variable, parameter, etc.)
 */
export class ComplexityNodeItem extends TypeScopeTreeItem {
  constructor(
    public readonly nodeComplexity: NodeComplexity,
    public readonly parentUri: vscode.Uri
  ) {
    const truncatedText = nodeComplexity.text.length > 50
      ? nodeComplexity.text.substring(0, 50) + '...'
      : nodeComplexity.text;

    super(truncatedText, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('symbol-type', this.severityToThemeColor(nodeComplexity.score.score));
    this.description = `${nodeComplexity.score.score}/100`;
    this.contextValue = 'complexityNode';

    const severityIcon = nodeComplexity.score.severity === 'high' ? '🔴' :
                         nodeComplexity.score.severity === 'medium' ? '🟡' : '🟢';
    this.label = `${severityIcon} ${nodeComplexity.kind}: ${truncatedText}`;

    this.command = {
      command: 'vscode.open',
      title: 'Go to Location',
      arguments: [
        parentUri,
        { selection: new vscode.Range(nodeComplexity.line, nodeComplexity.column, nodeComplexity.line, nodeComplexity.endColumn) },
      ],
    };
  }

  get tooltip(): string | vscode.MarkdownString {
    const nc = this.nodeComplexity;
    const m = nc.score.metrics;
    let md = `**${nc.kind}** — Complexity: **${nc.score.score}/100** (${nc.score.severity})\n\n`;
    md += `**Metrics:**\n`;
    md += `- Depth: ${m.depth}\n`;
    md += `- Width: ${m.width}\n`;
    md += `- Conditionals: ${m.conditionals}\n`;
    md += `- References: ${m.references.size}\n`;
    md += `- Generics: ${m.generics}\n`;
    md += `- Mapped keys: ${m.mappedKeys}\n`;
    md += `- Infer sites: ${m.inferSites}\n`;

    if (nc.patterns.length > 0) {
      md += `\n**Patterns detected:**\n`;
      for (const p of nc.patterns) {
        md += `- ⚠️ ${p.name}: ${p.suggestion}\n`;
      }
    }

    md += `\n\`\`\`typescript\n${nc.text}\n\`\`\``;
    return new vscode.MarkdownString(md);
  }

  private severityToThemeColor(score: number): vscode.ThemeColor {
    if (score <= 30) return new vscode.ThemeColor('charts.green');
    if (score <= 60) return new vscode.ThemeColor('charts.yellow');
    return new vscode.ThemeColor('charts.red');
  }
}

/**
 * Insight/suggestion node for the Insights tree view.
 */
export class InsightItem extends TypeScopeTreeItem {
  constructor(
    public readonly patternId: string,
    public readonly patternName: string,
    public readonly severity: ComplexitySeverity,
    public readonly description: string,
    public readonly suggestion: string,
    public readonly locations: Array<{ line: number; column: number; text: string }>,
    public readonly parentUri: vscode.Uri
  ) {
    const severityIcon = severity === 'high' ? '⚠️' : severity === 'medium' ? '💡' : '✅';
    super(`${severityIcon} ${patternName} (${locations.length} occurrence${locations.length !== 1 ? 's' : ''})`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('lightbulb', this.severityToThemeColor(severity));
    this.contextValue = 'insight';
    this.tooltip = new vscode.MarkdownString(
      `**${patternName}** (${severity})\n\n${description}\n\n**Suggestion:** ${suggestion}`
    );

    if (locations.length > 0) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to First Occurrence',
        arguments: [
          parentUri,
          { selection: new vscode.Range(locations[0].line, locations[0].column, locations[0].line, locations[0].column + 20) },
        ],
      };
    }
  }

  get tooltip(): string | vscode.MarkdownString {
    return this.tooltip as vscode.MarkdownString;
  }

  private severityToThemeColor(severity: ComplexitySeverity): vscode.ThemeColor {
    if (severity === 'low') return new vscode.ThemeColor('charts.green');
    if (severity === 'medium') return new vscode.ThemeColor('charts.yellow');
    return new vscode.ThemeColor('charts.red');
  }
}

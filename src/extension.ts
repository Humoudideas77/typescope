/**
 * extension.ts — TypeScope: TypeScript Type Complexity Visualizer
 * 
 * A VSCode extension that provides zero-config AST-based type complexity
 * analysis with inline heat maps, gutter bars, tree views, code actions,
 * and trend tracking for TypeScript projects.
 * 
 * @author Humoudideas77
 * @license MIT
 */

import * as vscode from 'vscode';
import { TypeScopeAnalyzer } from './analyzer/analyzer';
import { InlineHeatmap } from './decorations/inlineHeatmap';
import { GutterBars } from './decorations/gutterBars';
import { ComplexityTreeProvider, InsightsTreeProvider } from './treeView/provider';
import { TypeScopeCodeActionProvider } from './codeActions/provider';
import { TrendTracker } from './trendTracker';

let analyzer: TypeScopeAnalyzer;
let heatmap: InlineHeatmap;
let gutterBars: GutterBars;
let trendTracker: TrendTracker;
let statusBarItem: vscode.StatusBarItem;

/**
 * Activate the TypeScope extension.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('TypeScope is now active');

  // Initialize the core analyzer
  analyzer = new TypeScopeAnalyzer(context);

  // Initialize visualization layers
  heatmap = new InlineHeatmap(analyzer);
  gutterBars = new GutterBars(analyzer);

  // Initialize trend tracker
  trendTracker = new TrendTracker(context, analyzer);

  // Initialize tree view providers
  const complexityTreeProvider = new ComplexityTreeProvider(analyzer);
  const insightsTreeProvider = new InsightsTreeProvider(analyzer);

  // Register tree views
  const complexityTreeView = vscode.window.createTreeView('typescope.fileTree', {
    treeDataProvider: complexityTreeProvider,
    showCollapseAll: true,
  });

  const insightsTreeView = vscode.window.createTreeView('typescope.insights', {
    treeDataProvider: insightsTreeProvider,
    showCollapseAll: true,
  });

  // Register code action provider
  const codeActionProvider = new TypeScopeCodeActionProvider(analyzer);
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file', language: 'typescript' },
    codeActionProvider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] }
  );

  // Also register for TSX
  const codeActionDisposableTsx = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file', language: 'typescriptreact' },
    codeActionProvider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] }
  );

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(symbol-type) TypeScope';
  statusBarItem.tooltip = 'TypeScope: TypeScript Type Complexity Visualizer';
  statusBarItem.command = 'typescope.showComplexityDetails';
  statusBarItem.show();

  // Register commands
  const commands = registerCommands(context, complexityTreeProvider, insightsTreeProvider);

  // Auto-analyze on file open
  const openListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
    const autoOnOpen = vscode.workspace.getConfiguration('typescope').get('analysis.autoOnOpen', true);
    if (autoOnOpen && isTypeScriptFile(document)) {
      await analyzer.analyzeFile(document.uri);
    }
  });

  // Update status bar on analysis complete
  const analysisListener = analyzer.onAnalysisComplete((uri) => {
    const analysis = analyzer.getCachedAnalysis(uri.toString());
    if (analysis && vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
      statusBarItem.text = `$(symbol-type) TypeScope: ${analysis.averageScore}/100 avg`;
      statusBarItem.tooltip = `File: ${analysis.fileName}\nAverage complexity: ${analysis.averageScore}/100\nMax: ${analysis.maxScore}/100\nNodes: ${analysis.totalNodes}`;
    }
  });

  // Update status bar on active editor change
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) {
      statusBarItem.text = '$(symbol-type) TypeScope';
      statusBarItem.tooltip = 'TypeScope: TypeScript Type Complexity Visualizer';
      return;
    }

    if (isTypeScriptFile(editor.document)) {
      const analysis = analyzer.getCachedAnalysis(editor.document.uri.toString());
      if (analysis) {
        statusBarItem.text = `$(symbol-type) TypeScope: ${analysis.averageScore}/100 avg`;
      } else {
        statusBarItem.text = '$(symbol-type) TypeScope: Analyzing...';
        // Trigger analysis
        analyzer.analyzeFile(editor.document.uri);
      }
    } else {
      statusBarItem.text = '$(symbol-type) TypeScope';
    }
  });

  // Push all disposables
  context.subscriptions.push(
    analyzer,
    heatmap,
    gutterBars,
    trendTracker,
    statusBarItem,
    complexityTreeView,
    insightsTreeView,
    codeActionDisposable,
    codeActionDisposableTsx,
    openListener,
    analysisListener,
    editorChangeListener,
    ...commands,
  );

  // Analyze the currently open file on activation
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (isTypeScriptFile(doc)) {
      await analyzer.analyzeFile(doc.uri);
    }
  }
}

/**
 * Register all TypeScope commands.
 */
function registerCommands(
  context: vscode.ExtensionContext,
  complexityTree: ComplexityTreeProvider,
  insightsTree: InsightsTreeProvider
): vscode.Disposable[] {
  return [
    // Toggle inline heat map
    vscode.commands.registerCommand('typescope.toggleHeatmap', async () => {
      const config = vscode.workspace.getConfiguration('typescope.heatmap');
      const current = config.get('enabled', true);
      await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`TypeScope: Heat map ${!current ? 'enabled' : 'disabled'}`);
    }),

    // Toggle gutter bars
    vscode.commands.registerCommand('typescope.toggleGutterBars', async () => {
      const config = vscode.workspace.getConfiguration('typescope.gutterBars');
      const current = config.get('enabled', true);
      await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`TypeScope: Gutter bars ${!current ? 'enabled' : 'disabled'}`);
    }),

    // Analyze current file
    vscode.commands.registerCommand('typescope.analyzeFile', async (uri?: vscode.Uri) => {
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage('No TypeScript file is currently open.');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'TypeScope: Analyzing file...',
          cancellable: false,
        },
        async () => {
          const result = await analyzer.analyzeFile(targetUri, true);
          if (result) {
            const highCount = result.highComplexityCount;
            vscode.window.showInformationMessage(
              `TypeScope: ${result.fileName} — avg complexity: ${result.averageScore}/100, ${highCount} high-complexity node${highCount !== 1 ? 's' : ''}`
            );
          } else {
            vscode.window.showWarningMessage('Could not analyze this file.');
          }
        }
      );
    }),

    // Analyze entire workspace
    vscode.commands.registerCommand('typescope.analyzeWorkspace', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'TypeScope: Analyzing workspace...',
          cancellable: false,
        },
        async (progress) => {
          const result = await analyzer.analyzeWorkspace();
          await trendTracker.recordSnapshot();

          progress.report({ message: 'Analysis complete!' });

          vscode.window.showInformationMessage(
            `TypeScope: Analyzed ${result.totalFiles} files, ${result.totalNodes} type nodes. ` +
            `Workspace average: ${result.workspaceAverageScore}/100.`
          );
        }
      );
    }),

    // Show complexity details
    vscode.commands.registerCommand('typescope.showComplexityDetails', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const analysis = analyzer.getCachedAnalysis(editor.document.uri.toString());
      if (!analysis) {
        vscode.window.showInformationMessage('No analysis available. Run "TypeScope: Analyze Current File" first.');
        return;
      }

      // Show details for the node under cursor
      const position = editor.selection.active;
      const node = analysis.nodes.find(n =>
        position.line >= n.line && position.line <= n.endLine &&
        position.character >= n.column && position.character <= n.endColumn
      );

      if (node) {
        const m = node.score.metrics;
        const details = [
          `**${node.kind}** — Score: ${node.score.score}/100 (${node.score.severity})`,
          '',
          `**Metrics:**`,
          `- Type depth: ${m.depth}`,
          `- Width (union/intersection): ${m.width}`,
          `- Conditional branches: ${m.conditionals}`,
          `- Type references: ${m.references.size} (${Array.from(m.references).join(', ')})`,
          `- Generic parameters: ${m.generics}`,
          `- Mapped type keys: ${m.mappedKeys}`,
          `- Infer sites: ${m.inferSites}`,
        ];

        if (node.patterns.length > 0) {
          details.push('', '**Detected Patterns:**');
          for (const p of node.patterns) {
            details.push(`- ⚠️ **${p.name}**: ${p.suggestion}`);
          }
        }

        details.push('', '```typescript', node.text, '```');

        vscode.window.showInformationMessage(node.score.score.toString());
      } else {
        // Show file summary
        vscode.window.showInformationMessage(
          `File: ${analysis.fileName}\n` +
          `Average complexity: ${analysis.averageScore}/100\n` +
          `Max complexity: ${analysis.maxScore}/100\n` +
          `Total type nodes: ${analysis.totalNodes}\n` +
          `High complexity: ${analysis.highComplexityCount}`
        );
      }
    }),

    // Clear analysis
    vscode.commands.registerCommand('typescope.clearAnalysis', () => {
      analyzer.clearAll();
      vscode.window.showInformationMessage('TypeScope: Analysis cleared.');
    }),

    // Refresh tree
    vscode.commands.registerCommand('typescope.refreshTree', () => {
      complexityTree.refresh();
      insightsTree.refresh();
    }),

    // Show trends
    vscode.commands.registerCommand('typescope.showTrends', () => {
      trendTracker.showTrends();
    }),

    // Configure thresholds
    vscode.commands.registerCommand('typescope.configureThresholds', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'typescope.thresholds'
      );
    }),

    // Export report
    vscode.commands.registerCommand('typescope.exportReport', async () => {
      const workspaceAnalysis = await analyzer.analyzeWorkspace();
      const report = generateTextReport(workspaceAnalysis);

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('typescope-report.md'),
        filters: { Markdown: ['md'], JSON: ['json'] },
      });

      if (uri) {
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(report));
        vscode.window.showInformationMessage(`TypeScope: Report exported to ${uri.fsPath}`);
      }
    }),
  ];
}

/**
 * Generate a text report of the workspace analysis.
 */
function generateTextReport(analysis: import('./analyzer/types').WorkspaceAnalysis): string {
  let report = '# TypeScope Complexity Report\n\n';
  report += `Generated: ${new Date(analysis.timestamp).toISOString()}\n\n`;
  report += `## Summary\n\n`;
  report += `- **Files analyzed:** ${analysis.totalFiles}\n`;
  report += `- **Total type nodes:** ${analysis.totalNodes}\n`;
  report += `- **Workspace average:** ${analysis.workspaceAverageScore}/100\n\n`;

  // Sort files by average score (highest first)
  const sortedFiles = Array.from(analysis.files.values())
    .sort((a, b) => b.averageScore - a.averageScore);

  report += `## Files by Complexity\n\n`;
  report += `| File | Avg Score | Max Score | Nodes | High Complexity |\n`;
  report += `|------|-----------|-----------|-------|----------------|\n`;

  for (const file of sortedFiles) {
    report += `| ${file.fileName} | ${file.averageScore} | ${file.maxScore} | ${file.totalNodes} | ${file.highComplexityCount} |\n`;
  }

  // Top 20 most complex nodes
  const allNodes = sortedFiles.flatMap(f =>
    f.nodes.map(n => ({ ...n, fileName: f.fileName }))
  ).sort((a, b) => b.score.score - a.score.score).slice(0, 20);

  if (allNodes.length > 0) {
    report += `\n## Top 20 Most Complex Types\n\n`;
    for (const node of allNodes) {
      report += `### ${node.fileName}:${node.line + 1} — Score: ${node.score.score}/100\n\n`;
      report += `\`\`\`typescript\n${node.text}\n\`\`\`\n\n`;
      if (node.patterns.length > 0) {
        report += `**Patterns:**\n`;
        for (const p of node.patterns) {
          report += `- ⚠️ ${p.name}: ${p.suggestion}\n`;
        }
        report += '\n';
      }
    }
  }

  return report;
}

/**
 * Check if a document is a TypeScript file.
 */
function isTypeScriptFile(document: vscode.TextDocument): boolean {
  const langId = document.languageId;
  return langId === 'typescript' || langId === 'typescriptreact';
}

/**
 * Deactivate the extension.
 */
export function deactivate(): void {
  console.log('TypeScope deactivated');
}

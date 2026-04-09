/**
 * provider.ts — Code actions for TypeScope refactoring suggestions.
 * 
 * Provides quick-fix actions for complex type patterns:
 * - Extract complex type to named type alias
 * - Simplify conditional type chain
 * - Break apart wide union/intersection
 */

import * as vscode from 'vscode';
import { TypeScopeAnalyzer } from '../analyzer/analyzer';
import { NodeComplexity, ComplexityPattern } from '../analyzer/types';

/** Minimum complexity score to show code actions */
const MIN_SCORE_FOR_ACTIONS = 40;

export class TypeScopeCodeActionProvider implements vscode.CodeActionProvider {
  private analyzer: TypeScopeAnalyzer;

  constructor(analyzer: TypeScopeAnalyzer) {
    this.analyzer = analyzer;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const uri = document.uri.toString();

    // Check if code actions are enabled
    const insightsEnabled = vscode.workspace.getConfiguration('typescope').get('insights.enabled', true);
    if (!insightsEnabled) {
      return actions;
    }

    const analysis = this.analyzer.getCachedAnalysis(uri);
    if (!analysis) {
      return actions;
    }

    // Find nodes that overlap with the current selection
    const relevantNodes = analysis.nodes.filter(node => {
      const nodeRange = new vscode.Range(node.line, node.column, node.endLine, node.endColumn);
      return nodeRange.intersection(range) !== undefined;
    });

    for (const node of relevantNodes) {
      if (node.score.score < MIN_SCORE_FOR_ACTIONS) {
        continue;
      }

      const nodeRange = new vscode.Range(node.line, node.column, node.endLine, node.endColumn);

      // Always suggest extracting to a type alias for complex types
      if (node.score.score >= MIN_SCORE_FOR_ACTIONS && node.kind !== 'type alias') {
        actions.push(this.createExtractTypeAliasAction(document, node, nodeRange));
      }

      // Pattern-specific suggestions
      for (const pattern of node.patterns) {
        switch (pattern.id) {
          case 'deep-conditional':
            actions.push(this.createSimplifyConditionalAction(document, node, nodeRange, pattern));
            break;
          case 'large-union':
            actions.push(this.createSplitUnionAction(document, node, nodeRange, pattern));
            break;
          case 'wide-intersection':
            actions.push(this.createSplitIntersectionAction(document, node, nodeRange, pattern));
            break;
          case 'recursive-type':
            actions.push(this.createAddBaseCaseAction(document, node, nodeRange, pattern));
            break;
        }
      }
    }

    return actions;
  }

  /**
   * "Extract to type alias" action.
   */
  private createExtractTypeAliasAction(
    document: vscode.TextDocument,
    node: NodeComplexity,
    range: vscode.Range
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `TypeScope: Extract complex type to alias (score: ${node.score.score})`,
      vscode.CodeActionKind.QuickFix
    );

    // Generate a type alias name
    const aliasName = this.generateTypeName(node, document);
    const typeText = document.getText(range);
    const indent = ' '.repeat(range.start.character);

    // Build the edit: replace the inline type with the alias name and add the alias above
    const edit = new vscode.WorkspaceEdit();

    // Insert the type alias before the containing statement
    const lineContent = document.lineAt(node.line).text;
    const statementStart = document.lineAt(node.line).range.start;

    edit.insert(document.uri, statementStart, `type ${aliasName} = ${typeText};\n${indent}`);

    // Replace the inline type with the alias name
    edit.replace(document.uri, range, aliasName);

    action.edit = edit;
    action.isPreferred = true;

    // Add diagnostic
    const diagnostic = new vscode.Diagnostic(
      range,
      `Complex type (score: ${node.score.score}/100). Consider extracting to a named type alias for clarity.`,
      vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = 'TypeScope';
    action.diagnostics = [diagnostic];

    return action;
  }

  /**
   * "Simplify conditional type" action — suggests restructuring.
   */
  private createSimplifyConditionalAction(
    document: vscode.TextDocument,
    node: NodeComplexity,
    range: vscode.Range,
    pattern: ComplexityPattern
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `TypeScope: Simplify nested conditional type`,
      vscode.CodeActionKind.Refactor
    );

    // This is a suggestion — we don't auto-fix conditionals, just provide guidance
    action.edit = undefined;
    action.command = {
      command: 'vscode.open',
      title: 'Open Documentation',
      arguments: [
        vscode.Uri.parse('https://www.typescriptlang.org/docs/handbook/2/conditional-types.html'),
      ],
    };

    const diagnostic = new vscode.Diagnostic(
      range,
      pattern.suggestion,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'TypeScope';
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, range),
        `Complexity score: ${node.score.score}/100 — ${pattern.description}`
      ),
    ];
    action.diagnostics = [diagnostic];

    return action;
  }

  /**
   * "Split large union" action.
   */
  private createSplitUnionAction(
    document: vscode.TextDocument,
    node: NodeComplexity,
    range: vscode.Range,
    pattern: ComplexityPattern
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `TypeScope: Split large union into smaller groups`,
      vscode.CodeActionKind.Refactor
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      pattern.suggestion,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'TypeScope';
    action.diagnostics = [diagnostic];

    return action;
  }

  /**
   * "Split wide intersection" action.
   */
  private createSplitIntersectionAction(
    document: vscode.TextDocument,
    node: NodeComplexity,
    range: vscode.Range,
    pattern: ComplexityPattern
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `TypeScope: Compose intersection in stages`,
      vscode.CodeActionKind.Refactor
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      pattern.suggestion,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'TypeScope';
    action.diagnostics = [diagnostic];

    return action;
  }

  /**
   * "Add base case" action for recursive types.
   */
  private createAddBaseCaseAction(
    document: vscode.TextDocument,
    node: NodeComplexity,
    range: vscode.Range,
    pattern: ComplexityPattern
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `TypeScope: Review recursive type for termination`,
      vscode.CodeActionKind.Refactor
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      pattern.suggestion,
      vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = 'TypeScope';
    action.diagnostics = [diagnostic];

    return action;
  }

  /**
   * Generate a sensible type alias name based on context.
   */
  private generateTypeName(node: NodeComplexity, document: vscode.TextDocument): string {
    // Try to infer from the variable/function/parameter name
    const lineContent = document.lineAt(node.line).text;

    // Match common patterns: const foo: Type, function foo(...): Type, etc.
    const nameMatch = lineContent.match(/(?:const|let|var|function|class)\s+(\w+)/);
    if (nameMatch) {
      const baseName = nameMatch[1];
      return `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Type`;
    }

    // Match parameter: (param: Type)
    const paramMatch = lineContent.match(/(\w+)\s*:/);
    if (paramMatch) {
      const baseName = paramMatch[1];
      return `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Type`;
    }

    return `ComplexType${node.line}`;
  }
}

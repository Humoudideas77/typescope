/**
 * trendTracker.ts — Track type complexity changes over git commits.
 * 
 * Runs analysis on previous versions of files using git show,
 * compares with current analysis, and stores trend data.
 */

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';
import { TypeScopeAnalyzer } from './analyzer/analyzer';
import { ComplexityTrendPoint } from './analyzer/types';

/** Storage key for trend data */
const TREND_STORAGE_KEY = 'typescope.trends';

/** Maximum number of data points to keep */
const MAX_TREND_POINTS = 50;

export class TrendTracker {
  private context: vscode.ExtensionContext;
  private analyzer: TypeScopeAnalyzer;
  private disposable: vscode.Disposable;

  constructor(context: vscode.ExtensionContext, analyzer: TypeScopeAnalyzer) {
    this.context = context;
    this.analyzer = analyzer;

    // Register commands
    this.disposable = vscode.Disposable.from(
      vscode.commands.registerCommand('typescope.showTrends', () => this.showTrends())
    );
  }

  /**
   * Record the current complexity as a trend data point.
   */
  async recordSnapshot(): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('typescope').get('trends.enabled', true);
    if (!enabled) {
      return;
    }

    try {
      const commit = this.getGitCommit();
      const commitMessage = this.getGitCommitMessage();
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        return;
      }

      // Run workspace analysis
      const analysis = await this.analyzer.analyzeWorkspace();

      const point: ComplexityTrendPoint = {
        commit,
        commitMessage,
        timestamp: Date.now(),
        averageScore: analysis.workspaceAverageScore,
        maxScore: Math.max(...Array.from(analysis.files.values()).map(f => f.maxScore), 0),
        totalHighComplexity: Array.from(analysis.files.values())
          .reduce((sum, f) => sum + f.highComplexityCount, 0),
        fileCount: analysis.totalFiles,
      };

      await this.addTrendPoint(point);
    } catch {
      // Silently fail — git may not be available
    }
  }

  /**
   * Show a webview with trend data.
   */
  async showTrends(): Promise<void> {
    const trends = this.getTrendPoints();
    const panel = vscode.window.createWebviewPanel(
      'typescope.trends',
      'TypeScope Complexity Trends',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    const html = this.generateTrendHtml(trends);
    panel.webview.html = html;
  }

  /**
   * Add a trend point to storage.
   */
  private async addTrendPoint(point: ComplexityTrendPoint): Promise<void> {
    const trends = this.getTrendPoints();

    // Avoid duplicates for the same commit
    const existingIndex = trends.findIndex(t => t.commit === point.commit);
    if (existingIndex !== -1) {
      trends[existingIndex] = point;
    } else {
      trends.push(point);
    }

    // Keep only the most recent N points
    while (trends.length > MAX_TREND_POINTS) {
      trends.shift();
    }

    await this.context.globalState.update(TREND_STORAGE_KEY, trends);
  }

  /**
   * Get stored trend points.
   */
  getTrendPoints(): ComplexityTrendPoint[] {
    return this.context.globalState.get<ComplexityTrendPoint[]>(TREND_STORAGE_KEY, []);
  }

  /**
   * Get the current git commit hash.
   */
  private getGitCommit(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return 'unknown';

    try {
      return child_process
        .execSync('git rev-parse --short HEAD', { cwd: workspace.uri.fsPath })
        .toString().trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get the current git commit message (first line).
   */
  private getGitCommitMessage(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) return 'unknown';

    try {
      return child_process
        .execSync('git log -1 --pretty=%s', { cwd: workspace.uri.fsPath })
        .toString().trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate HTML for the trend visualization webview.
   */
  private generateTrendHtml(trends: ComplexityTrendPoint[]): string {
    const hasData = trends.length > 0;

    const avgScores = trends.map(t => t.averageScore).join(',');
    const maxScores = trends.map(t => t.maxScore).join(',');
    const highCounts = trends.map(t => t.totalHighComplexity).join(',');
    const labels = trends.map(t => t.commit.substring(0, 7)).join('","');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TypeScope Trends</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 20px;
    }
    h1 { font-size: 1.5em; margin-bottom: 16px; color: var(--vscode-foreground); }
    h2 { font-size: 1.2em; margin: 20px 0 12px; color: var(--vscode-foreground); }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      padding: 16px;
      flex: 1;
    }
    .stat-label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .stat-value { font-size: 2em; font-weight: bold; margin-top: 4px; }
    .chart-container { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .no-data { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border); }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .trend-up { color: #F44336; }
    .trend-down { color: #4CAF50; }
    .trend-flat { color: var(--vscode-descriptionForeground); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <h1>📊 TypeScope Complexity Trends</h1>
  
  ${hasData ? `
    <div class="summary">
      <div class="stat">
        <div class="stat-label">Current Average</div>
        <div class="stat-value" style="color: ${this.scoreColor(trends[trends.length - 1].averageScore)}">${trends[trends.length - 1].averageScore}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Current Max</div>
        <div class="stat-value" style="color: ${this.scoreColor(trends[trends.length - 1].maxScore)}">${trends[trends.length - 1].maxScore}</div>
      </div>
      <div class="stat">
        <div class="stat-label">High Complexity Nodes</div>
        <div class="stat-value">${trends[trends.length - 1].totalHighComplexity}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Data Points</div>
        <div class="stat-value">${trends.length}</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Complexity Over Time</h2>
      <canvas id="complexityChart" height="200"></canvas>
    </div>

    <div class="chart-container">
      <h2>High Complexity Count</h2>
      <canvas id="highCountChart" height="150"></canvas>
    </div>

    <h2>History</h2>
    <table>
      <tr><th>Commit</th><th>Message</th><th>Date</th><th>Avg Score</th><th>Max</th><th>High Count</th><th>Trend</th></tr>
      ${trends.map((t, i) => {
        const prev = i > 0 ? trends[i - 1] : null;
        const diff = prev ? t.averageScore - prev.averageScore : 0;
        const trendClass = diff > 5 ? 'trend-up' : diff < -5 ? 'trend-down' : 'trend-flat';
        const trendIcon = diff > 5 ? '📈' : diff < -5 ? '📉' : '➡️';
        const date = new Date(t.timestamp).toLocaleDateString();
        return `<tr>
          <td><code>${t.commit.substring(0, 7)}</code></td>
          <td>${this.escapeHtml(t.commitMessage)}</td>
          <td>${date}</td>
          <td style="color: ${this.scoreColor(t.averageScore)}">${t.averageScore}</td>
          <td style="color: ${this.scoreColor(t.maxScore)}">${t.maxScore}</td>
          <td>${t.totalHighComplexity}</td>
          <td class="${trendClass}">${trendIcon} ${diff > 0 ? '+' : ''}${diff}</td>
        </tr>`;
      }).reverse().join('')}
    </table>
  ` : `
    <div class="no-data">
      <p>No trend data yet.</p>
      <p>Run <strong>TypeScope: Analyze Entire Workspace</strong> to start tracking complexity over time.</p>
      <p>Trend data is saved per-workspace and updated on each analysis.</p>
    </div>
  `}

  ${hasData ? `
  <script>
    const labels = ["${labels}"];
    
    new Chart(document.getElementById('complexityChart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Average Score',
            data: [${avgScores}],
            borderColor: '#2196F3',
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Max Score',
            data: [${maxScores}],
            borderColor: '#F44336',
            backgroundColor: 'rgba(244, 67, 54, 0.1)',
            fill: false,
            tension: 0.3,
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: { min: 0, max: 100, title: { display: true, text: 'Complexity Score' } },
          x: { title: { display: true, text: 'Commit' } }
        },
        plugins: {
          legend: { position: 'top' }
        }
      }
    });

    new Chart(document.getElementById('highCountChart'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'High Complexity Count',
          data: [${highCounts}],
          backgroundColor: 'rgba(244, 67, 54, 0.5)',
          borderColor: '#F44336',
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true },
          x: { title: { display: true, text: 'Commit' } }
        }
      }
    });
  </script>
  ` : ''}
</body>
</html>`;
  }

  private scoreColor(score: number): string {
    if (score <= 30) return '#4CAF50';
    if (score <= 60) return '#FF9800';
    return '#F44336';
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

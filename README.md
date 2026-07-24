# TypeScope — TypeScript Type Complexity Visualizer

> **Zero-config** TypeScript type complexity analysis with inline heat maps, gutter bars, refactoring suggestions, and trend tracking.

## ✨ Features

### 🎨 Inline Heat Map
Color-codes type annotations directly in your editor based on complexity:
- 🟢 **Green** — Simple types (score 0-30)
- 🟡 **Yellow** — Moderate complexity (score 31-60)
- 🔴 **Red** — Complex types (score 61-100)

### 📊 Gutter Complexity Bars
Visual bars in the editor gutter show complexity per line at a glance. Bar width and color reflect the maximum complexity on each line.

### 🌳 Complexity Explorer Tree View
Hierarchical view of your workspace's type complexity:
- **Workspace** → **Files** → **Type Nodes**
- Sort by complexity score
- Click to navigate directly to complex types

### 💡 Insights & Suggestions
Automatically detects complex type patterns and suggests refactoring:
- Deeply nested conditional types
- Large union types
- Wide intersection types
- Recursive types without clear base cases
- Heavy `infer` usage
- Complex mapped types

### 🔧 Code Actions
Right-click on complex types to get quick-fix suggestions:
- **Extract complex type to alias** — Creates a named type alias
- **Simplify conditional type** — Guidance for restructuring
- **Split large union** — Break apart unwieldy unions
- **Compose intersection in stages** — Simplify wide intersections

### 📈 Trend Tracking
Track how your codebase's type complexity changes over time:
- Automatic snapshots on workspace analysis
- Webview charts showing complexity trends
- Commit-by-commit comparison table

### 🚀 Zero Configuration
Works immediately on any TypeScript project:
- No `tsconfig.json` needed
- No trace files to generate
- No build step required
- Uses the TypeScript Compiler API directly

## 📦 Installation

### From VSCode Marketplace
Search for "TypeScope" in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

### From VSIX
```bash
git clone https://github.com/Humoudideas77/typescope.git
cd typescope
npm install
npm run build
code --install-extension typescope-1.0.0.vsix
```

## 🎯 How It Works

TypeScope uses the **TypeScript Compiler API** to parse your source files and walk the AST, computing complexity metrics for every type annotation:

### Complexity Metrics

| Metric | Weight | Description |
|--------|--------|-------------|
| Type Depth | ×3 | Maximum nesting depth of type expressions |
| Type Width | ×1.5 | Number of union/intersection members |
| Conditionals | ×4 | Number of `extends` clauses in conditional types |
| References | ×1 | Number of distinct type references |
| Generics | ×2 | Count of generic type parameters |
| Mapped Keys | ×3 | Complexity of mapped type key patterns |
| Infer Sites | ×2 | Number of `infer` declarations |

### Score Formula
```
raw_score = (depth × 3) + (width × 1.5) + (conditionals × 4) + (references × 1) + (generics × 2) + (mappedKeys × 3) + (inferSites × 2)
normalized = min(100, 100 × (1 - e^(-raw_score / 25)))
```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `typescope.heatmap.enabled` | `true` | Enable inline heat map coloring |
| `typescope.gutterBars.enabled` | `true` | Enable gutter complexity bars |
| `typescope.heatmap.opacity` | `0.15` | Background color opacity (0.05-0.5) |
| `typescope.thresholds.low` | `30` | Green threshold (0-100) |
| `typescope.thresholds.medium` | `60` | Yellow threshold (0-100) |
| `typescope.analysis.autoOnOpen` | `true` | Analyze files on open |
| `typescope.analysis.autoOnSave` | `true` | Re-analyze on save |
| `typescope.analysis.autoOnEdit` | `false` | Re-analyze on edit (may affect performance) |
| `typescope.insights.enabled` | `true` | Enable refactoring suggestions |
| `typescope.trends.enabled` | `true` | Track complexity trends |

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| `TypeScope: Toggle Inline Heat Map` | Enable/disable heat map coloring |
| `TypeScope: Toggle Gutter Complexity Bars` | Enable/disable gutter bars |
| `TypeScope: Analyze Current File` | Analyze the active file |
| `TypeScope: Analyze Entire Workspace` | Analyze all TypeScript files |
| `TypeScope: Show Complexity Details` | Show metrics for cursor position |
| `TypeScope: Show Complexity Trends` | Open trend tracking webview |
| `TypeScope: Export Complexity Report` | Export analysis as Markdown |
| `TypeScope: Clear Analysis` | Clear all cached analysis |
| `TypeScope: Configure Complexity Thresholds` | Open settings |

## 🏗️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Debug
# Open in VSCode, press F5 to launch Extension Development Host

# Package
npm run package
```

## 📄 License

[MIT](LICENSE) — Copyright (c) 2026 Humoudideas77

## 🙏 Credits

Built for the [TSPerf Challenge](https://algora.io/challenges/tsperf) on Algora.

Uses the [TypeScript Compiler API](https://github.com/microsoft/TypeScript) for AST analysis.

---

More free tools + guides: [humoudalmunawer.vercel.app](https://humoudalmunawer.vercel.app/en/#tools)

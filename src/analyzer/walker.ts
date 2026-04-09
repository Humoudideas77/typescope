/**
 * walker.ts — AST walker that extracts complexity metrics from TypeScript source.
 * 
 * Uses the TypeScript Compiler API to parse and walk the AST without requiring
 * a full project compilation. This means analysis is instant — no tsc, no tsconfig,
 * no setup.
 */

import ts from 'typescript';
import { ComplexityMetrics, NodeComplexity, ComplexityPattern, ThresholdConfig } from './types';

/** Default empty metrics */
const EMPTY_METRICS: () => ComplexityMetrics = () => ({
  depth: 0,
  width: 0,
  conditionals: 0,
  references: new Set(),
  generics: 0,
  mappedKeys: 0,
  inferSites: 0,
});

/**
 * Recursively compute complexity metrics for a type AST node.
 */
export function computeMetrics(node: ts.Node): ComplexityMetrics {
  const metrics = EMPTY_METRICS();
  computeMetricsRecursive(node, metrics, 0);
  return metrics;
}

function computeMetricsRecursive(node: ts.Node, metrics: ComplexityMetrics, depth: number): void {
  // Track max depth
  if (depth > metrics.depth) {
    metrics.depth = depth;
  }

  switch (node.kind) {
    case ts.SyntaxKind.TypeReference: {
      // Track referenced types
      const ref = node as ts.TypeReferenceNode;
      const typeName = getTypeNameText(ref.typeName);
      if (typeName) {
        metrics.references.add(typeName);
      }
      // Walk type arguments (generics)
      if (ref.typeArguments) {
        metrics.generics += ref.typeArguments.length;
        for (const arg of ref.typeArguments) {
          computeMetricsRecursive(arg, metrics, depth + 1);
        }
      }
      break;
    }

    case ts.SyntaxKind.UnionType: {
      const union = node as ts.UnionTypeNode;
      metrics.width += union.types.length;
      for (const t of union.types) {
        computeMetricsRecursive(t, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.IntersectionType: {
      const inter = node as ts.IntersectionTypeNode;
      metrics.width += inter.types.length;
      for (const t of inter.types) {
        computeMetricsRecursive(t, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.ConditionalType: {
      const cond = node as ts.ConditionalTypeNode;
      metrics.conditionals += 1;
      // Walk check type, extends type, true type, false type
      computeMetricsRecursive(cond.checkType, metrics, depth + 1);
      computeMetricsRecursive(cond.extendsType, metrics, depth + 1);
      computeMetricsRecursive(cond.trueType, metrics, depth + 1);
      computeMetricsRecursive(cond.falseType, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.MappedType: {
      const mapped = node as ts.MappedTypeNode;
      metrics.mappedKeys += 1;
      if (mapped.typeParameter.constraint) {
        computeMetricsRecursive(mapped.typeParameter.constraint, metrics, depth + 1);
      }
      if (mapped.type) {
        computeMetricsRecursive(mapped.type, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.InferType: {
      const infer = node as ts.InferTypeNode;
      metrics.inferSites += 1;
      if (infer.typeParameter.constraint) {
        computeMetricsRecursive(infer.typeParameter.constraint, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.TemplateLiteralType: {
      const tpl = node as ts.TemplateLiteralTypeNode;
      // Count template spans as additional width
      metrics.width += tpl.templateSpans.length;
      for (const span of tpl.templateSpans) {
        computeMetricsRecursive(span.type, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.ParenthesizedType: {
      const paren = node as ts.ParenthesizedTypeNode;
      computeMetricsRecursive(paren.type, metrics, depth);
      break;
    }

    case ts.SyntaxKind.ArrayType: {
      const arr = node as ts.ArrayTypeNode;
      computeMetricsRecursive(arr.elementType, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.TupleType: {
      const tuple = node as ts.TupleTypeNode;
      metrics.width += tuple.elements.length;
      for (const el of tuple.elements) {
        computeMetricsRecursive(el, metrics, depth + 1);
      }
      break;
    }

    case ts.SyntaxKind.TypeOperator: {
      const op = node as ts.TypeOperatorNode;
      computeMetricsRecursive(op.type, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.IndexedAccessType: {
      const idx = node as ts.IndexedAccessTypeNode;
      computeMetricsRecursive(idx.objectType, metrics, depth + 1);
      computeMetricsRecursive(idx.indexType, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.ImportType: {
      const imp = node as ts.ImportTypeNode;
      if (imp.qualifier) {
        metrics.references.add(getTypeNameText(imp.qualifier));
      }
      if (imp.typeArguments) {
        metrics.generics += imp.typeArguments.length;
        for (const arg of imp.typeArguments) {
          computeMetricsRecursive(arg, metrics, depth + 1);
        }
      }
      break;
    }

    case ts.SyntaxKind.TypeQuery: {
      const tq = node as ts.TypeQueryNode;
      metrics.references.add(getTypeQueryName(tq.exprName));
      break;
    }

    case ts.SyntaxKind.TypeLiteral: {
      const lit = node as ts.TypeLiteralNode;
      metrics.width += lit.members.length;
      for (const member of lit.members) {
        // Walk property type annotations
        if (ts.isPropertySignature(member) && member.type) {
          computeMetricsRecursive(member.type, metrics, depth + 1);
        }
        if (ts.isMethodSignature(member) && member.type) {
          computeMetricsRecursive(member.type, metrics, depth + 1);
        }
      }
      break;
    }

    case ts.SyntaxKind.FunctionType: {
      const fn = node as ts.FunctionTypeNode;
      metrics.generics += fn.typeParameters ? fn.typeParameters.length : 0;
      if (fn.typeParameters) {
        for (const tp of fn.typeParameters) {
          if (tp.constraint) {
            computeMetricsRecursive(tp.constraint, metrics, depth + 1);
          }
          if (tp.default) {
            computeMetricsRecursive(tp.default, metrics, depth + 1);
          }
        }
      }
      for (const param of fn.parameters) {
        if (param.type) {
          computeMetricsRecursive(param.type, metrics, depth + 1);
        }
      }
      computeMetricsRecursive(fn.type, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.ConstructorType: {
      const ctor = node as ts.ConstructorTypeNode;
      for (const param of ctor.parameters) {
        if (param.type) {
          computeMetricsRecursive(param.type, metrics, depth + 1);
        }
      }
      computeMetricsRecursive(ctor.type, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.RestType: {
      const rest = node as ts.RestTypeNode;
      computeMetricsRecursive(rest.type, metrics, depth + 1);
      break;
    }

    case ts.SyntaxKind.OptionalType: {
      const opt = node as ts.OptionalTypeNode;
      computeMetricsRecursive(opt.type, metrics, depth + 1);
      break;
    }

    default:
      // For unhandled types, recurse into children
      break;
  }

  // Always recurse into children we haven't explicitly handled
  ts.forEachChild(node, (child) => {
    computeMetricsRecursive(child, metrics, depth + 1);
  });
}

/**
 * Extract type nodes of interest from a source file and compute complexity for each.
 */
export function extractComplexityNodes(
  sourceFile: ts.SourceFile,
  uri: string,
  thresholds: ThresholdConfig
): NodeComplexity[] {
  const results: NodeComplexity[] = [];

  function visit(node: ts.Node) {
    const typeNode = extractTypeNode(node);
    if (typeNode) {
      const metrics = computeMetrics(typeNode);
      const patterns = detectPatterns(typeNode, node);
      const score = scoreMetrics(metrics, thresholds);

      const sf = sourceFile;
      const start = sf.getLineAndCharacterOfPosition(typeNode.getStart(sf));
      const end = sf.getLineAndCharacterOfPosition(typeNode.getEnd());

      results.push({
        uri,
        line: start.line,
        column: start.character,
        endLine: end.line,
        endColumn: end.character,
        text: typeNode.getText(sf).trim(),
        kind: getNodeKind(node),
        score,
        patterns,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Try to extract a type annotation node from various declaration forms.
 */
function extractTypeNode(node: ts.Node): ts.TypeNode | null {
  // Type alias declaration: type Foo = ComplexType
  if (ts.isTypeAliasDeclaration(node) && node.type) {
    return node.type;
  }

  // Variable with type annotation
  if (ts.isVariableDeclaration(node) && node.type) {
    return node.type;
  }

  // Property declaration with type
  if (ts.isPropertyDeclaration(node) && node.type) {
    return node.type;
  }

  // Property signature (in type literals / interfaces)
  if (ts.isPropertySignature(node) && node.type) {
    return node.type;
  }

  // Parameter with type
  if (ts.isParameter(node) && node.type) {
    return node.type;
  }

  // Function/method return type
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.type) {
    return node.type;
  }

  // Interface declaration — analyze each member
  // (handled individually by the walker visiting children)

  // Class property
  if (ts.isClassDeclaration(node)) {
    // Don't treat the class itself as a type node; its members will be visited
    return null;
  }

  return null;
}

/**
 * Detect known complexity anti-patterns.
 */
function detectPatterns(typeNode: ts.TypeNode, contextNode: ts.Node): ComplexityPattern[] {
  const patterns: ComplexityPattern[] = [];
  const sf = contextNode.getSourceFile();
  const start = sf.getLineAndCharacterOfPosition(contextNode.getStart(sf));
  const text = typeNode.getText(sf);

  // Pattern: Deeply nested conditional types
  let conditionalDepth = 0;
  function countConditionals(node: ts.Node, depth: number): void {
    if (ts.isConditionalType(node)) {
      conditionalDepth = Math.max(conditionalDepth, depth);
      countConditionals(node.trueType, depth + 1);
      countConditionals(node.falseType, depth + 1);
    }
  }
  countConditionals(typeNode, 1);
  if (conditionalDepth >= 3) {
    patterns.push({
      id: 'deep-conditional',
      name: 'Deeply Nested Conditional Types',
      description: `Conditional types nested ${conditionalDepth} levels deep. This can cause exponential type instantiation.`,
      severity: conditionalDepth >= 5 ? 'high' : 'medium',
      suggestion: 'Consider breaking apart the conditional chain into separate type utilities or using a lookup table (Record) pattern.',
      locations: [{ line: start.line, column: start.character, text }],
    });
  }

  // Pattern: Large union types
  let unionSize = 0;
  function measureUnion(node: ts.Node): void {
    if (ts.isUnionType(node)) {
      unionSize = Math.max(unionSize, node.types.length);
      for (const t of node.types) measureUnion(t);
    }
  }
  measureUnion(typeNode);
  if (unionSize >= 10) {
    patterns.push({
      id: 'large-union',
      name: 'Large Union Type',
      description: `Union type with ${unionSize} members. Large unions cause slow type checking and autocomplete.`,
      severity: unionSize >= 20 ? 'high' : 'medium',
      suggestion: 'Consider using a discriminated union with a shared property, or splitting into smaller groups.',
      locations: [{ line: start.line, column: start.character, text }],
    });
  }

  // Pattern: Recursive type (self-referencing)
  if (ts.isTypeAliasDeclaration(contextNode)) {
    const aliasName = contextNode.name.getText(sf);
    const bodyText = typeNode.getText(sf);
    if (bodyText.includes(aliasName)) {
      patterns.push({
        id: 'recursive-type',
        name: 'Recursive Type',
        description: `Type "${aliasName}" references itself. Recursive types can cause deep instantiation chains.`,
        severity: 'medium',
        suggestion: 'Ensure there is a clear base case to terminate recursion. Consider adding explicit depth limits.',
        locations: [{ line: start.line, column: start.character, text }],
      });
    }
  }

  // Pattern: Wide intersection type
  if (ts.isIntersectionTypeNode(typeNode) && typeNode.types.length >= 5) {
    patterns.push({
      id: 'wide-intersection',
      name: 'Wide Intersection Type',
      description: `Intersection with ${typeNode.types.length} types. Wide intersections can be slow to resolve and may conflict.`,
      severity: typeNode.types.length >= 8 ? 'high' : 'medium',
      suggestion: 'Consider composing types in stages (intermediate type aliases) or using class hierarchy instead.',
      locations: [{ line: start.line, column: start.character, text }],
    });
  }

  // Pattern: Heavy infer usage
  let inferCount = 0;
  function countInfers(node: ts.Node): void {
    if (ts.isInferTypeNode(node)) inferCount++;
    node.forEachChild(countInfers);
  }
  countInfers(typeNode);
  if (inferCount >= 3) {
    patterns.push({
      id: 'heavy-infer',
      name: 'Heavy Infer Usage',
      description: `${inferCount} infer declarations in a single type. Multiple infers in conditionals increase checking time.`,
      severity: 'medium',
      suggestion: 'Consider whether all inferred types are necessary. Sometimes explicit type parameters are clearer and faster.',
      locations: [{ line: start.line, column: start.character, text }],
    });
  }

  // Pattern: Complex mapped type
  if (ts.isMappedTypeNode(typeNode)) {
    const mapped = typeNode;
    if (mapped.typeParameter.constraint) {
      const constraintText = mapped.typeParameter.constraint.getText(sf);
      if (constraintText.includes('extends') && constraintText.includes('infer')) {
        patterns.push({
          id: 'complex-mapped-type',
          name: 'Complex Mapped Type with Inference',
          description: 'Mapped type with conditional constraint and inference. This pattern is particularly expensive.',
          severity: 'high',
          suggestion: 'Consider using a helper type or pre-computing the key set before mapping.',
          locations: [{ line: start.line, column: start.character, text }],
        });
      }
    }
  }

  return patterns;
}

/**
 * Score raw metrics into a normalized 0-100 value.
 */
function scoreMetrics(metrics: ComplexityMetrics, thresholds: ThresholdConfig): import('./types').ComplexityScore {
  // Raw score using the formula
  const raw =
    metrics.depth * 3 +
    metrics.width * 1.5 +
    metrics.conditionals * 4 +
    metrics.references.size * 1 +
    metrics.generics * 2 +
    metrics.mappedKeys * 3 +
    metrics.inferSites * 2;

  // Normalize to 0-100 using logarithmic scaling (avoids flat-lining at low values)
  const normalized = Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 25))));

  // Determine severity
  let severity: import('./types').ComplexitySeverity;
  if (normalized <= thresholds.low) {
    severity = 'low';
  } else if (normalized <= thresholds.medium) {
    severity = 'medium';
  } else {
    severity = 'high';
  }

  // Compute color
  const color = severityToHex(normalized, severity);
  const cssColor = severityToCss(normalized, severity);

  return { score: normalized, metrics, severity, color, cssColor };
}

function severityToHex(score: number, severity: import('./types').ComplexitySeverity): string {
  if (severity === 'low') {
    return '#4CAF50';
  } else if (severity === 'medium') {
    return '#FF9800';
  }
  return '#F44336';
}

function severityToCss(score: number, severity: import('./types').ComplexitySeverity): string {
  // Return an rgba string for use in CSS background-color
  if (severity === 'low') {
    return `rgba(76, 175, 80, VAR_OPACITY)`;
  } else if (severity === 'medium') {
    return `rgba(255, 152, 0, VAR_OPACITY)`;
  }
  return `rgba(244, 67, 54, VAR_OPACITY)`;
}

function getTypeNameText(node: ts.EntityName): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isQualifiedName(node)) {
    return getTypeNameText(node.left) + '.' + node.right.text;
  }
  return '';
}

function getTypeQueryName(node: ts.EntityName): string {
  return getTypeNameText(node);
}

function getNodeKind(node: ts.Node): string {
  if (ts.isTypeAliasDeclaration(node)) return 'type alias';
  if (ts.isVariableDeclaration(node)) return 'variable';
  if (ts.isPropertyDeclaration(node)) return 'property';
  if (ts.isPropertySignature(node)) return 'property signature';
  if (ts.isParameter(node)) return 'parameter';
  if (ts.isFunctionDeclaration(node)) return 'function return';
  if (ts.isMethodDeclaration(node)) return 'method return';
  return 'type annotation';
}

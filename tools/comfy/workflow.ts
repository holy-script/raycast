export type WorkflowTemplate = Record<string, unknown>;
export type WorkflowValues = Record<string, string | number>;

const PLACEHOLDER = /__[A-Z0-9_]+__/g;

function fillValue(value: unknown, values: WorkflowValues): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^__[A-Z0-9_]+__$/);
    if (exact) {
      const replacement = values[exact[0]];
      if (replacement === undefined) {
        throw new Error(`Missing workflow value for ${exact[0]}`);
      }
      return replacement;
    }
    return value.replace(PLACEHOLDER, (token) => {
      const replacement = values[token];
      if (replacement === undefined) {
        throw new Error(`Missing workflow value for ${token}`);
      }
      return String(replacement);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillValue(item, values));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        fillValue(item, values),
      ]),
    );
  }
  return value;
}

export function fillWorkflow(
  template: WorkflowTemplate,
  values: WorkflowValues,
): WorkflowTemplate {
  const filled = fillValue(template, values) as WorkflowTemplate;
  const leftover = JSON.stringify(filled).match(PLACEHOLDER);
  if (leftover) {
    throw new Error(`Unresolved workflow placeholders: ${[...new Set(leftover)].join(", ")}`);
  }
  return filled;
}

export function validateWorkflow(workflow: WorkflowTemplate): string[] {
  const problems: string[] = [];
  const nodes = Object.entries(workflow);
  if (nodes.length === 0) problems.push("workflow has no nodes");

  let saveImages = 0;
  for (const [id, raw] of nodes) {
    if (!raw || typeof raw !== "object") {
      problems.push(`node ${id} is not an object`);
      continue;
    }
    const node = raw as { class_type?: unknown; inputs?: unknown };
    if (typeof node.class_type !== "string") {
      problems.push(`node ${id} has no class_type`);
    }
    if (!node.inputs || typeof node.inputs !== "object") {
      problems.push(`node ${id} has no inputs`);
      continue;
    }
    if (node.class_type === "SaveImage") saveImages += 1;
    for (const [input, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue;
      const [source] = value as [unknown, unknown];
      if (typeof source !== "string" || !(source in workflow)) {
        problems.push(`node ${id}.${input} references missing node ${String(source)}`);
      }
    }
  }
  if (saveImages === 0) problems.push("workflow has no SaveImage node");
  return problems;
}

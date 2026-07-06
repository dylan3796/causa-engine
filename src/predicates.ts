/**
 * Serializable predicate AST + deterministic evaluator. Verdict rules and
 * Grade-D counterfactual rules are DATA (this AST), never code — that is what
 * makes them replayable and diffable. Metrics resolve against a flat record
 * supplied by the caller; there is no arbitrary field access and no eval.
 */

export type MetricValue = number | string | boolean;
export type MetricRecord = Record<string, MetricValue | undefined>;

export type Predicate =
  | { op: "and"; of: Predicate[] }
  | { op: "or"; of: Predicate[] }
  | { op: "not"; of: Predicate }
  | { op: "exists"; metric: string }
  | { op: "cmp"; metric: string; cmp: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: MetricValue };

export function evalPredicate(p: Predicate, metrics: MetricRecord): boolean {
  switch (p.op) {
    case "and":
      return p.of.every((q) => evalPredicate(q, metrics));
    case "or":
      return p.of.some((q) => evalPredicate(q, metrics));
    case "not":
      return !evalPredicate(p.of, metrics);
    case "exists":
      return metrics[p.metric] !== undefined;
    case "cmp": {
      const v = metrics[p.metric];
      if (v === undefined) return false;
      switch (p.cmp) {
        case "eq":
          return v === p.value;
        case "ne":
          return v !== p.value;
        case "lt":
        case "lte":
        case "gt":
        case "gte": {
          if (typeof v !== "number" || typeof p.value !== "number") {
            throw new Error(
              `predicate cmp ${p.cmp} requires numbers: metric ${p.metric} is ${typeof v}`
            );
          }
          if (p.cmp === "lt") return v < p.value;
          if (p.cmp === "lte") return v <= p.value;
          if (p.cmp === "gt") return v > p.value;
          return v >= p.value;
        }
      }
    }
  }
}

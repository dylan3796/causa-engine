"use strict";
var Causa = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    ENGINE_VERSION: () => ENGINE_VERSION,
    applyProposals: () => applyProposals,
    autoEngagement: () => autoEngagement,
    buildEngagement: () => buildEngagement,
    buildInterpretationRequests: () => buildInterpretationRequests,
    detectFile: () => detectFile,
    detectFormat: () => detectFormat,
    interpretHeuristically: () => interpretHeuristically,
    mixOptions: () => mixOptions,
    northwindFiles: () => northwindFiles,
    observe: () => observe,
    observedSubstitutionTable: () => observedSubstitutionTable,
    orgsweepFiles: () => orgsweepFiles,
    parseTable: () => parseTable,
    preflight: () => preflight,
    projectObservedScale: () => projectObservedScale,
    projectScale: () => projectScale,
    renderIntakeReport: () => renderIntakeReport,
    renderInterpretation: () => renderInterpretation,
    renderPreflight: () => renderPreflight,
    renderStatement: () => renderStatement,
    runStatement: () => runStatement,
    substitutionTable: () => substitutionTable,
    validateProposals: () => validateProposals
  });

  // src/types.ts
  var entityKey = (e) => `${e.kind}:${e.id}`;
  var EngineError = class extends Error {
    constructor(stage, message) {
      super(`[engine:${stage}] ${message}`);
    }
  };
  var MissingDesignDataError = class extends EngineError {
  };

  // src/intake/csv.ts
  function parseCsv(content) {
    const text = content.charCodeAt(0) === 65279 ? content.slice(1) : content;
    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        record.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        record.push(field);
        field = "";
        records.push(record);
        record = [];
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || record.length > 0) {
      record.push(field);
      records.push(record);
    }
    while (records.length > 0 && records[records.length - 1].every((v) => v === "")) {
      records.pop();
    }
    if (records.length === 0) return { rows: [], rejects: [], columns: [] };
    const columns = records[0].map((c) => c.trim());
    const rows = [];
    const rejects = [];
    for (let r = 1; r < records.length; r++) {
      const rec = records[r];
      if (rec.length !== columns.length) {
        rejects.push({
          rowNum: r,
          reason: `ragged_row: ${rec.length} fields, header has ${columns.length}`,
          sample: rec.join(",").slice(0, 120)
        });
        continue;
      }
      const values = {};
      for (let c = 0; c < columns.length; c++) values[columns[c]] = rec[c];
      rows.push({ rowNum: r, values });
    }
    return { rows, rejects, columns };
  }
  function parseNdjson(content) {
    const rows = [];
    const rejects = [];
    const columns = /* @__PURE__ */ new Set();
    const lines = content.split(/\r?\n/);
    let rowNum = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      rowNum += 1;
      try {
        const parsed = JSON.parse(line);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          rejects.push({ rowNum, reason: "not_an_object", sample: line.slice(0, 120) });
          continue;
        }
        for (const key of Object.keys(parsed)) columns.add(key);
        rows.push({ rowNum, values: parsed });
      } catch {
        rejects.push({ rowNum, reason: "invalid_json", sample: line.slice(0, 120) });
      }
    }
    return { rows, rejects, columns: [...columns].sort() };
  }

  // src/numeric.ts
  var EPS = 1e-9;
  function roundHalfUp(x) {
    if (x < -EPS) {
      throw new Error(`roundHalfUp domain error: engine quantities are non-negative, got ${x}`);
    }
    return Math.floor(x + 0.5 + EPS);
  }
  function R1_count(x) {
    return roundHalfUp(x);
  }
  function R2_unitCents(totalCents, denom) {
    if (denom <= 0) throw new Error(`R2 denominator must be positive, got ${denom}`);
    return roundHalfUp(totalCents / denom);
  }
  function R3_dollars(x) {
    return roundHalfUp(x);
  }
  function R4_pct(num, den) {
    if (den <= 0) throw new Error(`R4 denominator must be positive, got ${den}`);
    return roundHalfUp(100 * num / den);
  }
  function R4_share2(num, den) {
    return R4_pct(num, den) / 100;
  }
  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }
  function settleCounterfactual(verified, cfRaw) {
    const counterfactual = Math.min(verified, R1_count(Math.max(0, cfRaw)));
    return { counterfactual, attributable: clamp(verified - counterfactual, 0, verified) };
  }

  // src/intake/mapping.ts
  var RowError = class extends Error {
  };
  function rawValue(row, keyPath) {
    if (keyPath in row.values) return row.values[keyPath];
    let cur = row.values;
    for (const part of keyPath.split(".")) {
      if (cur === null || typeof cur !== "object") return void 0;
      cur = cur[part];
    }
    return cur;
  }
  function normalizeTimestamp(value) {
    const v = value.trim();
    if (v === "") throw new RowError("empty timestamp");
    if (/^\d{13}$/.test(v)) return new Date(Number(v)).toISOString();
    if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1e3).toISOString();
    const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v);
    if (naive) {
      const ms2 = Date.parse(`${naive[1]}T${naive[2]}Z`);
      if (!Number.isNaN(ms2)) return new Date(ms2).toISOString();
    }
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) throw new RowError(`unparseable timestamp "${v.slice(0, 40)}"`);
    return new Date(ms).toISOString();
  }
  function usdToCents(value) {
    const cleaned = value.trim().replace(/[$,]/g, "");
    if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) {
      throw new RowError(`unparseable money "${value.slice(0, 40)}"`);
    }
    const dollars = Number(cleaned);
    if (dollars < 0) throw new RowError(`negative cost "${value.slice(0, 40)}"`);
    return roundHalfUp(dollars * 100);
  }
  function resolveField(row, spec, label) {
    if (typeof spec === "object" && "const" in spec) return spec.const;
    const column = typeof spec === "string" ? spec : spec.column;
    const transform = typeof spec === "string" ? void 0 : spec.transform;
    const raw = rawValue(row, column);
    if (raw === void 0 || raw === null || raw === "") {
      throw new RowError(`missing ${label} (column "${column}")`);
    }
    const s = typeof raw === "string" ? raw : String(raw);
    switch (transform) {
      case void 0:
        return s;
      case "trim":
        return s.trim();
      case "timestamp":
        return normalizeTimestamp(s);
      case "usdToCents":
        return String(usdToCents(s));
    }
  }
  function resolveOptional(row, spec, label) {
    if (spec === void 0) return void 0;
    if (typeof spec === "object" && "const" in spec) return spec.const;
    const column = typeof spec === "string" ? spec : spec.column;
    const raw = rawValue(row, column);
    if (raw === void 0 || raw === null || raw === "") return void 0;
    return resolveField(row, spec, label);
  }
  function mapRows(rows, build) {
    const records = [];
    const rejects = [];
    for (const row of rows) {
      try {
        records.push(build(row));
      } catch (err) {
        if (!(err instanceof RowError)) throw err;
        rejects.push({
          rowNum: row.rowNum,
          reason: err.message,
          sample: JSON.stringify(row.values).slice(0, 120)
        });
      }
    }
    return { records, rejects };
  }

  // src/intake/build.ts
  var SOURCE_TOKEN = /^[a-z][a-z0-9_-]*$/;
  function parseTable(content, format) {
    return format === "csv" ? parseCsv(content) : parseNdjson(content);
  }
  function resolveSource(row, spec) {
    const value = resolveField(row, spec, "source");
    if (!SOURCE_TOKEN.test(value)) {
      throw new RowError(`malformed source "${value}" (expected a lowercase token like "zendesk")`);
    }
    return value;
  }
  function isValidPayload(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function buildEngagement(engagement, readFile) {
    const periodStartMs = Date.parse(engagement.period.start);
    const periodEndMs = Date.parse(engagement.period.end);
    if (Number.isNaN(periodStartMs) || Number.isNaN(periodEndMs) || periodEndMs <= periodStartMs) {
      throw new EngineError("intake", `invalid engagement period ${engagement.period.start} \u2192 ${engagement.period.end}`);
    }
    const files = [];
    const assumptions = ["Naive timestamps (no timezone) in exports are read as UTC."];
    const runs = [];
    const seenRunIds = /* @__PURE__ */ new Set();
    for (const spec of engagement.activitySources) {
      const table = parseTable(readFile(spec.file), spec.format);
      let outsidePeriod = 0;
      const { records, rejects } = mapRows(table.rows, (row) => {
        const id = spec.map.id ? resolveField(row, spec.map.id, "run id") : `${spec.file}#${row.rowNum}`;
        if (seenRunIds.has(id)) throw new RowError(`duplicate run id "${id}"`);
        const startedAt = resolveField(row, { column: columnOf(spec.map.startedAt), transform: "timestamp" }, "startedAt");
        const endedAtRaw = resolveOptional(row, spec.map.endedAt, "endedAt");
        const endedAt = endedAtRaw ? normalizeTimestamp(endedAtRaw) : startedAt;
        const costRaw = resolveOptional(row, spec.map.costUsd, "cost");
        const costCents = costRaw === void 0 ? 0 : usdToCents(costRaw);
        let payload = {};
        if (spec.map.payloadKey) {
          const p = row.values[spec.map.payloadKey];
          if (!isValidPayload(p)) throw new RowError(`payload key "${spec.map.payloadKey}" is not an object`);
          payload = p;
        } else {
          const fields = {};
          for (const col of spec.map.fields ?? []) {
            const v = row.values[col];
            if (v !== void 0 && v !== null && v !== "") fields[col] = String(v);
          }
          const text = resolveOptional(row, spec.map.text, "text");
          payload = {
            ...Object.keys(fields).length > 0 ? { fields } : {},
            ...text !== void 0 ? { text } : {}
          };
        }
        let claim;
        const c = spec.map.claim;
        if (c) {
          const workflowId = resolveOptional(row, c.workflowId, "claim workflowId");
          if (workflowId !== void 0) {
            claim = {
              workflowId,
              claimedEventType: resolveField(row, c.claimedEventType, "claim event type"),
              claimedAt: c.claimedAt ? resolveField(row, { column: columnOf(c.claimedAt), transform: "timestamp" }, "claimedAt") : startedAt
            };
          }
        }
        const startedMs = Date.parse(startedAt);
        if (startedMs < periodStartMs || startedMs >= periodEndMs) outsidePeriod += 1;
        seenRunIds.add(id);
        return {
          id,
          source: resolveSource(row, spec.source),
          actorId: resolveField(row, spec.map.actorId, "actorId"),
          model: resolveOptional(row, spec.map.model, "model"),
          startedAt,
          endedAt,
          costCents,
          payload,
          claim
        };
      });
      runs.push(...records);
      files.push({
        file: spec.file,
        kind: "activity",
        rowsRead: table.rows.length + table.rejects.length,
        recordsProduced: records.length,
        rejects: [...table.rejects, ...rejects],
        outsidePeriod
      });
    }
    const outcomes = [];
    let autoId = 0;
    for (const spec of engagement.outcomeSources) {
      const table = parseTable(readFile(spec.file), spec.format);
      let outsidePeriod = 0;
      const { records, rejects } = mapRows(table.rows, (row) => {
        const occurredAt = resolveField(row, { column: columnOf(spec.map.occurredAt), transform: "timestamp" }, "occurredAt");
        let assignment;
        const a = spec.map.assignment;
        if (a) {
          const arm = resolveOptional(row, a.arm, "assignment arm");
          if (arm !== void 0) {
            assignment = { experimentId: resolveField(row, a.experimentId, "experimentId"), arm };
          }
        }
        const occurredMs = Date.parse(occurredAt);
        if (occurredMs < periodStartMs) outsidePeriod += 1;
        return {
          id: spec.map.id ? resolveField(row, spec.map.id, "event id") : `${spec.file}-${++autoId}`,
          source: resolveSource(row, spec.source),
          entity: { kind: resolveField(row, spec.map.entityKind, "entityKind"), id: resolveField(row, spec.map.entityId, "entityId") },
          eventType: resolveField(row, spec.map.eventType, "eventType"),
          occurredAt,
          assignment
        };
      });
      outcomes.push(...records);
      files.push({
        file: spec.file,
        kind: "outcome",
        rowsRead: table.rows.length + table.rejects.length,
        recordsProduced: records.length,
        rejects: [...table.rejects, ...rejects],
        outsidePeriod
      });
    }
    const totals = {
      rowsRead: files.reduce((a, f) => a + f.rowsRead, 0),
      recordsProduced: files.reduce((a, f) => a + f.recordsProduced, 0),
      rejected: files.reduce((a, f) => a + f.rejects.length, 0)
    };
    if (totals.rowsRead !== totals.recordsProduced + totals.rejected) {
      throw new EngineError("intake", `row conservation violated: ${totals.rowsRead} read vs ${totals.recordsProduced} + ${totals.rejected}`);
    }
    return {
      inputs: {
        periodStart: engagement.period.start,
        periodEnd: engagement.period.end,
        actors: engagement.actors,
        runs,
        outcomes
      },
      config: {
        contracts: engagement.contracts,
        extractRuleSets: engagement.extractRuleSets,
        verdictRules: engagement.verdictRules,
        activitySourceLabels: engagement.activitySourceLabels,
        boundaryWindowDays: engagement.boundaryWindowDays ?? 30
      },
      report: { engagement: engagement.name, files, assumptions, totals }
    };
  }
  function columnOf(spec) {
    if (typeof spec === "string") return spec;
    if ("column" in spec) return spec.column;
    throw new EngineError("intake", "timestamp fields cannot be constants");
  }
  function renderIntakeReport(report) {
    const lines = [];
    lines.push(`# Intake report \u2014 ${report.engagement}`);
    lines.push("");
    lines.push(
      `**${report.totals.rowsRead} rows read \u2192 ${report.totals.recordsProduced} records \xB7 ${report.totals.rejected} rejected** (every row accounted for)`
    );
    lines.push("");
    for (const f of report.files) {
      lines.push(`## ${f.file} (${f.kind})`);
      lines.push(`- ${f.rowsRead} rows \u2192 ${f.recordsProduced} records \xB7 ${f.rejects.length} rejected \xB7 ${f.outsidePeriod} outside the period`);
      const byReason = /* @__PURE__ */ new Map();
      for (const r of f.rejects) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      for (const [reason, count] of [...byReason.entries()].sort()) {
        const sample = f.rejects.find((r) => r.reason === reason);
        lines.push(`  - ${reason}: ${count} (e.g. row ${sample.rowNum}: ${sample.sample})`);
      }
      lines.push("");
    }
    lines.push(`## Assumptions`);
    for (const a of report.assumptions) lines.push(`- ${a}`);
    lines.push("");
    return lines.join("\n");
  }

  // src/intake/autodetect.ts
  function detectFormat(content) {
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (t === "") continue;
      return t.startsWith("{") ? "ndjson" : "csv";
    }
    return "csv";
  }
  var SYN = {
    runId: ["run_id", "trace_id", "span_id", "run", "id", "event_id"],
    actor: ["actor", "actor_id", "agent", "agent_id", "agent_name", "bot", "assistant", "app"],
    model: ["model", "llm", "model_name", "engine"],
    time: ["started_at", "start_time", "timestamp", "ts", "time", "created_at", "updated_at", "date", "occurred_at", "event_time"],
    cost: ["cost_usd", "cost", "usd", "amount", "total_cost", "price", "spend"],
    text: ["text", "output", "message", "summary", "notes", "content"],
    entityId: [
      "entity_id",
      "ticket_id",
      "invoice_id",
      "case_id",
      "issue_id",
      "opportunity_id",
      "prospect_id",
      "record_id",
      "object_id",
      "document_id",
      "order_id",
      "external_id"
    ],
    entityKind: ["entity_kind", "kind", "object", "object_type", "record_type", "entity"],
    eventType: ["event_type", "event", "type", "status", "action", "activity"],
    source: ["source", "system", "platform", "origin"]
  };
  function pick(columns, candidates) {
    const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
    for (const cand of candidates) {
      const hit = lower.get(cand);
      if (hit !== void 0) return hit;
    }
    return void 0;
  }
  function slug(s) {
    const t = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return /^[a-z]/.test(t) ? t : `x_${t || "file"}`;
  }
  function detectFile(name, content, kindHint) {
    const format = detectFormat(content);
    const table = format === "csv" ? parseCsv(content) : parseNdjson(content);
    const columns = table.columns;
    const notes = [`format detected: ${format}`];
    const actorCol = pick(columns, SYN.actor);
    const eventCol = pick(columns, SYN.eventType);
    const kind = kindHint ?? (actorCol ? "activity" : "outcome");
    if (!kindHint) notes.push(`classified as ${kind} (${actorCol ? `actor column "${actorCol}"` : "no actor column"})`);
    const timeCol = pick(columns, SYN.time);
    if (!timeCol) notes.push(`no timestamp column recognized among [${columns.join(", ")}] \u2014 rows will reject`);
    const sourceCol = pick(columns, SYN.source);
    const defaultSource = slug(name.replace(/\.(csv|ndjson|json|txt)$/i, ""));
    if (kind === "activity") {
      const idCol = pick(columns, SYN.runId);
      const costCol = pick(columns, SYN.cost);
      const modelCol = pick(columns, SYN.model);
      const textCol = pick(columns, SYN.text);
      const mapped = new Set([idCol, actorCol, costCol, modelCol, timeCol, textCol, sourceCol].filter(Boolean));
      const fields = columns.filter((c) => !mapped.has(c));
      notes.push(
        `mapped: id\u2190${idCol ?? "(row number)"} actor\u2190${actorCol ?? "(constant)"} time\u2190${timeCol ?? "\u2014"}${costCol ? ` cost\u2190${costCol}` : ""}${modelCol ? ` model\u2190${modelCol}` : ""}; ${fields.length} column(s) kept as join-key fields [${fields.join(", ")}]`
      );
      const spec2 = {
        file: name,
        format,
        source: sourceCol ?? { const: "log_upload" },
        map: {
          id: idCol,
          // absent → stable row-number ids
          actorId: actorCol ?? { const: slug(name) || "agent" },
          model: modelCol,
          startedAt: timeCol ?? "started_at",
          costUsd: costCol,
          fields,
          text: textCol
        }
      };
      return { file: name, format, kind, spec: spec2, notes };
    }
    const NOT_ENTITY = /* @__PURE__ */ new Set(["run_id", "trace_id", "span_id", "event_id"]);
    const entityIdCol = pick(columns, SYN.entityId) ?? columns.find((c) => /_(id|ref)$/i.test(c) && !NOT_ENTITY.has(c.toLowerCase())) ?? pick(columns, ["id"]);
    const entityKindCol = pick(columns, SYN.entityKind);
    const entityKindConst = entityIdCol && /_(id|ref)$/i.test(entityIdCol) ? entityIdCol.toLowerCase().replace(/_(id|ref)$/, "") : defaultSource;
    notes.push(
      `mapped: entity\u2190${entityIdCol ?? "\u2014"} (kind ${entityKindCol ? `\u2190${entityKindCol}` : `"${entityKindConst}"`}) event\u2190${eventCol ?? "\u2014"} time\u2190${timeCol ?? "\u2014"} source\u2190${sourceCol ?? `"${defaultSource}"`}`
    );
    const spec = {
      file: name,
      format,
      source: sourceCol ?? { const: defaultSource },
      map: {
        entityKind: entityKindCol ?? { const: entityKindConst },
        entityId: entityIdCol ?? "entity_id",
        eventType: eventCol ?? "event_type",
        occurredAt: timeCol ?? "occurred_at"
      }
    };
    return { file: name, format, kind, spec, notes };
  }
  function autoEngagement(files) {
    const detections = files.map((f) => detectFile(f.name, f.content, f.kind));
    const engagement = {
      name: "Playground (auto-detected)",
      period: { start: "2000-01-01T00:00:00.000Z", end: "2100-01-01T00:00:00.000Z" },
      actors: [],
      activitySources: detections.filter((d) => d.kind === "activity").map((d) => d.spec),
      outcomeSources: detections.filter((d) => d.kind === "outcome").map((d) => d.spec),
      contracts: [],
      extractRuleSets: [],
      verdictRules: [],
      activitySourceLabels: {}
    };
    return { engagement, detections };
  }

  // src/extract/extractors.ts
  function argAtPath(argsJson, path) {
    let parsed;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      return void 0;
    }
    let cur = parsed;
    for (const part of path.split(".")) {
      if (cur === null || typeof cur !== "object") return void 0;
      cur = cur[part];
    }
    if (typeof cur === "string" || typeof cur === "number") return String(cur);
    return void 0;
  }
  function applyRule(run, rule) {
    if (rule.source && rule.source !== run.source) return void 0;
    switch (rule.from) {
      case "toolCallArg": {
        for (const call of run.payload.toolCalls ?? []) {
          if (call.name !== rule.tool) continue;
          const v = argAtPath(call.argsJson, rule.argPath);
          if (v !== void 0) return v;
        }
        return void 0;
      }
      case "regex": {
        const haystack = rule.on === "text" ? run.payload.text ?? "" : (run.payload.toolCalls ?? []).map((c) => c.argsJson).join("\n");
        const m = new RegExp(rule.pattern).exec(haystack);
        return m?.[rule.group] ?? void 0;
      }
      case "field":
        return run.payload.fields?.[rule.field];
    }
  }
  function extractEntities(run, ruleSet) {
    const byKind = /* @__PURE__ */ new Map();
    for (const rule of ruleSet.rules) {
      if (byKind.has(rule.entityKind)) continue;
      const id = applyRule(run, rule);
      if (id !== void 0 && id !== "") byKind.set(rule.entityKind, id);
    }
    return [...byKind.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([kind, id]) => ({ kind, id }));
  }

  // src/join/graph.ts
  function buildOutcomeIndex(outcomes) {
    const eventsByEntity = /* @__PURE__ */ new Map();
    for (const ev of outcomes) {
      const key = entityKey(ev.entity);
      let list = eventsByEntity.get(key);
      if (!list) eventsByEntity.set(key, list = []);
      list.push(ev);
    }
    for (const list of eventsByEntity.values()) {
      list.sort(
        (a, b) => a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1
      );
    }
    const entityArms = /* @__PURE__ */ new Map();
    for (const ev of outcomes) {
      if (!ev.assignment) continue;
      const { experimentId, arm } = ev.assignment;
      let arms = entityArms.get(experimentId);
      if (!arms) entityArms.set(experimentId, arms = /* @__PURE__ */ new Map());
      let set = arms.get(arm);
      if (!set) arms.set(arm, set = /* @__PURE__ */ new Set());
      set.add(entityKey(ev.entity));
    }
    return { eventsByEntity, entityArms };
  }
  function buildGraph(contract, runs, outcomeIndex, ruleSet, actors) {
    const actorById = new Map(actors.map((a) => [a.id, a]));
    const workflowActorIds = new Set(contract.actorIds);
    const entityKeysByRun = /* @__PURE__ */ new Map();
    const touchesByEntity = /* @__PURE__ */ new Map();
    const workflowRuns = [];
    for (const run of runs) {
      const actor = actorById.get(run.actorId);
      if (!actor) throw new EngineError("join", `run ${run.id} references unknown actor ${run.actorId}`);
      const isWorkflowRun = workflowActorIds.has(run.actorId);
      if (isWorkflowRun) workflowRuns.push(run);
      const keys = extractEntities(run, ruleSet).filter((e) => e.kind === contract.join.entityKind).map(entityKey);
      if (keys.length === 0) {
        if (isWorkflowRun) entityKeysByRun.set(run.id, []);
        continue;
      }
      entityKeysByRun.set(run.id, keys);
      const startedAtMs = Date.parse(run.startedAt);
      for (const key of keys) {
        let touches = touchesByEntity.get(key);
        if (!touches) touchesByEntity.set(key, touches = []);
        touches.push({ runId: run.id, actorId: run.actorId, actorClass: actor.class, startedAtMs });
      }
    }
    for (const touches of touchesByEntity.values()) {
      touches.sort((a, b) => a.startedAtMs - b.startedAtMs || (a.runId < b.runId ? -1 : 1));
    }
    workflowRuns.sort((a, b) => a.id < b.id ? -1 : 1);
    return {
      contract,
      workflowRuns,
      entityKeysByRun,
      eventsByEntity: outcomeIndex.eventsByEntity,
      touchesByEntity,
      entityArms: outcomeIndex.entityArms
    };
  }
  function armEntities(graph, experimentId, arm) {
    const set = graph.entityArms.get(experimentId)?.get(arm);
    if (!set) {
      throw new MissingDesignDataError(
        "estimate",
        `no recorded assignments for experiment ${experimentId} arm ${arm} \u2014 the design data is missing`
      );
    }
    return set;
  }

  // src/join/coverage.ts
  function computeCoverage(graph, claimsJoined, claimsTotal) {
    let runsWithKey = 0;
    for (const run of graph.workflowRuns) {
      if ((graph.entityKeysByRun.get(run.id) ?? []).length > 0) runsWithKey += 1;
    }
    const runsTotal = graph.workflowRuns.length;
    return {
      workflowId: graph.contract.workflowId,
      runsTotal,
      runsWithKey,
      runKeyPct: runsTotal === 0 ? 0 : R4_pct(runsWithKey, runsTotal),
      claimsTotal,
      claimsJoined
    };
  }

  // src/intake/preflight.ts
  var DESIGN_GRADE = {
    holdout: "A",
    naturalExperiment: "B",
    preAgentBaseline: "C",
    rules: "D"
  };
  function armReady(index, experimentId, arm) {
    return (index.entityArms.get(experimentId)?.get(arm)?.size ?? 0) > 0;
  }
  function checkDesign(index, design) {
    const base = { kind: design.kind, grade: DESIGN_GRADE[design.kind] };
    switch (design.kind) {
      case "holdout": {
        const missing = [design.treatedArm, design.controlArm].filter((arm) => !armReady(index, design.experimentId, arm));
        return missing.length === 0 ? { ...base, ready: true } : { ...base, ready: false, missing: `no recorded entities in arm(s) ${missing.join(", ")} of ${design.experimentId}` };
      }
      case "naturalExperiment": {
        if (design.form === "twoGroupRoutingGap") {
          return armReady(index, design.experimentId, design.controlArm) ? { ...base, ready: true } : { ...base, ready: false, missing: `no recorded entities in control arm of ${design.experimentId}` };
        }
        const missing = [];
        for (const slice of design.slices) {
          for (const arm of Object.values(slice.arms)) {
            if (!armReady(index, slice.experimentId, arm)) missing.push(`${slice.experimentId}/${arm}`);
          }
        }
        return missing.length === 0 ? { ...base, ready: true } : { ...base, ready: false, missing: `no recorded entities in ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "\u2026" : ""}` };
      }
      case "preAgentBaseline":
        return design.months.length > 0 ? { ...base, ready: true } : { ...base, ready: false, missing: "no baseline months declared" };
      case "rules":
        return { ...base, ready: true };
    }
  }
  function preflightContract(contract, inputs, index, config) {
    const ruleSet = config.extractRuleSets.find((rs) => rs.id === contract.join.extractorRuleSetId);
    if (!ruleSet) throw new EngineError("preflight", `unknown extractor rule set ${contract.join.extractorRuleSetId}`);
    const graph = buildGraph(contract, inputs.runs, index, ruleSet, inputs.actors);
    const claims = graph.workflowRuns.filter((r) => r.claim?.workflowId === contract.workflowId);
    const joinableClaims = claims.filter((r) => (graph.entityKeysByRun.get(r.id) ?? []).length > 0).length;
    const contractEvents = inputs.outcomes.filter(
      (ev) => ev.source === contract.event.source && ev.eventType === contract.event.eventType
    ).length;
    const designs = [contract.counterfactual, ...contract.corroboration ?? []].map((d) => checkDesign(index, d));
    const firstReady = designs.find((d) => d.ready);
    const gradeCeiling = firstReady ? firstReady.grade : "D";
    const coverage = computeCoverage(graph, joinableClaims, claims.length);
    const notes = [];
    if (claims.length === 0) notes.push("No claims found \u2014 check the claim mapping (claim.when filter, workflowId).");
    if (contractEvents === 0) notes.push(`No ${contract.event.eventType} events found in ${contract.event.source} \u2014 the contract cannot verify.`);
    if (joinableClaims < claims.length) {
      notes.push(`${claims.length - joinableClaims} of ${claims.length} claims carry no extractable join key \u2014 they will settle as unjoinable.`);
    }
    for (const d of designs.filter((x) => !x.ready)) {
      notes.push(`${d.kind} (Grade ${d.grade}) cannot run: ${d.missing}.`);
    }
    return {
      workflowId: contract.workflowId,
      runsTotal: coverage.runsTotal,
      runsWithKey: coverage.runsWithKey,
      runKeyPct: coverage.runKeyPct,
      claims: claims.length,
      joinableClaims,
      contractEvents,
      designs,
      gradeCeiling,
      verifiable: claims.length > 0 && contractEvents > 0 && joinableClaims > 0,
      notes
    };
  }
  function preflight(inputs, config) {
    const index = buildOutcomeIndex(inputs.outcomes);
    return { contracts: config.contracts.map((c) => preflightContract(c, inputs, index, config)) };
  }
  function renderPreflight(report) {
    const lines = [];
    lines.push(`# Preflight \u2014 what's verifiable with what's connected`);
    lines.push("");
    for (const c of report.contracts) {
      lines.push(`## ${c.workflowId}`);
      lines.push(`- Verifiable: ${c.verifiable ? "YES" : "NO"} \xB7 evidence-grade ceiling: **${c.gradeCeiling}**`);
      lines.push(`- Activity: ${c.runsTotal} runs, ${c.runsWithKey} with a join key (${c.runKeyPct}%)`);
      lines.push(`- Claims: ${c.claims} (${c.joinableClaims} joinable) \xB7 contract events found: ${c.contractEvents}`);
      for (const d of c.designs) {
        lines.push(`- Design ${d.kind} (Grade ${d.grade}): ${d.ready ? "ready" : `NOT READY \u2014 ${d.missing}`}`);
      }
      for (const n of c.notes) lines.push(`- Note: ${n}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  // src/time.ts
  var DAY_MS = 864e5;
  var HOUR_MS = 36e5;

  // src/outcomes/observatory.ts
  function observe(inputs, windowDays = 30) {
    const notes = [
      "Observed association, not attribution: counts are outcome events on entities each agent's runs touched within the window.",
      "Cost per outcome divides the agent's full spend by that outcome count \u2014 it is the price of observed output, not a causal claim.",
      "Confirming a draft contract (and a baseline design) graduates an agent onto the settled ledger; until then the evidence-grade ceiling is D."
    ];
    const idsByKind = /* @__PURE__ */ new Map();
    const eventsByEntityKey = /* @__PURE__ */ new Map();
    for (const ev of inputs.outcomes) {
      let set = idsByKind.get(ev.entity.kind);
      if (!set) idsByKind.set(ev.entity.kind, set = /* @__PURE__ */ new Set());
      set.add(ev.entity.id);
      const key = `${ev.entity.kind}:${ev.entity.id}`;
      let list = eventsByEntityKey.get(key);
      if (!list) eventsByEntityKey.set(key, list = []);
      list.push(ev);
    }
    const fieldStats = /* @__PURE__ */ new Map();
    for (const run of inputs.runs) {
      for (const [field, value] of Object.entries(run.payload.fields ?? {})) {
        let stat = fieldStats.get(field);
        if (!stat) fieldStats.set(field, stat = { withField: 0, matches: /* @__PURE__ */ new Map() });
        stat.withField += 1;
        for (const [kind, ids] of idsByKind) {
          if (!ids.has(value)) continue;
          let m = stat.matches.get(kind);
          if (!m) stat.matches.set(kind, m = { count: 0, entities: /* @__PURE__ */ new Set(), samples: [] });
          m.count += 1;
          m.entities.add(value);
          if (m.samples.length < 5) m.samples.push(`${field}=${value} \u2192 ${kind}:${value}`);
        }
      }
    }
    const joinKeys = [];
    for (const [field, stat] of fieldStats) {
      for (const [kind, m] of stat.matches) {
        const matchPct = R4_pct(m.count, stat.withField);
        if (m.count >= 3 && matchPct >= 20) {
          joinKeys.push({
            field,
            entityKind: kind,
            runsWithField: stat.withField,
            runsMatchingEntities: m.count,
            matchPct,
            distinctEntities: m.entities.size,
            samples: m.samples
          });
        }
      }
    }
    joinKeys.sort((a, b) => b.runsMatchingEntities - a.runsMatchingEntities || (a.field < b.field ? -1 : 1));
    if (joinKeys.length === 0) {
      notes.push("No join keys found: no run payload field matched outcome entity ids. Check exports share an identifier.");
    }
    const keysByField = /* @__PURE__ */ new Map();
    for (const jk of joinKeys) {
      const kinds = keysByField.get(jk.field) ?? [];
      kinds.push(jk.entityKind);
      keysByField.set(jk.field, kinds);
    }
    const windowMs = windowDays * DAY_MS;
    const actorIds = [...new Set(inputs.runs.map((r) => r.actorId))].sort();
    const agents = [];
    const drafts = [];
    for (const actorId of actorIds) {
      const runs = inputs.runs.filter((r) => r.actorId === actorId);
      const spendCents = runs.reduce((a, r) => a + r.costCents, 0);
      const models = [...new Set(runs.map((r) => r.model).filter((m) => !!m))].sort();
      const touches = [];
      let runsJoined = 0;
      for (const run of runs) {
        let joined = false;
        for (const [field, value] of Object.entries(run.payload.fields ?? {})) {
          for (const kind of keysByField.get(field) ?? []) {
            if (!idsByKind.get(kind).has(value)) continue;
            touches.push({ entityKey: `${kind}:${value}`, runStartMs: Date.parse(run.startedAt) });
            joined = true;
          }
        }
        if (joined) runsJoined += 1;
      }
      const seen = /* @__PURE__ */ new Set();
      const byType = /* @__PURE__ */ new Map();
      for (const t of touches) {
        for (const ev of eventsByEntityKey.get(t.entityKey) ?? []) {
          const evMs = Date.parse(ev.occurredAt);
          if (evMs <= t.runStartMs || evMs - t.runStartMs >= windowMs) continue;
          const dedup = `${ev.id}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          const typeKey = `${ev.source}:${ev.eventType}`;
          let agg = byType.get(typeKey);
          if (!agg) byType.set(typeKey, agg = { count: 0, source: ev.source, entityKind: ev.entity.kind, first: ev.occurredAt, last: ev.occurredAt });
          agg.count += 1;
          if (ev.occurredAt < agg.first) agg.first = ev.occurredAt;
          if (ev.occurredAt > agg.last) agg.last = ev.occurredAt;
        }
      }
      const outputs = [...byType.entries()].map(([typeKey, agg]) => ({
        source: agg.source,
        eventType: typeKey.split(":").slice(1).join(":"),
        entityKind: agg.entityKind,
        count: agg.count,
        costPerOutcomeCents: R2_unitCents(spendCents, agg.count),
        firstSeen: agg.first,
        lastSeen: agg.last
      })).sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1));
      for (const out of outputs) {
        drafts.push({
          actorId,
          volume: out.count,
          draft: { source: out.source, eventType: out.eventType, entityKind: out.entityKind, suggestedQualityBar: null }
        });
      }
      agents.push({
        actorId,
        models,
        runs: runs.length,
        runsJoined,
        joinPct: runs.length === 0 ? 0 : R4_pct(runsJoined, runs.length),
        spendCents,
        outputs,
        unjoinedRuns: runs.length - runsJoined
      });
    }
    agents.sort((a, b) => b.spendCents - a.spendCents || (a.actorId < b.actorId ? -1 : 1));
    return { windowDays, joinKeys, agents, drafts, notes };
  }

  // src/interpret/protocol.ts
  function validateProposals(proposals, requests) {
    const requestIds = requests ? new Set(requests.map((r) => r.id)) : void 0;
    for (const [i, p] of proposals.entries()) {
      const at = `proposal ${i} (${p.requestId})`;
      if (!p.interpreter?.name) throw new EngineError("interpret", `${at}: interpreter provenance is required`);
      if (!["high", "medium", "low"].includes(p.confidence)) {
        throw new EngineError("interpret", `${at}: confidence must be declared (high|medium|low)`);
      }
      if (!Array.isArray(p.rationale) || p.rationale.length === 0) {
        throw new EngineError("interpret", `${at}: a proposal without rationale is not reviewable`);
      }
      if (requestIds && !requestIds.has(p.requestId)) {
        throw new EngineError("interpret", `${at}: references no known request`);
      }
      if (p.payload.kind === "contract") {
        const c = p.payload.contract;
        if (!c.id.startsWith("interpreted-")) {
          throw new EngineError("interpret", `${at}: interpreted contract ids must carry the "interpreted-" prefix \u2014 provenance stays visible`);
        }
        if (c.counterfactual.kind !== "rules") {
          throw new EngineError(
            "interpret",
            `${at}: interpretation enters at the evidence floor (Grade D rules). Counterfactual designs are confirmed by humans from recorded data, never proposed by an interpreter.`
          );
        }
        if (c.billing.kind !== "usage") {
          throw new EngineError("interpret", `${at}: pricing is a settlement term between humans \u2014 interpreted contracts bill as "usage"`);
        }
        if (c.corroboration !== void 0 || c.modelSwitchCompanion !== void 0 || c.expand !== void 0) {
          throw new EngineError("interpret", `${at}: declared aggregates and companion designs come from the customer, not the interpreter`);
        }
        if (c.actorIds.length === 0 || !c.actorIds.includes(c.workflowId)) {
          throw new EngineError("interpret", `${at}: an interpreted contract's workflowId must be one of its actorIds \u2014 that is what routes the derived claims`);
        }
        if (!p.payload.joinField) throw new EngineError("interpret", `${at}: a contract proposal must name its join field`);
      } else if (p.payload.kind === "actors") {
        if (p.payload.actors.length === 0) throw new EngineError("interpret", `${at}: empty actor roster`);
      } else {
        const never = p.payload;
        throw new EngineError("interpret", `${at}: unknown payload ${JSON.stringify(never)} \u2014 interpretation may only propose mappings, rosters, and draft contracts`);
      }
    }
  }
  var TIER0_DEFAULT_VERDICT_RULES = [
    {
      id: "tier0-retire-nothing-verified",
      verdict: "RETIRE",
      priority: 1,
      when: { op: "cmp", metric: "qualityPassPct", cmp: "eq", value: 0 },
      impact: { kind: "spendAtStake" }
    },
    {
      id: "tier0-renegotiate-on-floor-evidence",
      verdict: "RENEGOTIATE",
      priority: 99,
      when: { op: "exists", metric: "qualityPassPct" },
      impact: { kind: "spendAtStake" }
    }
  ];
  var INTERPRETED_RULESET_ID = "interpreted-keys";
  var prettyLabel = (token) => {
    const words = token.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  function applyProposals(engagement, proposals) {
    validateProposals(proposals);
    const notes = [];
    const actors = [...engagement.actors];
    const actorIds = new Set(actors.map((a) => a.id));
    const contracts = [...engagement.contracts];
    const workflowIds = new Set(contracts.map((c) => c.workflowId));
    const extractRuleSets = engagement.extractRuleSets.map((rs) => ({ ...rs, rules: [...rs.rules] }));
    const activitySources = engagement.activitySources.map((s) => ({ ...s, map: { ...s.map } }));
    const activitySourceLabels = { ...engagement.activitySourceLabels };
    let adoptedContracts = 0;
    for (const p of proposals) {
      if (p.payload.kind === "actors") {
        for (const actor of p.payload.actors) {
          if (actorIds.has(actor.id)) continue;
          actorIds.add(actor.id);
          actors.push(actor);
        }
        notes.push(`Adopted actor roster (${p.payload.actors.length} actors) from ${p.interpreter.name}.`);
        continue;
      }
      const { contract, joinField } = p.payload;
      if (workflowIds.has(contract.workflowId)) {
        throw new EngineError("interpret", `adopt: workflow ${contract.workflowId} already has a contract \u2014 interpretation never overwrites confirmed definitions`);
      }
      workflowIds.add(contract.workflowId);
      adoptedContracts += 1;
      let ruleSet = extractRuleSets.find((rs) => rs.id === INTERPRETED_RULESET_ID);
      if (!ruleSet) {
        ruleSet = { id: INTERPRETED_RULESET_ID, rules: [] };
        extractRuleSets.push(ruleSet);
      }
      const rule = { from: "field", field: joinField, entityKind: contract.join.entityKind };
      if (!ruleSet.rules.some((r) => JSON.stringify(r) === JSON.stringify(rule))) ruleSet.rules.push(rule);
      contracts.push({ ...contract, join: { ...contract.join, extractorRuleSetId: INTERPRETED_RULESET_ID } });
      notes.push(
        `Adopted contract ${contract.id} (${p.confidence} confidence, ${p.interpreter.name}): ${contract.event.eventType} in ${contract.event.source}, joined on ${contract.join.entityKind} via "${joinField}" \u2014 Grade D floor until a counterfactual design is confirmed.`
      );
    }
    if (adoptedContracts > 0) {
      for (const spec of activitySources) {
        if (spec.map.claim) continue;
        spec.map.claim = { workflowId: spec.map.actorId, claimedEventType: { const: "outcome" } };
        notes.push(
          `Claim mapping derived on ${spec.file}: every run claims its workflow's outcome (workflowId \u2190 ${typeof spec.map.actorId === "string" ? `column "${spec.map.actorId}"` : JSON.stringify(spec.map.actorId)}); verification does the filtering.`
        );
      }
    }
    for (const spec of activitySources) {
      if (typeof spec.source === "object" && "const" in spec.source) {
        const s = spec.source.const;
        if (!activitySourceLabels[s]) activitySourceLabels[s] = prettyLabel(s);
      }
    }
    const verdictRules = engagement.verdictRules.length > 0 ? engagement.verdictRules : TIER0_DEFAULT_VERDICT_RULES;
    if (engagement.verdictRules.length === 0) {
      notes.push(
        "No verdict policy defined \u2014 adopted the Tier-0 defaults (RETIRE when nothing verifies, otherwise RENEGOTIATE on the evidence; impact = spend at stake). Replace with contract-specific rules deliberately."
      );
    }
    return {
      engagement: {
        ...engagement,
        actors,
        contracts,
        extractRuleSets,
        activitySources,
        activitySourceLabels,
        verdictRules
      },
      notes
    };
  }
  var slug2 = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  var usd = (cents) => `$${(cents / 100).toFixed(2)}`;
  function buildInterpretationRequests(engagement, observatory) {
    const requests = [];
    if (engagement.actors.length === 0 && observatory.agents.length > 0) {
      requests.push({
        id: "req-actor-roster",
        kind: "actorRoster",
        question: "These actor ids appear in the activity exports with no declared roster. Which are agents (and which, if any, are humans)?",
        context: observatory.agents.map(
          (a) => `${a.actorId}: ${a.runs} runs \xB7 ${usd(a.spendCents)} spend \xB7 models [${a.models.join(", ")}] \xB7 ${a.joinPct}% of runs join an outcome entity`
        ),
        samples: []
      });
    }
    for (const agent of observatory.agents) {
      if (agent.outputs.length === 0) continue;
      const top = [...agent.outputs].sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1))[0];
      if (top.count < 10) continue;
      const joinKey = observatory.joinKeys.filter((jk) => jk.entityKind === top.entityKind).sort((a, b) => b.matchPct - a.matchPct || (a.field < b.field ? -1 : 1))[0];
      if (!joinKey) continue;
      const coTypes = agent.outputs.filter((o) => o.entityKind === top.entityKind && o.eventType !== top.eventType).map((o) => `${o.eventType} (${o.count})`);
      requests.push({
        id: `req-outcome-${slug2(agent.actorId)}`,
        kind: "outcomeDefinition",
        question: `${agent.actorId}'s runs join ${top.count} "${top.eventType}" events in ${top.source} on ${top.entityKind} entities. Adopt this as the agent's outcome definition? Do any co-occurring event types negate the outcome (a quality bar)?`,
        context: [
          `join key: run field "${joinKey.field}" matches ${top.entityKind} ids (${joinKey.matchPct}% of ${joinKey.runsWithField} runs carrying it, ${joinKey.distinctEntities} distinct entities)`,
          `observed cost per touched outcome: ${usd(top.costPerOutcomeCents)} (${agent.runs} runs, ${usd(agent.spendCents)} spend)`,
          coTypes.length > 0 ? `co-occurring event types on ${top.entityKind}: ${coTypes.join(", ")}` : `no co-occurring event types observed on ${top.entityKind}`,
          "Observed association, not attribution \u2014 an adopted contract starts at the Grade-D evidence floor."
        ],
        samples: joinKey.samples,
        subject: { actorId: agent.actorId, source: top.source, eventType: top.eventType, entityKind: top.entityKind }
      });
    }
    return requests;
  }
  function renderInterpretation(requests, proposals) {
    const lines = [];
    lines.push("# Interpretation \u2014 proposed definitions awaiting confirmation");
    lines.push("");
    lines.push(
      "Interpretation proposes; it never settles. Review each proposal, DELETE the ones you do not confirm from the proposals file, then run `causa adopt` \u2014 the remainder become the engagement's contracts, at the Grade-D evidence floor, billed as usage until priced by humans."
    );
    lines.push("");
    for (const req of requests) {
      lines.push(`## ${req.id} \u2014 ${req.kind}`);
      lines.push("");
      lines.push(req.question);
      lines.push("");
      for (const c of req.context) lines.push(`- ${c}`);
      if (req.samples.length > 0) lines.push(`- samples: ${req.samples.join(" \xB7 ")}`);
      lines.push("");
      const answers = proposals.filter((p) => p.requestId === req.id);
      if (answers.length === 0) lines.push("_No proposal \u2014 the interpreter declined to answer._");
      for (const p of answers) {
        const head = `**Proposal** (${p.interpreter.name}${p.interpreter.model ? ` \xB7 ${p.interpreter.model}` : ""}, confidence ${p.confidence})`;
        if (p.payload.kind === "actors") {
          lines.push(`${head}: roster of ${p.payload.actors.length} \u2014 ${p.payload.actors.map((a) => `${a.id} (${a.class})`).join(", ")}`);
        } else {
          const c = p.payload.contract;
          lines.push(
            `${head}: contract \`${c.id}\` \u2014 event \`${c.event.eventType}\` in ${c.event.source}, joined on \`${c.join.entityKind}\` via run field \`${p.payload.joinField}\`, quality bar ${c.qualityBar ? JSON.stringify(c.qualityBar) : "none"}, window ${c.windowDays}d, billing usage, counterfactual Grade-D rules floor`
          );
        }
        for (const r of p.rationale) lines.push(`  - ${r}`);
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  // src/interpret/heuristic.ts
  var HEURISTIC_INTERPRETER = { name: "heuristic-v1" };
  var NEGATION_LEXICON = [
    "reopened",
    "reopen",
    "returned",
    "refunded",
    "refund",
    "churned",
    "bounced",
    "rejected",
    "reverted",
    "canceled",
    "cancelled",
    "disputed",
    "chargeback",
    "escalated"
  ];
  var slugId = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function interpretHeuristically(requests, observatory) {
    const proposals = [];
    for (const req of requests) {
      if (req.kind === "actorRoster") {
        const actors = observatory.agents.map((a) => ({
          id: a.actorId,
          class: "agent",
          name: a.actorId
        }));
        proposals.push({
          requestId: req.id,
          interpreter: HEURISTIC_INTERPRETER,
          confidence: "medium",
          rationale: [
            "Every id that produced activity runs is rostered as an agent \u2014 humans cannot be inferred from activity exports and must be added manually."
          ],
          payload: { kind: "actors", actors }
        });
        continue;
      }
      if (req.kind !== "outcomeDefinition" || !req.subject) continue;
      const { actorId, source, eventType, entityKind } = req.subject;
      const agent = observatory.agents.find((a) => a.actorId === actorId);
      if (!agent) continue;
      const joinKey = observatory.joinKeys.filter((jk) => jk.entityKind === entityKind).sort((a, b) => b.matchPct - a.matchPct || (a.field < b.field ? -1 : 1))[0];
      if (!joinKey) continue;
      const negation = agent.outputs.filter(
        (o) => o.entityKind === entityKind && o.eventType !== eventType && NEGATION_LEXICON.some((n) => o.eventType.toLowerCase().includes(n))
      ).sort((a, b) => b.count - a.count || (a.eventType < b.eventType ? -1 : 1))[0];
      const contract = {
        id: `interpreted-${slugId(actorId)}-${slugId(eventType)}`,
        workflowId: actorId,
        event: { source, eventType },
        qualityBar: negation ? { kind: "noEventWithin", eventType: negation.eventType, days: 7 } : null,
        counterfactual: { kind: "rules", wouldHaveHappenedAnyway: { op: "or", of: [] } },
        join: { entityKind, extractorRuleSetId: INTERPRETED_RULESET_ID },
        billing: { kind: "usage" },
        windowDays: observatory.windowDays,
        actorIds: [actorId],
        declaredEventTypes: [eventType, ...negation ? [negation.eventType] : []]
      };
      proposals.push({
        requestId: req.id,
        interpreter: HEURISTIC_INTERPRETER,
        confidence: negation ? "medium" : "high",
        rationale: [
          `Highest-volume joined output for ${actorId}: ${eventType} in ${source} on ${entityKind} (join field "${joinKey.field}", ${joinKey.matchPct}% match).`,
          negation ? `Quality bar proposed: "${negation.eventType}" (${negation.count} observed on the same entities) reads as negating the outcome within 7 days \u2014 confirm the window with the customer.` : `No co-occurring event type on ${entityKind} matches the negation lexicon \u2014 no quality bar proposed; define one with the customer if outcomes can regress.`,
          "Counterfactual: Grade-D rules floor (nothing assumed away). Billing: usage until priced by humans."
        ],
        payload: { kind: "contract", contract, joinField: joinKey.field }
      });
    }
    return proposals;
  }

  // src/levers.ts
  function projectScale(w, addedClaims) {
    const verifyRate = w.verified / w.claimed;
    const attributableRate = w.attributable / Math.max(1, w.verified);
    const spendPerClaim = w.spendCents / w.claimed;
    const projectedVerified = roundHalfUp(addedClaims * verifyRate);
    return {
      addedClaims,
      projectedVerified,
      projectedAttributable: roundHalfUp(projectedVerified * attributableRate),
      projectedSpendCents: roundHalfUp(addedClaims * spendPerClaim),
      assumptions: [
        `Holds this period's rates constant: ${Math.round(verifyRate * 100)}% verify, ${Math.round(attributableRate * 100)}% of verified attributable, spend ${(spendPerClaim / 100).toFixed(2)}/claim.`,
        "Linear extrapolation \u2014 watch for saturation of the input pool; the incrementality rate itself can fall as volume grows.",
        w.estimator.grade === "A" ? "Keep the holdout intact while scaling, or the next statement loses its Grade A evidence." : `Evidence grade ${w.estimator.grade}: re-verify the counterfactual after any large volume change.`
      ]
    };
  }
  function projectObservedScale(a, addedRuns) {
    const primary = a.outputs[0];
    const outputsPerRun = primary ? primary.count / Math.max(1, a.runs) : 0;
    const spendPerRun = a.spendCents / Math.max(1, a.runs);
    return {
      addedRuns,
      projectedOutcomes: roundHalfUp(addedRuns * outputsPerRun),
      projectedSpendCents: roundHalfUp(addedRuns * spendPerRun),
      outputLabel: primary ? `${primary.eventType} (${primary.source})` : "\u2014",
      assumptions: [
        "Observed-output projection (no counterfactual yet): confirm a contract and baseline before treating this as attributable value."
      ]
    };
  }
  function mixOptions(w) {
    const options = [];
    if (w.modelSplit && w.modelSplit.length > 1) {
      const sorted = [...w.modelSplit].sort((a, b) => a.marginalCostPerVerifiedCents - b.marginalCostPerVerifiedCents);
      const cheap = sorted[0];
      const dear = sorted[sorted.length - 1];
      const savings = dear.marginalCostPerVerifiedCents - cheap.marginalCostPerVerifiedCents;
      options.push({
        name: `Shift work from ${dear.model} to ${cheap.model}`,
        detail: `Marginals ${(dear.marginalCostPerVerifiedCents / 100).toFixed(2)} vs ${(cheap.marginalCostPerVerifiedCents / 100).toFixed(2)} per verified outcome. Quality parity must hold \u2014 the model-switch companion checks it.`,
        impactPerMonthDollars: R3_dollars(savings * dear.verified / 100)
      });
    }
    if (w.estimator.perSlice && w.estimator.perSlice.length > 1) {
      const best = [...w.estimator.perSlice].sort((a, b) => b.attributable - a.attributable)[0];
      const worst = [...w.estimator.perSlice].sort((a, b) => a.pointDelta - b.pointDelta)[0];
      if (best.slice !== worst.slice) {
        options.push({
          name: `Route inputs toward the "${best.slice}" pattern`,
          detail: `"${best.slice}" carries ${best.attributable} attributable outcomes; "${worst.slice}" shows a ${worst.pointDelta.toFixed(1)} point delta` + (worst.pointDelta <= 0 ? " \u2014 it is not beating doing nothing." : ".")
        });
      }
    }
    if (options.length === 0) {
      options.push({
        name: "No measured segments yet",
        detail: "Record a model switch, a routing change, or a staged rollout \u2014 the engine turns any of them into Grade B evidence for a mix decision."
      });
    }
    return options;
  }
  function substitutionTable(s) {
    return s.workflows.map((w) => ({
      name: w.workflowId,
      verdict: w.verdict.verdict,
      costPerAttributableCents: w.attributable > 0 ? roundHalfUp(w.spendCents / w.attributable) : void 0,
      outcomeLabel: "attributable outcome",
      stance: w.verdict.verdict === "EXPAND" ? "working \u2014 scale it" : w.verdict.verdict === "RETIRE" ? "not beating doing nothing \u2014 reclaim the spend" : w.verdict.verdict === "REROUTE" ? "same quality available cheaper \u2014 switch the engine" : "priced above its contribution \u2014 renegotiate"
    })).sort((a, b) => (a.costPerAttributableCents ?? Infinity) - (b.costPerAttributableCents ?? Infinity));
  }
  function observedSubstitutionTable(o) {
    return o.agents.map((a) => {
      const primary = a.outputs[0];
      return {
        name: a.actorId,
        costPerOutcomeCents: primary?.costPerOutcomeCents,
        outcomeLabel: primary ? `${primary.eventType} (observed)` : "no joined output",
        stance: primary ? `${primary.count} \xD7 ${primary.eventType} touched for ${(a.spendCents / 100).toFixed(2)} total` : `${a.runs} runs joined to nothing \u2014 invisible work or a missing join key`
      };
    }).sort((a, b) => (a.costPerOutcomeCents ?? Infinity) - (b.costPerOutcomeCents ?? Infinity));
  }

  // src/join/contribution.ts
  var CONTRIBUTION_RULE_ID = "touch-count-v1";
  function qualifyingTouches(graph, entKey, outcomeAtMs) {
    const windowMs = graph.contract.windowDays * DAY_MS;
    return (graph.touchesByEntity.get(entKey) ?? []).filter(
      (t) => t.startedAtMs < outcomeAtMs && outcomeAtMs - t.startedAtMs < windowMs
    );
  }
  function sliceOf(touches) {
    const hasAgent = touches.some((t) => t.actorClass === "agent");
    const hasHuman = touches.some((t) => t.actorClass === "human");
    if (hasAgent && hasHuman) return "assisted";
    if (hasAgent) return "agent_only";
    return "human_only";
  }
  function actorSplit(graph, verified) {
    let agentTouches = 0;
    let humanTouches = 0;
    for (const v of verified) {
      for (const t of qualifyingTouches(graph, v.entityKey, Date.parse(v.occurredAt))) {
        if (t.actorClass === "agent") agentTouches += 1;
        else humanTouches += 1;
      }
    }
    if (humanTouches === 0) return void 0;
    const total = agentTouches + humanTouches;
    return {
      agent: R4_share2(agentTouches, total),
      human: R4_share2(humanTouches, total),
      rule: CONTRIBUTION_RULE_ID,
      agentTouches,
      humanTouches
    };
  }

  // src/verify/verify.ts
  function evaluateQuality(bar, timeline, anchorMs) {
    if (bar === null) return { pass: true };
    switch (bar.kind) {
      case "noEventWithin": {
        const limit = anchorMs + bar.days * DAY_MS;
        const violating = timeline.some((ev) => {
          if (ev.eventType !== bar.eventType) return false;
          const t = Date.parse(ev.occurredAt);
          return t >= anchorMs && t < limit;
        });
        return violating ? { pass: false, reason: `${bar.eventType}_within_${bar.days}d` } : { pass: true };
      }
      case "eventWithin": {
        const limit = anchorMs + bar.hours * HOUR_MS;
        const found = timeline.some((ev) => {
          if (ev.eventType !== bar.eventType) return false;
          const t = Date.parse(ev.occurredAt);
          return t >= anchorMs && t < limit;
        });
        return found ? { pass: true } : { pass: false, reason: `no_${bar.eventType}_within_${bar.hours}h` };
      }
      case "requireEvent":
        return timeline.some((ev) => ev.eventType === bar.eventType) ? { pass: true } : { pass: false, reason: `missing_${bar.eventType}` };
      case "noEventOfType":
        return timeline.some((ev) => ev.eventType === bar.eventType) ? { pass: false, reason: bar.eventType } : { pass: true };
      case "all": {
        for (const sub of bar.of) {
          const r = evaluateQuality(sub, timeline, anchorMs);
          if (!r.pass) return r;
        }
        return { pass: true };
      }
    }
  }
  function entitySatisfiesContract(graph, entKey) {
    const timeline = graph.eventsByEntity.get(entKey) ?? [];
    const event = timeline.find((ev) => ev.eventType === graph.contract.event.eventType);
    if (!event) return false;
    return evaluateQuality(graph.contract.qualityBar, timeline, Date.parse(event.occurredAt)).pass;
  }
  function verifyClaims(graph) {
    var _a;
    const contract = graph.contract;
    const claims = graph.workflowRuns.filter((r) => r.claim?.workflowId === contract.workflowId).sort((a, b) => {
      const ca = a.claim.claimedAt;
      const cb = b.claim.claimedAt;
      return ca < cb ? -1 : ca > cb ? 1 : a.id < b.id ? -1 : 1;
    });
    const verified = [];
    const drop = { didNotHappen: 0, failedQualityBar: 0, unjoinable: 0, duplicateClaim: 0 };
    const qualityFailures = {};
    const qualityFailureSamples = {};
    const duplicateSamples = [];
    const settledEntities = /* @__PURE__ */ new Set();
    for (const run of claims) {
      const keys = graph.entityKeysByRun.get(run.id) ?? [];
      if (keys.length === 0) {
        drop.unjoinable += 1;
        continue;
      }
      if (keys.length > 1) {
        throw new EngineError("verify", `claim run ${run.id} joins ${keys.length} entities \u2014 ambiguous claim`);
      }
      const entKey = keys[0];
      if (settledEntities.has(entKey)) {
        drop.duplicateClaim += 1;
        if (duplicateSamples.length < 5) duplicateSamples.push(entKey);
        continue;
      }
      const timeline = graph.eventsByEntity.get(entKey) ?? [];
      const runStartMs = Date.parse(run.startedAt);
      const windowMs = contract.windowDays * DAY_MS;
      const event = timeline.find((ev) => {
        if (ev.eventType !== contract.event.eventType) return false;
        const t = Date.parse(ev.occurredAt);
        return t >= runStartMs && t - runStartMs < windowMs;
      });
      if (!event) {
        drop.didNotHappen += 1;
        continue;
      }
      settledEntities.add(entKey);
      const anchorMs = Date.parse(event.occurredAt);
      const quality = evaluateQuality(contract.qualityBar, timeline, anchorMs);
      if (!quality.pass) {
        drop.failedQualityBar += 1;
        qualityFailures[quality.reason] = (qualityFailures[quality.reason] ?? 0) + 1;
        const samples = qualityFailureSamples[_a = quality.reason] ?? (qualityFailureSamples[_a] = []);
        if (samples.length < 5) samples.push(entKey);
        continue;
      }
      verified.push({
        claimRunId: run.id,
        actorId: run.actorId,
        model: run.model,
        entityKey: entKey,
        outcomeEventId: event.id,
        occurredAt: event.occurredAt,
        slice: sliceOf(qualifyingTouches(graph, entKey, anchorMs))
      });
    }
    const claimed = claims.length;
    const report = {
      workflowId: contract.workflowId,
      claimed,
      verified,
      drop,
      qualityFailures,
      qualityFailureSamples,
      duplicateSamples,
      qualityPassPct: claimed === 0 ? 0 : R4_pct(verified.length, claimed)
    };
    const accounted = verified.length + drop.didNotHappen + drop.failedQualityBar + drop.unjoinable + drop.duplicateClaim;
    if (accounted !== claimed) {
      throw new EngineError("verify", `funnel conservation violated: ${claimed} claimed vs ${accounted} accounted`);
    }
    return report;
  }

  // src/join/shapley.ts
  var SHAPLEY_MAX_ACTORS_DEFAULT = 12;
  function computeShapleyCredit(graph, verified, maxActors = SHAPLEY_MAX_ACTORS_DEFAULT) {
    const classById = /* @__PURE__ */ new Map();
    const coalitionByEntity = /* @__PURE__ */ new Map();
    for (const [entKey, touches] of graph.touchesByEntity) {
      const ids = [...new Set(touches.map((t) => t.actorId))].sort((a, b) => a < b ? -1 : 1);
      coalitionByEntity.set(entKey, ids);
      for (const t of touches) classById.set(t.actorId, t.actorClass);
    }
    if (coalitionByEntity.size === 0) return void 0;
    const actorIds = [...classById.keys()].sort((a, b) => a < b ? -1 : 1);
    const m = actorIds.length;
    if (m > maxActors) {
      throw new EngineError(
        "credit",
        `shapley-coalition-v1 asked for ${m} actors but the exact-enumeration cap is ${maxActors} \u2014 raise credit.maxActors deliberately or fall back to touch-count-v1`
      );
    }
    const indexById = new Map(actorIds.map((id, i) => [id, i]));
    const cellByMask = /* @__PURE__ */ new Map();
    for (const [entKey, ids] of coalitionByEntity) {
      let mask = 0;
      for (const id of ids) mask |= 1 << indexById.get(id);
      let cell = cellByMask.get(mask);
      if (!cell) cellByMask.set(mask, cell = { n: 0, k: 0 });
      cell.n += 1;
      if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
    }
    const size = 1 << m;
    const v = new Float64Array(size);
    for (let mask = 1; mask < size; mask++) {
      const observed = cellByMask.get(mask);
      let best = observed ? observed.k / observed.n : 0;
      for (let i = 0; i < m; i++) {
        if (mask & 1 << i) best = Math.max(best, v[mask & ~(1 << i)]);
      }
      v[mask] = best;
    }
    const factorial = (x) => {
      let acc = 1;
      for (let i = 2; i <= x; i++) acc *= i;
      return acc;
    };
    const weight = [];
    for (let s = 0; s < m; s++) weight[s] = factorial(s) * factorial(m - 1 - s) / factorial(m);
    const popcount = (x) => {
      let c = 0;
      while (x) {
        x &= x - 1;
        c += 1;
      }
      return c;
    };
    const phi = new Array(m).fill(0);
    for (let mask = 0; mask < size; mask++) {
      const s = popcount(mask);
      for (let i = 0; i < m; i++) {
        if (mask & 1 << i) continue;
        phi[i] += weight[s] * (v[mask | 1 << i] - v[mask]);
      }
    }
    const total = phi.reduce((a, b) => a + b, 0);
    const exactShares = phi.map((x) => total > 0 ? x / total : 0);
    const raw = exactShares.map((s) => s * verified);
    const floors = raw.map(Math.floor);
    let remaining = verified - floors.reduce((a, b) => a + b, 0);
    const order = actorIds.map((id, i) => ({ i, rem: raw[i] - floors[i], id })).sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
    const equivalents = [...floors];
    for (const { i } of order) {
      if (remaining <= 0) break;
      equivalents[i] += 1;
      remaining -= 1;
    }
    let agentPhi = 0;
    let humanPhi = 0;
    for (let i = 0; i < m; i++) {
      if (classById.get(actorIds[i]) === "agent") agentPhi += phi[i];
      else humanPhi += phi[i];
    }
    const coalitions = [...cellByMask.entries()].map(([mask, cell]) => ({
      actors: actorIds.filter((_, i) => mask & 1 << i),
      n: cell.n,
      k: cell.k
    })).sort((a, b) => a.actors.join("|") < b.actors.join("|") ? -1 : 1);
    const share2 = (x) => roundHalfUp(x * 100) / 100;
    return {
      method: "shapley-coalition-v1",
      perActor: actorIds.map((id, i) => ({
        actorId: id,
        actorClass: classById.get(id),
        share: share2(exactShares[i]),
        verifiedEquivalent: equivalents[i]
      })),
      agentShare: total > 0 ? share2(agentPhi / total) : 0,
      humanShare: total > 0 ? share2(humanPhi / total) : 0,
      coalitions,
      coverage: {
        entities: coalitionByEntity.size,
        observedCoalitions: cellByMask.size,
        closedCoalitions: size - 1 - cellByMask.size
      },
      assumptions: [
        "Coalition value = share of coalition-touched entities satisfying the contract (event + quality bar), no claim anchor.",
        "Unobserved coalitions take the best observed subset's value (monotone closure) \u2014 marginal contributions stay non-negative.",
        "Observational credit shares over recorded touches, not counterfactual attribution: the coalition mix was not randomized."
      ]
    };
  }

  // src/verify/integrity.ts
  var INTEGRITY_THRESHOLDS = {
    /** duplicate-claim-rate: % of claims double-billing a settled entity. */
    duplicateWarnPct: 2,
    duplicateFlagPct: 5,
    /** retroactive-claims: claim stamped ≥ 24h after the outcome it asserts. */
    retroactiveLagMs: 24 * 36e5,
    retroactiveWarnPct: 1,
    retroactiveFlagPct: 5,
    /** claim-burst: one actor's max daily claims vs their median active day. */
    burstMinClaims: 30,
    burstWarnRatio: 5,
    burstWarnMax: 20,
    burstFlagRatio: 10,
    burstFlagMax: 50,
    /** entity-splitting: distinct claimed ids collapsing under canonicalization. */
    splitFlagPctOfEntities: 1,
    /** window-edge-concentration: verified outcomes landing in the window's last 10%. */
    edgeTailShare: 0.9,
    edgeWarnPct: 15,
    edgeFlagPct: 30,
    /** actor-verify-rate-outlier: per-actor verify rate vs the workflow's. */
    outlierMinClaims: 20,
    outlierDeltaPts: 25,
    /** Small-sample gate: rate checks need at least this many observations. */
    minSample: 20
  };
  function medianLowerMiddle(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
  var pct = (num, den) => den > 0 ? 100 * num / den : 0;
  var round1 = (x) => Math.floor(x * 10 + 0.5) / 10;
  function runIntegrity(graph, report) {
    const T = INTEGRITY_THRESHOLDS;
    const findings = [];
    const contract = graph.contract;
    const claims = graph.workflowRuns.filter((r) => r.claim?.workflowId === contract.workflowId);
    const runsById = new Map(graph.workflowRuns.map((r) => [r.id, r]));
    const claimed = report.claimed;
    const verified = report.verified;
    if (claimed >= T.minSample) {
      const rate = round1(pct(report.drop.duplicateClaim, claimed));
      if (rate >= T.duplicateWarnPct) {
        findings.push({
          check: "duplicate-claim-rate",
          severity: rate >= T.duplicateFlagPct ? "flag" : "warn",
          observed: rate,
          threshold: rate >= T.duplicateFlagPct ? T.duplicateFlagPct : T.duplicateWarnPct,
          detail: `${report.drop.duplicateClaim} of ${claimed} claims (${rate}%) re-billed an already-settled entity.`,
          samples: report.duplicateSamples ?? []
        });
      }
    }
    if (verified.length >= T.minSample) {
      let retro = 0;
      const samples = [];
      for (const v of verified) {
        const run = runsById.get(v.claimRunId);
        const claimedAt = run?.claim ? Date.parse(run.claim.claimedAt) : NaN;
        if (Number.isFinite(claimedAt) && claimedAt - Date.parse(v.occurredAt) >= T.retroactiveLagMs) {
          retro += 1;
          if (samples.length < 5) samples.push(v.entityKey);
        }
      }
      const rate = round1(pct(retro, verified.length));
      if (rate >= T.retroactiveWarnPct) {
        findings.push({
          check: "retroactive-claims",
          severity: rate >= T.retroactiveFlagPct ? "flag" : "warn",
          observed: rate,
          threshold: rate >= T.retroactiveFlagPct ? T.retroactiveFlagPct : T.retroactiveWarnPct,
          detail: `${retro} of ${verified.length} verified outcomes (${rate}%) were claimed \u2265 24h AFTER the outcome occurred \u2014 claims should precede or accompany the outcome, not chase it.`,
          samples
        });
      }
    }
    const byActor = /* @__PURE__ */ new Map();
    for (const run of claims) {
      let list = byActor.get(run.actorId);
      if (!list) byActor.set(run.actorId, list = []);
      list.push(run);
    }
    for (const [actorId, actorClaims] of [...byActor.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
      if (actorClaims.length < T.burstMinClaims) continue;
      const daily = /* @__PURE__ */ new Map();
      for (const run of actorClaims) {
        const day = Math.floor(Date.parse(run.claim.claimedAt) / DAY_MS);
        daily.set(day, (daily.get(day) ?? 0) + 1);
      }
      const counts = [...daily.values()];
      const max = Math.max(...counts);
      const median = Math.max(1, medianLowerMiddle(counts));
      const ratio = round1(max / median);
      const isFlag = ratio >= T.burstFlagRatio && max >= T.burstFlagMax;
      const isWarn = ratio >= T.burstWarnRatio && max >= T.burstWarnMax;
      if (isFlag || isWarn) {
        findings.push({
          check: "claim-burst",
          severity: isFlag ? "flag" : "warn",
          observed: ratio,
          threshold: isFlag ? T.burstFlagRatio : T.burstWarnRatio,
          detail: `${actorId}: peak day carried ${max} claims vs a median active day of ${median} (${ratio}\xD7).`,
          samples: [actorId]
        });
      }
    }
    const canonicalGroups = /* @__PURE__ */ new Map();
    for (const run of claims) {
      for (const entKey of graph.entityKeysByRun.get(run.id) ?? []) {
        const sep = entKey.indexOf(":");
        const canonical = `${entKey.slice(0, sep)}:${entKey.slice(sep + 1).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        let group = canonicalGroups.get(canonical);
        if (!group) canonicalGroups.set(canonical, group = /* @__PURE__ */ new Set());
        group.add(entKey);
      }
    }
    const collisions = [...canonicalGroups.entries()].filter(([, group]) => group.size > 1).sort(([a], [b]) => a < b ? -1 : 1);
    if (collisions.length > 0) {
      const extraIds = collisions.reduce((acc, [, g]) => acc + g.size - 1, 0);
      const ratePct = round1(pct(extraIds, canonicalGroups.size));
      findings.push({
        check: "entity-splitting",
        severity: ratePct >= T.splitFlagPctOfEntities ? "flag" : "warn",
        observed: collisions.length,
        threshold: 1,
        detail: `${collisions.length} canonical entities were claimed under ${collisions.length + extraIds} distinct ids (e.g. case/punctuation variants) \u2014 possible double-billing via entity splitting.`,
        samples: collisions.slice(0, 5).map(([, group]) => [...group].sort().join(" \u2194 "))
      });
    }
    if (verified.length >= T.minSample) {
      const windowMs = contract.windowDays * DAY_MS;
      let tail = 0;
      const samples = [];
      for (const v of verified) {
        const run = runsById.get(v.claimRunId);
        if (!run) continue;
        const lag = Date.parse(v.occurredAt) - Date.parse(run.startedAt);
        if (lag >= T.edgeTailShare * windowMs) {
          tail += 1;
          if (samples.length < 5) samples.push(v.entityKey);
        }
      }
      const rate = round1(pct(tail, verified.length));
      if (rate >= T.edgeWarnPct) {
        findings.push({
          check: "window-edge-concentration",
          severity: rate >= T.edgeFlagPct ? "flag" : "warn",
          observed: rate,
          threshold: rate >= T.edgeFlagPct ? T.edgeFlagPct : T.edgeWarnPct,
          detail: `${tail} of ${verified.length} verified outcomes (${rate}%) landed in the final 10% of the ${contract.windowDays}-day join window \u2014 natural lag distributions decay, they do not pile up at the edge.`,
          samples
        });
      }
    }
    if (claimed >= T.minSample) {
      const overallPct = pct(verified.length, claimed);
      const verifiedByActor = /* @__PURE__ */ new Map();
      for (const v of verified) verifiedByActor.set(v.actorId, (verifiedByActor.get(v.actorId) ?? 0) + 1);
      for (const [actorId, actorClaims] of [...byActor.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
        if (actorClaims.length < T.outlierMinClaims) continue;
        const actorPct = pct(verifiedByActor.get(actorId) ?? 0, actorClaims.length);
        const deltaPts = round1(Math.abs(actorPct - overallPct));
        if (deltaPts >= T.outlierDeltaPts) {
          findings.push({
            check: "actor-verify-rate-outlier",
            severity: "info",
            observed: deltaPts,
            threshold: T.outlierDeltaPts,
            detail: `${actorId}: verify rate ${round1(actorPct)}% vs workflow ${round1(overallPct)}% (\u0394 ${deltaPts}pts over ${actorClaims.length} claims).`,
            samples: [actorId]
          });
        }
      }
    }
    const rank = { flag: 0, warn: 1, info: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.check < b.check ? -1 : 1));
    return { workflowId: contract.workflowId, checksRun: 6, findings };
  }

  // src/outcomes/identify.ts
  function findNoEventWithinBar(bar) {
    if (!bar) return void 0;
    if (bar.kind === "noEventWithin") return { eventType: bar.eventType, days: bar.days };
    if (bar.kind === "all") {
      for (const sub of bar.of) {
        const found = findNoEventWithinBar(sub);
        if (found) return found;
      }
    }
    return void 0;
  }
  function boundaryCandidate(item, widenedDays) {
    const { graph, report } = item;
    const bar = findNoEventWithinBar(graph.contract.qualityBar);
    if (!bar || report.verified.length === 0) return void 0;
    const entities = [];
    let firstSeen;
    let lastSeen;
    for (const v of report.verified) {
      const anchorMs = Date.parse(v.occurredAt);
      const from = anchorMs + bar.days * DAY_MS;
      const to = anchorMs + widenedDays * DAY_MS;
      const hit = (graph.eventsByEntity.get(v.entityKey) ?? []).find((ev) => {
        if (ev.eventType !== bar.eventType) return false;
        const t = Date.parse(ev.occurredAt);
        return t >= from && t < to;
      });
      if (!hit) continue;
      entities.push(v.entityKey);
      if (!firstSeen || hit.occurredAt < firstSeen) firstSeen = hit.occurredAt;
      if (!lastSeen || hit.occurredAt > lastSeen) lastSeen = hit.occurredAt;
    }
    if (entities.length === 0) return void 0;
    const pct2 = Math.round(100 * entities.length / report.verified.length);
    return {
      kind: "qualityBarBoundary",
      source: graph.contract.event.source,
      eventType: bar.eventType,
      count: entities.length,
      workflowId: graph.contract.workflowId,
      pctOfVerified: pct2,
      draft: {
        source: graph.contract.event.source,
        eventType: graph.contract.event.eventType,
        entityKind: graph.contract.join.entityKind,
        suggestedQualityBar: { kind: "noEventWithin", eventType: bar.eventType, days: widenedDays }
      },
      context: [
        `${entities.length} verified outcomes (${pct2}%) had a ${bar.eventType} land after day ${bar.days} but inside day ${widenedDays} \u2014 just past the quality bar.`,
        `Widening the bar to ${widenedDays} days would count them as failures.`
      ],
      sampleEntities: entities.slice(0, 5),
      firstSeen,
      lastSeen
    };
  }
  function unpricedFailureCandidates(item) {
    const { graph, report, dispute } = item;
    if (dispute) return [];
    return Object.entries(report.qualityFailures).sort(([a], [b]) => a < b ? -1 : 1).map(([reason, count]) => ({
      kind: "unpricedQualityFailures",
      source: graph.contract.event.source,
      eventType: reason,
      count,
      workflowId: graph.contract.workflowId,
      context: [
        `${count} claims failed the quality bar (${reason}) and no billing line prices the failure.`,
        "Counting these as a contracted outcome (or pricing the failure) would make the loss visible."
      ],
      sampleEntities: (report.qualityFailureSamples?.[reason] ?? []).slice(0, 5)
    }));
  }
  function duplicateCandidate(item) {
    const { graph, report } = item;
    if (report.drop.duplicateClaim === 0) return void 0;
    return {
      kind: "duplicateClaims",
      source: graph.contract.event.source,
      eventType: graph.contract.event.eventType,
      count: report.drop.duplicateClaim,
      workflowId: graph.contract.workflowId,
      context: [
        `${report.drop.duplicateClaim} claims assert outcomes already settled by an earlier claim \u2014 double-billed work.`
      ],
      sampleEntities: (report.duplicateSamples ?? []).slice(0, 5)
    };
  }
  function uncontractedCandidates(items) {
    const declaredEverywhere = new Set(items.flatMap((i) => i.graph.contract.declaredEventTypes));
    const seenEventIds = /* @__PURE__ */ new Set();
    const clusters = /* @__PURE__ */ new Map();
    for (const { graph } of items) {
      for (const [entKey, touches] of graph.touchesByEntity) {
        if (touches.length === 0) continue;
        for (const ev of graph.eventsByEntity.get(entKey) ?? []) {
          if (declaredEverywhere.has(ev.eventType)) continue;
          if (seenEventIds.has(ev.id)) continue;
          seenEventIds.add(ev.id);
          const key = `${ev.source}:${ev.eventType}`;
          let cluster = clusters.get(key);
          if (!cluster) {
            clusters.set(
              key,
              cluster = {
                events: [],
                entities: /* @__PURE__ */ new Set(),
                workflowId: graph.contract.workflowId,
                entityKind: graph.contract.join.entityKind
              }
            );
          }
          cluster.events.push(ev);
          cluster.entities.add(entKey);
        }
      }
    }
    return [...clusters.values()].sort((a, b) => b.events.length - a.events.length || (a.events[0].id < b.events[0].id ? -1 : 1)).map((cluster) => {
      const first = cluster.events.reduce((min, e) => e.occurredAt < min ? e.occurredAt : min, cluster.events[0].occurredAt);
      const last = cluster.events.reduce((max, e) => e.occurredAt > max ? e.occurredAt : max, cluster.events[0].occurredAt);
      const ev = cluster.events[0];
      return {
        kind: "uncontractedOutcome",
        source: ev.source,
        eventType: ev.eventType,
        count: cluster.events.length,
        workflowId: cluster.workflowId,
        draft: {
          source: ev.source,
          eventType: ev.eventType,
          entityKind: cluster.entityKind,
          suggestedQualityBar: null
        },
        context: [
          `${cluster.events.length} ${ev.eventType} events in ${ev.source} occur on ${cluster.entityKind} entities the ${cluster.workflowId} agent's runs touch. No outcome contract covers them.`,
          "Confirming the draft contract would bring these outcomes onto the ledger."
        ],
        sampleEntities: [...cluster.entities].sort().slice(0, 5),
        firstSeen: first,
        lastSeen: last
      };
    });
  }
  function interpretCandidates(items, widenedDays) {
    const candidates = [];
    for (const item of items) {
      const boundary = boundaryCandidate(item, widenedDays);
      if (boundary) candidates.push(boundary);
      candidates.push(...unpricedFailureCandidates(item));
      const duplicate = duplicateCandidate(item);
      if (duplicate) candidates.push(duplicate);
    }
    candidates.push(...uncontractedCandidates(items));
    return candidates;
  }

  // src/causal/stats.ts
  var Z95 = 1.959963985;
  function wilson(k, n, z = Z95) {
    if (n <= 0) return { lo: 0, hi: 1 };
    const p = k / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
    return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
  }

  // src/causal/robustness.ts
  function signedRound(x, dp) {
    const scale = 10 ** dp;
    const rounded = roundHalfUp(Math.abs(x) * scale) / scale;
    return x < 0 ? -rounded : rounded;
  }
  function breakEven(verified, counterfactualCount) {
    if (verified <= 0) return void 0;
    if (counterfactualCount <= 0) {
      return {
        factor: null,
        note: "Measured counterfactual is zero; attribution erases only if every verified outcome would have happened anyway \u2014 no finite break-even factor."
      };
    }
    const factor = signedRound(verified / counterfactualCount, 2);
    const note = factor <= 1 ? `Estimate is at or below break-even already (counterfactual ${counterfactualCount} \u2265 verified ${verified} would zero it at factor ${factor}).` : `The measured counterfactual (${counterfactualCount}) would have to be ${factor}\xD7 larger to erase the attributable delta.`;
    return { factor, note };
  }

  // src/causal/cells.ts
  function armCell(graph, experimentId, arm) {
    const entities = armEntities(graph, experimentId, arm);
    let k = 0;
    for (const entKey of entities) {
      if (entitySatisfiesContract(graph, entKey)) k += 1;
    }
    return { entities, n: entities.size, k };
  }

  // src/causal/holdout.ts
  function stratumOf(graph, entKey, field) {
    for (const ev of graph.eventsByEntity.get(entKey) ?? []) {
      const value = ev.fields?.[field];
      if (value !== void 0) return String(value);
    }
    return "(unstratified)";
  }
  function postStratify(graph, field, treatedEntities, controlEntities, verified, primaryCf) {
    const strata = /* @__PURE__ */ new Map();
    const cellFor = (stratum) => {
      let cell = strata.get(stratum);
      if (!cell) strata.set(stratum, cell = { treated: { n: 0, k: 0 }, control: { n: 0, k: 0 } });
      return cell;
    };
    for (const entKey of treatedEntities) {
      const cell = cellFor(stratumOf(graph, entKey, field)).treated;
      cell.n += 1;
      if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
    }
    for (const entKey of controlEntities) {
      const cell = cellFor(stratumOf(graph, entKey, field)).control;
      cell.n += 1;
      if (entitySatisfiesContract(graph, entKey)) cell.k += 1;
    }
    const nT = treatedEntities.size;
    const nC = controlEntities.size;
    let cfRaw = 0;
    let maxShareDivergencePts = 0;
    const rows = [];
    for (const [stratum, cell] of [...strata.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
      rows.push({ stratum, treated: cell.treated, control: cell.control });
      if (cell.treated.n > 0 && cell.control.n === 0) {
        return {
          skippedNote: `Post-stratification by '${field}' skipped: treated stratum '${stratum}' has no control entities to project from.`
        };
      }
      if (cell.control.n > 0) cfRaw += cell.control.k / cell.control.n * cell.treated.n;
      const divergencePts = Math.abs(cell.treated.n / nT - cell.control.n / nC) * 100;
      maxShareDivergencePts = Math.max(maxShareDivergencePts, divergencePts);
    }
    const settled = settleCounterfactual(verified, cfRaw);
    const divergedPts = verified > 0 ? Math.abs(settled.counterfactual - primaryCf) / verified * 100 : 0;
    const agreesWithPrimary = divergedPts <= 5;
    return {
      counterfactual: settled.counterfactual,
      attributable: settled.attributable,
      strata: rows,
      maxShareDivergencePts: signedRound(maxShareDivergencePts, 1),
      agreesWithPrimary,
      note: agreesWithPrimary ? `Post-stratified counterfactual ${settled.counterfactual} agrees with the primary ${primaryCf} (gap ${signedRound(divergedPts, 1)}% of verified \u2264 5%): the arms are mix-balanced on '${field}'.` : `Post-stratified counterfactual ${settled.counterfactual} diverges from the primary ${primaryCf} by ${signedRound(divergedPts, 1)}% of verified: the arms are mix-imbalanced on '${field}' \u2014 the adjusted figure is the fragility bound.`
    };
  }
  function estimateHoldout(graph, report, design) {
    const treated = armCell(graph, design.experimentId, design.treatedArm);
    const control = armCell(graph, design.experimentId, design.controlArm);
    for (const entKey of control.entities) {
      const touched = (graph.touchesByEntity.get(entKey) ?? []).some((t) => t.actorClass === "agent");
      if (touched) {
        throw new EngineError("estimate", `holdout exclusion violated: agent touched control entity ${entKey}`);
      }
    }
    for (const v of report.verified) {
      if (!treated.entities.has(v.entityKey)) {
        throw new EngineError("estimate", `verified entity ${v.entityKey} is not in the treated arm`);
      }
    }
    const verified = report.verified.length;
    const { counterfactual, attributable } = settleCounterfactual(verified, control.k * treated.n / control.n);
    const wT = wilson(verified, treated.n);
    const wC = wilson(control.k, control.n);
    const lo = wT.lo > 0 ? clamp(1 - wC.hi / wT.lo, 0, 1) : 0;
    const hi = wT.hi > 0 ? clamp(1 - wC.lo / wT.hi, 0, 1) : 0;
    const robustness = {};
    const notes = [
      `Control quality-passing rate ${control.k}/${control.n} projected onto ${treated.n} treated units \u2192 ${counterfactual} would have happened anyway.`
    ];
    const be = breakEven(verified, counterfactual);
    if (be) robustness.breakEven = be;
    if (design.stratifyBy) {
      const ps = postStratify(graph, design.stratifyBy.field, treated.entities, control.entities, verified, counterfactual);
      if ("skippedNote" in ps) notes.push(ps.skippedNote);
      else robustness.postStratified = ps;
    }
    return {
      grade: "A",
      designKind: "holdout",
      counterfactualCount: counterfactual,
      attributable,
      incrementality: { num: attributable, den: verified },
      interval: { lo, hi, level: 0.95, method: "wilson-newcombe" },
      robustness,
      cells: {
        treated: { n: treated.n, k: verified },
        control: { n: control.n, k: control.k }
      },
      assumptions: [
        "Assignment recorded at unit level before the period; the engine reads arms, it does not randomize.",
        "Exclusion verified: no agent-class touch exists on any control-arm entity."
      ],
      notes
    };
  }

  // src/causal/did.ts
  function estimateDidStagedRollout(graph, report, design) {
    const verifiedBySlice = /* @__PURE__ */ new Map();
    for (const v of report.verified) {
      verifiedBySlice.set(v.slice, (verifiedBySlice.get(v.slice) ?? 0) + 1);
    }
    const configured = new Set(design.slices.map((s) => s.slice));
    for (const [slice, count] of verifiedBySlice) {
      if (!configured.has(slice)) {
        throw new EngineError("estimate", `${count} verified outcomes in slice ${slice} but the design has no cells for it`);
      }
    }
    const perSlice = [];
    const cells = {};
    const notes = [];
    const placeboNotes = [];
    let attributable = 0;
    let cfLoSum = 0;
    let cfHiSum = 0;
    let worstPlaceboPts = 0;
    let placeboLimitPts = 0;
    let placeboPass = true;
    let placeboRan = false;
    for (const sliceDesign of design.slices) {
      const { slice, experimentId, arms } = sliceDesign;
      const preT = armCell(graph, experimentId, arms.treatedPre);
      const preC = armCell(graph, experimentId, arms.controlPre);
      const postC = armCell(graph, experimentId, arms.controlPost);
      const postT = armCell(graph, experimentId, arms.treatedPost);
      const verifiedSlice = verifiedBySlice.get(slice) ?? 0;
      if (postT.k !== verifiedSlice) {
        throw new EngineError(
          "estimate",
          `slice ${slice}: treated-post cell has ${postT.k} contract-satisfying entities but ${verifiedSlice} verified via claims \u2014 the join and the design disagree`
        );
      }
      const expectedRate = preT.k / preT.n + (postC.k / postC.n - preC.k / preC.n);
      const cfRaw = expectedRate * postT.n;
      const settled = settleCounterfactual(verifiedSlice, cfRaw);
      attributable += settled.attributable;
      const preGapPts = signedRound((preT.k / preT.n - preC.k / preC.n) * 100, 1);
      notes.push(
        `${slice}: pre-period treated\u2212control gap ${preGapPts >= 0 ? "+" : ""}${preGapPts}pts is netted out by the DiD (parallel trends carries it forward).`
      );
      const cellVar = (cell) => {
        const p = cell.k / cell.n;
        return p * (1 - p) / cell.n;
      };
      const sdCf = postT.n * Math.sqrt(cellVar(preT) + cellVar(preC) + cellVar(postC));
      cfLoSum += clamp(cfRaw - Z95 * sdCf, 0, postT.n);
      cfHiSum += clamp(cfRaw + Z95 * sdCf, 0, postT.n);
      if (sliceDesign.placebo) {
        placeboLimitPts = Math.max(placeboLimitPts, sliceDesign.placebo.maxAbsDeltaPts);
        try {
          const ppT = armCell(graph, experimentId, sliceDesign.placebo.arms.prePreTreated);
          const ppC = armCell(graph, experimentId, sliceDesign.placebo.arms.prePreControl);
          const placeboPts = signedRound(
            (preT.k / preT.n - ppT.k / ppT.n - (preC.k / preC.n - ppC.k / ppC.n)) * 100,
            1
          );
          const pass = Math.abs(placeboPts) <= sliceDesign.placebo.maxAbsDeltaPts;
          placeboRan = true;
          worstPlaceboPts = Math.max(worstPlaceboPts, Math.abs(placeboPts));
          if (!pass) placeboPass = false;
          placeboNotes.push(
            `${slice}: placebo DiD over pre-pre \u2192 pre estimates ${placeboPts >= 0 ? "+" : ""}${placeboPts}pts where truth is 0 (limit \xB1${sliceDesign.placebo.maxAbsDeltaPts}pts) \u2014 ${pass ? "pass" : "FAIL: the design moves when nothing happened; treat the estimate as fragile"}.`
          );
        } catch (err) {
          if (!(err instanceof MissingDesignDataError)) throw err;
          notes.push(`${slice}: placebo configured but its pre-pre arm data is missing \u2014 placebo not run.`);
        }
      }
      perSlice.push({
        slice,
        verified: verifiedSlice,
        counterfactual: settled.counterfactual,
        attributable: settled.attributable,
        pointDelta: verifiedSlice - Math.max(0, cfRaw),
        cells: {
          treatedPre: { n: preT.n, k: preT.k },
          controlPre: { n: preC.n, k: preC.k },
          controlPost: { n: postC.n, k: postC.k },
          treatedPost: { n: postT.n, k: postT.k }
        }
      });
      for (const [name, cell] of Object.entries(perSlice[perSlice.length - 1].cells)) {
        cells[`${slice}.${name}`] = cell;
      }
    }
    const verified = report.verified.length;
    const counterfactualCount = verified - attributable;
    const robustness = {};
    const be = breakEven(verified, counterfactualCount);
    if (be) robustness.breakEven = be;
    if (placeboRan) {
      robustness.placebo = {
        deltaPts: signedRound(worstPlaceboPts, 1),
        maxAbsDeltaPts: placeboLimitPts,
        pass: placeboPass,
        notes: placeboNotes
      };
    }
    return {
      grade: "B",
      designKind: "naturalExperiment",
      counterfactualCount,
      attributable,
      incrementality: { num: attributable, den: verified },
      interval: verified > 0 ? {
        lo: clamp(1 - cfHiSum / verified, 0, 1),
        hi: clamp(1 - cfLoSum / verified, 0, 1),
        level: 0.95,
        method: "did-wald-additive"
      } : void 0,
      robustness,
      perSlice,
      cells,
      assumptions: [
        "Parallel trends: treated and control pods would have moved together absent the rollout.",
        "Rollout timing recorded and independent of outcome propensity.",
        "Negative slice estimates are clamped to zero attribution; the negative point delta is preserved as evidence.",
        "Interval sums per-slice Wald bands on the expected rate \u2014 conservative (assumes worst-case dependence across slices)."
      ],
      notes: [
        ...perSlice.map(
          (s) => `${s.slice}: ${s.verified} verified vs ${s.counterfactual} expected anyway (point delta ${s.pointDelta >= 0 ? "+" : ""}${s.pointDelta.toFixed(1)}).`
        ),
        ...notes
      ]
    };
  }
  function estimateTwoGroupRoutingGap(graph, report, design) {
    const control = armCell(graph, design.experimentId, design.controlArm);
    const verified = report.verified.length;
    const attempts = report.claimed;
    const rC = control.k / control.n;
    const { counterfactual, attributable } = settleCounterfactual(verified, rC * attempts);
    const wC = wilson(control.k, control.n);
    const cfHi = Math.min(verified, Math.round(wC.hi * attempts));
    const cfLo = Math.min(verified, Math.round(wC.lo * attempts));
    const robustness = {};
    const be = breakEven(verified, counterfactual);
    if (be) robustness.breakEven = be;
    return {
      grade: "B",
      designKind: "naturalExperiment",
      counterfactualCount: counterfactual,
      attributable,
      incrementality: { num: attributable, den: verified },
      interval: {
        lo: clamp(1 - cfHi / verified, 0, 1),
        hi: clamp(1 - cfLo / verified, 0, 1),
        level: 0.95,
        method: "wilson-newcombe"
      },
      robustness,
      cells: { control: { n: control.n, k: control.k }, treated: { n: attempts, k: verified } },
      assumptions: [
        "The uncovered routing slice's outcome rate is the counterfactual rate for covered attempts.",
        "Routing assignment recorded; not reserved in advance (hence Grade B, not A)."
      ],
      notes: [
        `Uncovered slice produced ${control.k}/${control.n}; projected onto ${attempts} covered attempts \u2192 ${counterfactual} of ${verified} verified would have happened anyway.`
      ]
    };
  }

  // src/causal/baseline.ts
  function medianLowerMiddle2(values) {
    if (values.length === 0) throw new EngineError("estimate", "median of empty baseline");
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
  function estimatePreAgentBaseline(report, design) {
    const verified = report.verified.length;
    const assumptions = [];
    let matched = design.months.filter(
      (m) => Math.abs(m.volume - verified) / verified <= design.match.volumeTolerancePct / 100
    );
    if (matched.length < design.match.minMonths) {
      const matchedCount = matched.length;
      matched = design.months;
      assumptions.push(
        `Only ${matchedCount} baseline months matched volume \xB1${design.match.volumeTolerancePct}%; all ${design.months.length} months used instead.`
      );
    }
    const baselineCostPerOutcomeCents = medianLowerMiddle2(matched.map((m) => m.costPerOutcomeCents));
    const seasonal = design.months.find((m) => m.month === design.seasonality.comparisonMonth);
    if (seasonal) {
      const divergencePct = Math.abs(verified - seasonal.volume) / seasonal.volume * 100;
      if (divergencePct > design.seasonality.maxDivergencePct) {
        assumptions.push(
          `Seasonality guard: volume diverges ${divergencePct.toFixed(1)}% from ${seasonal.month} (limit ${design.seasonality.maxDivergencePct}%).`
        );
      }
    } else {
      assumptions.push(`Seasonality guard skipped: no baseline month ${design.seasonality.comparisonMonth}.`);
    }
    let cfRaw;
    if (design.basis === "displacement") {
      cfRaw = 0;
      assumptions.push(
        "Displacement basis: outcomes would occur under the pre-agent process at baseline cost; attribution counts work performed, value is cost displacement."
      );
    } else {
      cfRaw = R1_count(medianLowerMiddle2(matched.map((m) => m.volume)));
      assumptions.push("Occurrence basis: matched-median baseline volume would have occurred without the agent.");
    }
    const { counterfactual, attributable } = settleCounterfactual(verified, cfRaw);
    const robustness = {};
    const be = breakEven(verified, counterfactual);
    if (be) robustness.breakEven = be;
    if (matched.length >= 2) {
      if (design.basis === "occurrence") {
        let attrLo = Infinity;
        let attrHi = -Infinity;
        for (let drop = 0; drop < matched.length; drop++) {
          const rest = matched.filter((_, i) => i !== drop);
          const looCf = R1_count(medianLowerMiddle2(rest.map((m) => m.volume)));
          const looAttr = settleCounterfactual(verified, looCf).attributable;
          attrLo = Math.min(attrLo, looAttr);
          attrHi = Math.max(attrHi, looAttr);
        }
        robustness.leaveOneOut = {
          lo: attrLo,
          hi: attrHi,
          metric: "attributable",
          note: `Dropping any single matched month moves attributable within [${attrLo}, ${attrHi}] \u2014 the estimate does not hinge on one month.`
        };
      } else {
        let costLo = Infinity;
        let costHi = -Infinity;
        for (let drop = 0; drop < matched.length; drop++) {
          const rest = matched.filter((_, i) => i !== drop);
          const looCost = medianLowerMiddle2(rest.map((m) => m.costPerOutcomeCents));
          costLo = Math.min(costLo, looCost);
          costHi = Math.max(costHi, looCost);
        }
        robustness.leaveOneOut = {
          lo: costLo,
          hi: costHi,
          metric: "baselineCostPerOutcomeCents",
          note: `Dropping any single matched month moves the baseline cost/outcome within [${costLo}, ${costHi}] cents.`
        };
      }
    }
    return {
      grade: "C",
      designKind: "preAgentBaseline",
      counterfactualCount: counterfactual,
      attributable,
      incrementality: { num: attributable, den: verified },
      robustness,
      cells: { matchedMonths: { n: design.months.length, k: matched.length } },
      assumptions,
      notes: [
        `Matched ${matched.length}/${design.months.length} baseline months (volume \xB1${design.match.volumeTolerancePct}% of ${verified}); median cost/outcome $${(baselineCostPerOutcomeCents / 100).toFixed(2)} under the old process.`
      ],
      baselineCostPerOutcomeCents
    };
  }

  // src/predicates.ts
  function evalPredicate(p, metrics) {
    switch (p.op) {
      case "and":
        return p.of.every((q) => evalPredicate(q, metrics));
      case "or":
        return p.of.some((q) => evalPredicate(q, metrics));
      case "not":
        return !evalPredicate(p.of, metrics);
      case "exists":
        return metrics[p.metric] !== void 0;
      case "cmp": {
        const v = metrics[p.metric];
        if (v === void 0) return false;
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

  // src/causal/rules.ts
  function outcomeMetrics(graph, v) {
    const touches = qualifyingTouches(graph, v.entityKey, Date.parse(v.occurredAt));
    const claimTouch = touches.find((t) => t.runId === v.claimRunId);
    const priorHuman = touches.some(
      (t) => t.actorClass === "human" && (claimTouch ? t.startedAtMs < claimTouch.startedAtMs : true)
    );
    return {
      slice: v.slice,
      agentTouchCount: touches.filter((t) => t.actorClass === "agent").length,
      humanTouchCount: touches.filter((t) => t.actorClass === "human").length,
      hasPriorHumanTouch: priorHuman
    };
  }
  function estimateRules(graph, report, design, gradeCeilingNote) {
    const verified = report.verified.length;
    let matchedCount = 0;
    for (const v of report.verified) {
      if (evalPredicate(design.wouldHaveHappenedAnyway, outcomeMetrics(graph, v))) matchedCount += 1;
    }
    const { counterfactual, attributable } = settleCounterfactual(verified, matchedCount);
    const notes = [
      `Rule-based counterfactual: ${counterfactual} of ${verified} verified outcomes match the would-have-happened-anyway predicate.`
    ];
    if (gradeCeilingNote) notes.push(gradeCeilingNote);
    const be = breakEven(verified, counterfactual);
    return {
      grade: "D",
      designKind: "rules",
      counterfactualCount: counterfactual,
      attributable,
      incrementality: { num: attributable, den: verified },
      robustness: be ? { breakEven: be } : void 0,
      cells: { verified: { n: verified, k: counterfactual } },
      assumptions: [
        "Counterfactual is deterministic rule logic, not an experiment \u2014 the evidence-grade floor."
      ],
      notes
    };
  }

  // src/causal/estimator.ts
  function estimateDesign(graph, report, design) {
    switch (design.kind) {
      case "holdout":
        return estimateHoldout(graph, report, design);
      case "naturalExperiment":
        return design.form === "didStagedRollout" ? estimateDidStagedRollout(graph, report, design) : estimateTwoGroupRoutingGap(graph, report, design);
      case "preAgentBaseline":
        return estimatePreAgentBaseline(report, design);
      case "rules":
        return estimateRules(graph, report, design);
      default: {
        const never = design;
        throw new EngineError("estimate", `unknown counterfactual design ${JSON.stringify(never)}`);
      }
    }
  }
  function estimate(graph, report) {
    const contract = graph.contract;
    const ladder = contract.corroboration ?? [];
    let primary;
    const notes = [];
    let usedFromLadder = -1;
    try {
      primary = estimateDesign(graph, report, contract.counterfactual);
    } catch (err) {
      if (!(err instanceof MissingDesignDataError)) throw err;
      for (let i = 0; i < ladder.length && !primary; i++) {
        try {
          primary = estimateDesign(graph, report, ladder[i]);
          usedFromLadder = i;
          notes.push(
            `Primary design (${contract.counterfactual.kind}) has no recorded data; fell back to corroborating ${ladder[i].kind} \u2014 evidence ceiling ${primary.grade}.`
          );
        } catch (ladderErr) {
          if (!(ladderErr instanceof MissingDesignDataError)) throw ladderErr;
        }
      }
      if (!primary) {
        primary = estimateRules(
          graph,
          report,
          { wouldHaveHappenedAnyway: { op: "or", of: [] } },
          `Evidence-grade ceiling: no configured design's data is present (${err.message}); downgraded to Grade D rules.`
        );
      }
    }
    const corroboration = [];
    for (let i = 0; i < ladder.length; i++) {
      if (i === usedFromLadder) continue;
      try {
        const { corroboration: _drop, ...result } = estimateDesign(graph, report, ladder[i]);
        corroboration.push(result);
      } catch (err) {
        if (!(err instanceof MissingDesignDataError)) throw err;
        notes.push(`Corroborating ${ladder[i].kind} skipped: its design data is missing.`);
      }
    }
    return {
      ...primary,
      notes: [...primary.notes, ...notes],
      corroboration: corroboration.length > 0 ? corroboration : void 0
    };
  }

  // src/economics.ts
  function computeEconomics(contract, report, workflowRuns) {
    const verified = report.verified.length;
    if (verified === 0) throw new EngineError("economics", `${contract.workflowId}: no verified outcomes`);
    let spendCents;
    switch (contract.billing.kind) {
      case "perOutcome":
        spendCents = report.claimed * contract.billing.rateCents;
        break;
      case "flatMonthly":
        spendCents = contract.billing.feeCents;
        break;
      case "usage":
        spendCents = workflowRuns.reduce((acc, r) => acc + r.costCents, 0);
        break;
    }
    const runsById = new Map(workflowRuns.map((r) => [r.id, r]));
    const byModel = /* @__PURE__ */ new Map();
    for (const v of report.verified) {
      if (!v.model) continue;
      const run = runsById.get(v.claimRunId);
      if (!run) throw new EngineError("economics", `verified claim run ${v.claimRunId} missing from workflow runs`);
      const entry = byModel.get(v.model) ?? { verified: 0, claimCostCents: 0 };
      entry.verified += 1;
      entry.claimCostCents += run.costCents;
      byModel.set(v.model, entry);
    }
    let modelSplit;
    if (byModel.size > 1) {
      modelSplit = [...byModel.entries()].map(([model, e]) => ({
        model,
        verified: e.verified,
        share: R4_share2(e.verified, verified),
        marginalCostPerVerifiedCents: R2_unitCents(e.claimCostCents, e.verified)
      })).sort((a, b) => b.verified - a.verified || (a.model < b.model ? -1 : 1));
    }
    let modelSwitch;
    if (contract.modelSwitchCompanion) {
      const { incumbentModel, altModel } = contract.modelSwitchCompanion;
      const claimsByModel = /* @__PURE__ */ new Map();
      for (const run of workflowRuns) {
        if (run.claim?.workflowId !== contract.workflowId || !run.model) continue;
        claimsByModel.set(run.model, (claimsByModel.get(run.model) ?? 0) + 1);
      }
      const cell = (model) => {
        const claims = claimsByModel.get(model);
        const e = byModel.get(model);
        if (!claims || !e) throw new EngineError("economics", `model-switch companion: no data for model ${model}`);
        return { claims, verified: e.verified, marginal: R2_unitCents(e.claimCostCents, e.verified) };
      };
      const inc = cell(incumbentModel);
      const alt = cell(altModel);
      const incumbentAcceptPct = R4_pct(inc.verified, inc.claims);
      const altAcceptPct = R4_pct(alt.verified, alt.claims);
      modelSwitch = {
        incumbentModel,
        altModel,
        incumbentAcceptPct,
        altAcceptPct,
        // Parity on raw percentage points, |Δ| ≤ 1pt.
        parity: Math.abs(100 * inc.verified / inc.claims - 100 * alt.verified / alt.claims) <= 1,
        savingsPerVerifiedCents: inc.marginal - alt.marginal
      };
    }
    return {
      spendCents,
      costPerVerifiedCents: R2_unitCents(spendCents, verified),
      modelSplit,
      modelSwitch
    };
  }
  function computeDispute(contract, report, estimator) {
    if (contract.billing.kind !== "perOutcome") return void 0;
    const rate = contract.billing.rateCents;
    const verified = report.verified.length;
    const qualityFailures = Object.values(report.qualityFailures).reduce((a, b) => a + b, 0);
    const fairPriceCents = roundHalfUp(rate * estimator.attributable / verified);
    return {
      claimed: report.claimed,
      qualityFailures,
      qualityFailuresByReason: { ...report.qualityFailures },
      adjustmentCents: qualityFailures * rate,
      billedPerOutcomeCents: rate,
      fairPriceCents,
      incrementalityPct: R4_pct(estimator.attributable, verified),
      deltaPerOutcomeCents: rate - fairPriceCents
    };
  }

  // src/verdict/engine.ts
  function verdictMetrics(ctx) {
    const { contract, report, estimator, economics, dispute } = ctx;
    const verified = report.verified.length;
    const minSlicePointDelta = estimator.perSlice ? Math.min(...estimator.perSlice.map((s) => s.pointDelta)) : verified - estimator.counterfactualCount;
    const metrics = {
      billingKind: contract.billing.kind,
      qualityPassPct: report.qualityPassPct,
      costPerVerifiedCents: economics.costPerVerifiedCents,
      incrementalityPct: Math.round(100 * estimator.attributable / verified),
      minSlicePointDelta,
      expandConfigured: contract.expand !== void 0
    };
    if (dispute) {
      metrics.rateCents = dispute.billedPerOutcomeCents;
      metrics.fairPriceCents = dispute.fairPriceCents;
      metrics.priceDeltaCents = dispute.deltaPerOutcomeCents;
    }
    if (economics.modelSwitch) {
      metrics.modelSwitchParity = economics.modelSwitch.parity;
      metrics.modelSwitchSavingsCents = economics.modelSwitch.savingsPerVerifiedCents;
    }
    if (estimator.baselineCostPerOutcomeCents !== void 0) {
      metrics.baselineCostPerOutcomeCents = estimator.baselineCostPerOutcomeCents;
      metrics.costVsBaselinePct = Math.round(
        100 * economics.costPerVerifiedCents / estimator.baselineCostPerOutcomeCents
      );
    }
    return metrics;
  }
  function computeImpact(formula, ctx) {
    const { contract, report, estimator, economics, dispute } = ctx;
    switch (formula.kind) {
      case "flatFeeRecovery": {
        if (contract.billing.kind !== "flatMonthly") {
          throw new EngineError("verdict", "flatFeeRecovery requires flatMonthly billing");
        }
        return R3_dollars(contract.billing.feeCents / 100);
      }
      case "renegotiationDelta": {
        if (!dispute) throw new EngineError("verdict", "renegotiationDelta requires a dispute block");
        return R3_dollars(dispute.deltaPerOutcomeCents * report.verified.length / 100);
      }
      case "rerouteDelta": {
        if (!economics.modelSwitch) throw new EngineError("verdict", "rerouteDelta requires a model-switch companion");
        return R3_dollars(economics.modelSwitch.savingsPerVerifiedCents * estimator.attributable / 100);
      }
      case "expandProjection": {
        if (!contract.expand) throw new EngineError("verdict", "expandProjection requires expand params");
        return R3_dollars(
          contract.expand.adjacentVolume * (contract.expand.adjacentBaselineCostCents - economics.costPerVerifiedCents) / 100
        );
      }
      case "repriceDelta": {
        if (!dispute) throw new EngineError("verdict", "repriceDelta requires a dispute block");
        return R3_dollars(
          (dispute.billedPerOutcomeCents - formula.targetRateCents) * report.verified.length / 100
        );
      }
      case "spendAtStake":
        return R3_dollars(economics.spendCents / 100);
    }
  }
  function decideVerdict(rules, ctx, replay) {
    const metrics = verdictMetrics(ctx);
    const ordered = [...rules].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
    for (const rule of ordered) {
      if (!evalPredicate(rule.when, metrics)) continue;
      return {
        verdict: rule.verdict,
        ruleId: rule.id,
        impactPerMonthDollars: computeImpact(rule.impact, ctx),
        inputs: Object.fromEntries(
          Object.entries(metrics).filter(([, v]) => v !== void 0)
        ),
        replay
      };
    }
    throw new EngineError(
      "verdict",
      `no verdict rule matched workflow ${ctx.contract.workflowId} \u2014 the rule set must be total`
    );
  }

  // src/hash.ts
  function fnv1a32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function canonicalJson(value) {
    return JSON.stringify(sortValue(value));
  }
  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        const v = value[key];
        if (v !== void 0) out[key] = sortValue(v);
      }
      return out;
    }
    return value;
  }
  function hashValue(value) {
    const s = canonicalJson(value);
    const a = fnv1a32(s).toString(16).padStart(8, "0");
    const b = fnv1a32(`causa:${s}`).toString(16).padStart(8, "0");
    return a + b;
  }

  // src/version.ts
  var ENGINE_VERSION = "0.2.0";

  // src/statement.ts
  function runStatement(inputs, config) {
    const replay = {
      inputHash: hashValue({ actors: inputs.actors, runs: inputs.runs, outcomes: inputs.outcomes }),
      configHash: hashValue(config),
      engineVersion: ENGINE_VERSION
    };
    const ruleSetById = new Map(config.extractRuleSets.map((rs) => [rs.id, rs]));
    const outcomeIndex = buildOutcomeIndex(inputs.outcomes);
    const workflows = [];
    const identified = [];
    for (const contract of config.contracts) {
      const ruleSet = ruleSetById.get(contract.join.extractorRuleSetId);
      if (!ruleSet) throw new EngineError("extract", `unknown extractor rule set ${contract.join.extractorRuleSetId}`);
      const graph = buildGraph(contract, inputs.runs, outcomeIndex, ruleSet, inputs.actors);
      const report = verifyClaims(graph);
      const estimatorResult = estimate(graph, report);
      const economics = computeEconomics(contract, report, graph.workflowRuns);
      const dispute = computeDispute(contract, report, estimatorResult);
      const verdict = decideVerdict(config.verdictRules, { contract, report, estimator: estimatorResult, economics, dispute }, replay);
      identified.push({ graph, report, dispute });
      const verified = report.verified.length;
      if (!(report.claimed >= verified && verified >= estimatorResult.attributable)) {
        throw new EngineError(
          "statement",
          `${contract.workflowId}: claimed \u2265 verified \u2265 attributable violated (${report.claimed}/${verified}/${estimatorResult.attributable})`
        );
      }
      workflows.push({
        workflowId: contract.workflowId,
        claimed: report.claimed,
        verified,
        attributable: estimatorResult.attributable,
        drop: report.drop,
        qualityFailures: report.qualityFailures,
        qualityPassPct: report.qualityPassPct,
        spendCents: economics.spendCents,
        costPerVerifiedCents: economics.costPerVerifiedCents,
        modelSplit: economics.modelSplit,
        actorSplit: actorSplit(graph, report.verified),
        actorShapley: contract.credit?.rule === "shapley-coalition-v1" ? computeShapleyCredit(graph, verified, contract.credit.maxActors) : void 0,
        estimator: estimatorResult,
        verdict,
        coverage: computeCoverage(graph, report.claimed - report.drop.unjoinable, report.claimed),
        dispute,
        integrity: runIntegrity(graph, report)
      });
    }
    const candidates = interpretCandidates(identified, config.boundaryWindowDays);
    const activityRunsBySource = {};
    for (const run of inputs.runs) {
      const label = config.activitySourceLabels[run.source];
      if (!label) throw new EngineError("statement", `activity run ${run.id} has unlabeled source ${run.source}`);
      activityRunsBySource[label] = (activityRunsBySource[label] ?? 0) + 1;
    }
    const sum = (pick2) => workflows.reduce((acc, w) => acc + pick2(w), 0);
    return {
      engineVersion: ENGINE_VERSION,
      replay,
      headers: {
        claimed: sum((w) => w.claimed),
        verified: sum((w) => w.verified),
        attributable: sum((w) => w.attributable),
        spendCents: sum((w) => w.spendCents),
        adjustmentCents: sum((w) => w.dispute?.adjustmentCents ?? 0),
        projectedVerdictImpactDollars: sum((w) => w.verdict.impactPerMonthDollars)
      },
      workflows,
      candidates,
      activityRunsBySource,
      totalRuns: inputs.runs.length
    };
  }

  // src/report.ts
  var int = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  var usd2 = (cents) => {
    const dollars = Math.floor(cents / 100);
    const rem = Math.abs(cents % 100);
    return `$${int(dollars)}.${String(rem).padStart(2, "0")}`;
  };
  var usd0 = (dollars) => `$${int(dollars)}`;
  function estimatorLines(e, indent = "") {
    const lines = [];
    lines.push(`${indent}- Design: ${e.designKind} \xB7 Grade ${e.grade}`);
    lines.push(
      `${indent}- Counterfactual: ${int(e.counterfactualCount)} of ${int(e.incrementality.den)} verified would have happened anyway \u2192 ${int(e.attributable)} attributable (${(100 * e.incrementality.num / e.incrementality.den).toFixed(1)}% incremental)`
    );
    if (e.interval) {
      lines.push(
        `${indent}- 95% interval on incrementality: ${(100 * e.interval.lo).toFixed(1)}%\u2013${(100 * e.interval.hi).toFixed(1)}% (${e.interval.method})`
      );
    }
    if (e.robustness) {
      const r = e.robustness;
      if (r.breakEven) {
        lines.push(
          `${indent}- Robustness \xB7 break-even: ${r.breakEven.factor === null ? r.breakEven.note : `\xD7${r.breakEven.factor} \u2014 ${r.breakEven.note}`}`
        );
      }
      if (r.placebo) {
        lines.push(
          `${indent}- Robustness \xB7 placebo: worst |\u0394| ${r.placebo.deltaPts}pts (limit \xB1${r.placebo.maxAbsDeltaPts}pts) \u2014 ${r.placebo.pass ? "pass" : "FAIL"}`
        );
        for (const n of r.placebo.notes) lines.push(`${indent}  - ${n}`);
      }
      if (r.leaveOneOut) {
        lines.push(
          `${indent}- Robustness \xB7 leave-one-out ${r.leaveOneOut.metric}: [${int(r.leaveOneOut.lo)}, ${int(r.leaveOneOut.hi)}] \u2014 ${r.leaveOneOut.note}`
        );
      }
      if (r.postStratified) {
        const ps = r.postStratified;
        lines.push(
          `${indent}- Robustness \xB7 post-stratified: counterfactual ${int(ps.counterfactual)} \u2192 ${int(ps.attributable)} attributable \xB7 max stratum mix divergence ${ps.maxShareDivergencePts}pts \u2014 ${ps.note}`
        );
        for (const s of ps.strata) {
          lines.push(
            `${indent}  - stratum ${s.stratum}: treated ${int(s.treated.k)}/${int(s.treated.n)} \xB7 control ${int(s.control.k)}/${int(s.control.n)}`
          );
        }
      }
    }
    for (const [name, cell] of Object.entries(e.cells)) {
      lines.push(`${indent}- Cell ${name}: ${int(cell.k)} / ${int(cell.n)}`);
    }
    if (e.perSlice) {
      for (const s of e.perSlice) {
        lines.push(
          `${indent}- Slice ${s.slice}: ${int(s.verified)} verified, ${int(s.counterfactual)} expected anyway \u2192 ${int(s.attributable)} attributable (point delta ${s.pointDelta >= 0 ? "+" : ""}${s.pointDelta.toFixed(1)})`
        );
      }
    }
    for (const a of e.assumptions) lines.push(`${indent}- Assumption: ${a}`);
    for (const n of e.notes) lines.push(`${indent}- Note: ${n}`);
    return lines;
  }
  function workflowSection(w) {
    const lines = [];
    lines.push(`## ${w.workflowId}`);
    lines.push("");
    lines.push(
      `**Funnel:** ${int(w.claimed)} claimed \u2192 ${int(w.verified)} verified \u2192 ${int(w.attributable)} attributable`
    );
    lines.push(
      `**Drops:** ${int(w.drop.didNotHappen)} didn't happen \xB7 ${int(w.drop.failedQualityBar)} failed the quality bar \xB7 ${int(w.drop.unjoinable)} unjoinable \xB7 ${int(w.drop.duplicateClaim)} duplicate claims`
    );
    for (const [reason, count] of Object.entries(w.qualityFailures).sort(([a], [b]) => a < b ? -1 : 1)) {
      lines.push(`  - quality failure ${reason}: ${int(count)}`);
    }
    lines.push(
      `**Economics:** ${usd2(w.spendCents)} spend \xB7 ${usd2(w.costPerVerifiedCents)}/verified \xB7 quality pass ${w.qualityPassPct}%`
    );
    if (w.modelSplit) {
      for (const m of w.modelSplit) {
        lines.push(
          `  - ${m.model}: ${int(m.verified)} verified (share ${m.share.toFixed(2)}) \xB7 marginal ${usd2(m.marginalCostPerVerifiedCents)}/verified`
        );
      }
    }
    if (w.actorSplit) {
      lines.push(
        `  - actor split (${w.actorSplit.rule}): agent ${w.actorSplit.agent.toFixed(2)} (${int(w.actorSplit.agentTouches)} touches) / human ${w.actorSplit.human.toFixed(2)} (${int(w.actorSplit.humanTouches)} touches)`
      );
    }
    if (w.actorShapley) {
      const sh = w.actorShapley;
      lines.push(
        `  - credit (${sh.method}): agent ${sh.agentShare.toFixed(2)} / human ${sh.humanShare.toFixed(2)} \xB7 ${int(sh.coverage.entities)} entities in ${int(sh.coverage.observedCoalitions)} observed coalitions`
      );
      for (const a of sh.perActor) {
        lines.push(
          `    - ${a.actorId} (${a.actorClass}): share ${a.share.toFixed(2)} \u2192 ${int(a.verifiedEquivalent)} verified-equivalent`
        );
      }
      for (const c of sh.coalitions) {
        lines.push(`    - coalition {${c.actors.join(", ")}}: ${int(c.k)}/${int(c.n)} entities satisfy the contract`);
      }
      for (const a of sh.assumptions) lines.push(`    - Assumption: ${a}`);
    }
    lines.push("");
    lines.push(`**Evidence (${w.estimator.designKind}, Grade ${w.estimator.grade}):**`);
    lines.push(...estimatorLines(w.estimator));
    if (w.estimator.corroboration) {
      for (const c of w.estimator.corroboration) {
        lines.push(`- Corroborating baseline (${c.designKind}, Grade ${c.grade}):`);
        lines.push(...estimatorLines(c, "  "));
      }
    }
    if (w.dispute) {
      lines.push("");
      lines.push(
        `**Dispute:** billed ${usd2(w.dispute.billedPerOutcomeCents)}/outcome \xB7 fair price ${usd2(w.dispute.fairPriceCents)} at ${w.dispute.incrementalityPct}% incrementality \xB7 delta ${usd2(w.dispute.deltaPerOutcomeCents)} \xB7 ${int(w.dispute.qualityFailures)} quality failures \u2192 ${usd2(w.dispute.adjustmentCents)} adjustment`
      );
    }
    lines.push("");
    lines.push(
      `**Verdict:** ${w.verdict.verdict} (rule \`${w.verdict.ruleId}\`) \xB7 projected impact ${usd0(w.verdict.impactPerMonthDollars)}/mo`
    );
    const inputs = Object.entries(w.verdict.inputs).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join(" \xB7 ");
    lines.push(`  - inputs: ${inputs}`);
    lines.push(
      `**Coverage:** ${int(w.coverage.runsWithKey)}/${int(w.coverage.runsTotal)} runs carry a join key (${w.coverage.runKeyPct}%) \xB7 ${int(w.coverage.claimsJoined)}/${int(w.coverage.claimsTotal)} claims joined`
    );
    if (w.integrity.findings.length === 0) {
      lines.push(`**Integrity:** ${w.integrity.checksRun} adversarial checks \u2014 clean`);
    } else {
      lines.push(
        `**Integrity:** ${w.integrity.checksRun} adversarial checks \u2014 ${w.integrity.findings.length} finding${w.integrity.findings.length === 1 ? "" : "s"} (disclosed; findings gate trust, never arithmetic)`
      );
      for (const f of w.integrity.findings) {
        lines.push(`  - [${f.severity.toUpperCase()}] ${f.check}: ${f.detail}`);
        if (f.samples.length > 0) lines.push(`    - samples: ${f.samples.join(", ")}`);
      }
    }
    lines.push("");
    return lines;
  }
  function candidateSection(c) {
    const lines = [];
    const scope = c.workflowId ? ` \xB7 via ${c.workflowId}` : "";
    lines.push(`### ${c.kind}: ${c.eventType} (${c.source})${scope} \u2014 ${int(c.count)}${c.pctOfVerified !== void 0 ? ` (${c.pctOfVerified}% of verified)` : ""}`);
    for (const line of c.context) lines.push(`- ${line}`);
    if (c.draft) {
      lines.push(
        `- Draft contract: event \`${c.draft.eventType}\` in ${c.draft.source}, joined on \`${c.draft.entityKind}\`, quality bar ${c.draft.suggestedQualityBar ? JSON.stringify(c.draft.suggestedQualityBar) : "to be defined"} \u2014 awaiting confirmation`
      );
    }
    if (c.sampleEntities.length > 0) lines.push(`- Samples: ${c.sampleEntities.join(", ")}`);
    if (c.firstSeen && c.lastSeen) lines.push(`- Seen: ${c.firstSeen} \u2192 ${c.lastSeen}`);
    lines.push("");
    return lines;
  }
  function renderStatement(s) {
    const lines = [];
    lines.push(`# Settled statement`);
    lines.push("");
    lines.push(
      `**${int(s.headers.claimed)} claimed \u2192 ${int(s.headers.verified)} verified \u2192 ${int(s.headers.attributable)} attributable** \xB7 spend ${usd2(s.headers.spendCents)} \xB7 adjustment identified ${usd2(s.headers.adjustmentCents)} \xB7 projected verdict impact ${usd0(s.headers.projectedVerdictImpactDollars)}/mo`
    );
    lines.push("");
    lines.push(
      `Replay: input \`${s.replay.inputHash}\` \xB7 config \`${s.replay.configHash}\` \xB7 engine \`${s.engineVersion}\` \u2014 same inputs, same config, same engine \u21D2 byte-identical statement.`
    );
    lines.push("");
    for (const w of s.workflows) lines.push(...workflowSection(w));
    lines.push(`## Proposed outcomes (awaiting confirmation)`);
    lines.push("");
    lines.push(
      `The outcome engine interprets what the systems of record show beyond the confirmed contracts. Proposals never settle money until confirmed.`
    );
    lines.push("");
    for (const c of s.candidates) lines.push(...candidateSection(c));
    lines.push(`## Activity ingested`);
    lines.push("");
    for (const [label, count] of Object.entries(s.activityRunsBySource).sort(([a], [b]) => a < b ? -1 : 1)) {
      lines.push(`- ${label}: ${int(count)} runs`);
    }
    lines.push(`- Total: ${int(s.totalRuns)} runs`);
    lines.push("");
    return lines.join("\n");
  }

  // examples/orgsweep/generate.ts
  var T0 = Date.parse("2026-08-01T00:00:00.000Z");
  var H = 36e5;
  var D = 864e5;
  var iso = (ms) => new Date(ms).toISOString();
  function orgsweepFiles() {
    const traces = [];
    for (let i = 1; i <= 900; i++) {
      const keyless = i > 780;
      const ticket = keyless ? "" : `TCK-${(i - 1) % 700 + 1}`;
      traces.push(
        JSON.stringify({
          run_id: `sb-${i}`,
          agent: "support-bot",
          model: "gpt-5",
          ts: iso(T0 + i % 26 * D + 9 * H),
          cost_usd: "0.04",
          ticket_id: ticket
        })
      );
    }
    for (let i = 1; i <= 300; i++) {
      traces.push(
        JSON.stringify({
          run_id: `kb-${i}`,
          agent: "kb-bot",
          model: "claude-fable-5",
          ts: iso(T0 + i % 26 * D + 10 * H),
          cost_usd: "0.02",
          doc_id: `DOC-${(i - 1) % 240 + 1}`
        })
      );
    }
    const sdr = ["agent_name,time,amount,prospect_ref"];
    for (let i = 1; i <= 500; i++) {
      const keyless = i > 440;
      sdr.push(`sdr-bot,${iso(T0 + i % 26 * D + 8 * H)},0.10,${keyless ? "" : `PR-${i}`}`);
    }
    const helpdesk = ["ticket_id,status,updated_at"];
    for (let i = 1; i <= 640; i++) helpdesk.push(`TCK-${i},resolved,${iso(T0 + i % 26 * D + 12 * H)}`);
    for (let i = 1; i <= 30; i++) helpdesk.push(`TCK-${i},reopened,${iso(T0 + i % 26 * D + 20 * H)}`);
    const crm = ["prospect_ref,event,created_at"];
    for (let i = 1; i <= 260; i++) crm.push(`PR-${i},meeting_booked,${iso(T0 + i % 26 * D + 11 * H)}`);
    for (let i = 1; i <= 80; i++) crm.push(`PR-${i},opportunity_created,${iso(T0 + i % 26 * D + 15 * H)}`);
    const docs = ["doc_id,event,date"];
    for (let i = 1; i <= 240; i++) docs.push(`DOC-${i},published,${iso(T0 + i % 26 * D + 13 * H)}`);
    return {
      "agent_traces.ndjson": traces.join("\n") + "\n",
      "sdr_outreach_log.csv": sdr.join("\n") + "\n",
      "helpdesk.csv": helpdesk.join("\n") + "\n",
      "crm_events.csv": crm.join("\n") + "\n",
      "docs.csv": docs.join("\n") + "\n"
    };
  }

  // examples/northwind/files.ts
  var T02 = Date.parse("2026-07-01T00:00:00.000Z");
  var H2 = 36e5;
  var D2 = 864e5;
  var iso2 = (ms) => new Date(ms).toISOString();
  function northwindFiles() {
    const runs = ["run_id,actor,started_at,cost_usd,invoice_id,claim_wf"];
    const outcomes = ["source,entity_kind,entity_id,event_type,occurred_at,experiment_id,arm"];
    const out = (src, id, type, at, exp = "", arm = "") => outcomes.push(`${src},invoice,${id},${type},${iso2(at)},${exp},${arm}`);
    let runSeq = 0;
    const claim = (invoiceId, at) => runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso2(at)},0.04,${invoiceId},invoices`);
    for (let i = 1; i <= 450; i++) {
      const id = `INV-${1e3 + i}`;
      const created = T02 + i % 25 * D2 + 8 * H2;
      out("stripe", id, "invoice_created", created, "northwind-holdout", "treated");
      if (i > 400) continue;
      const runAt = created + 2 * H2;
      if (i <= 392) claim(id, runAt);
      else runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso2(runAt)},0.04,,invoices`);
      if (i <= 380) out("stripe", id, "invoice_posted", runAt + 3 * H2);
      if (i <= 9) out("stripe", id, "correction_logged", runAt + 3 * H2 + (6 + i % 6) * D2);
      else if (i > 360 && i <= 380) out("stripe", id, "correction_logged", runAt + 3 * H2 + (1 + i % 4) * D2);
      if (i > 20 && i <= 26) out("stripe", id, "refund_issued", runAt + 3 * H2 + 2 * D2);
    }
    claim("INV-1001", T02 + 4 * D2);
    for (let i = 1; i <= 250; i++) {
      const id = `INV-${1e3 + i * 7 % 450 + 1}`;
      runs.push(`r-${String(++runSeq).padStart(4, "0")},ap-agent,${iso2(T02 + i % 27 * D2 + 14 * H2)},0.01,${id},`);
    }
    runs.push("r-9999,ap-agent,last tuesday,0.04,INV-1400,invoices");
    runs.push("r-9998,ap-agent,2026-07-30 25:99:00,0.04,INV-1401,invoices");
    runs.push("r-0001,ap-agent,2026-07-30T10:00:00Z,0.04,INV-1402,invoices");
    for (let i = 1; i <= 50; i++) {
      const id = `INV-${2e3 + i}`;
      const created = T02 + i % 25 * D2 + 9 * H2;
      out("stripe", id, "invoice_created", created, "northwind-holdout", "control");
      if (i <= 18) {
        const posted = created + 26 * H2;
        out("stripe", id, "invoice_posted", posted);
        if (i <= 3) out("stripe", id, "correction_logged", posted + 2 * D2);
      }
    }
    outcomes.push("this row is ragged");
    return {
      "data/runs.csv": runs.join("\n") + "\n",
      "data/outcomes.csv": outcomes.join("\n") + "\n"
    };
  }
  return __toCommonJS(browser_exports);
})();

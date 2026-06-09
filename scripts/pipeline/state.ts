/**
 * Pipeline state — núcleo da máquina fail-first W0→W3 do people-context.
 *
 * Port do `scripts/pipeline/{state-schema,state-io,state-cli}.ts` do core-api,
 * consolidado e adaptado ao Bun (Bun.file/Bun.write) + funcional (no-class).
 *
 * STATE.json é canônico; STATE.md é gerado por `renderStateMarkdown`.
 * Tickets vivem em `.pipeline/<TICKET>/STATE.json`.
 */

import { mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── Result local (scripts não importam o Result de src/) ─────────────────

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T, E = never>(value: T): Result<T, E> => ({ ok: true, value });
export const err = <E, T = never>(error: E): Result<T, E> => ({ ok: false, error });

// ─── Schema ───────────────────────────────────────────────────────────────

export const PIPELINE_STATE_SCHEMA_VERSION = 1 as const;

export const WAVE_IDS = ["W0", "W1", "W2", "W3"] as const;
export type WaveId = (typeof WAVE_IDS)[number];

export const WAVE_LABELS: Readonly<Record<WaveId, string>> = {
  W0: "RED (testes fail-first)",
  W1: "GREEN (implementação mínima)",
  W2: "REVIEW (audit read-only)",
  W3: "QUALITY (gate W3)",
};

export type WaveOutcome = "RED" | "GREEN" | "APPROVED" | "REJECTED" | "ALL-GREEN";
export type WaveStatus = "pending" | "in-progress" | "done" | "failed";

export type WaveEntry = Readonly<{
  id: WaveId;
  status: WaveStatus;
  agent: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rounds: number;
  reportPath: string | null;
  outcome: WaveOutcome | null;
}>;

export type TicketStatus =
  | "open"
  | "in-progress"
  | "closed-green"
  | "closed-rejected"
  | "superseded"
  | "blocked";

export const TICKET_SIZES = ["XS", "S", "M", "L", "XL"] as const;
export type TicketSize = (typeof TICKET_SIZES)[number];

export type PipelineState = Readonly<{
  schemaVersion: typeof PIPELINE_STATE_SCHEMA_VERSION;
  ticket: string;
  size: TicketSize;
  createdAt: string;
  closedAt: string | null;
  currentWave: WaveId | null;
  status: TicketStatus;
  waves: readonly WaveEntry[];
  blockers: readonly string[];
  lastEvent: string;
  supersededBy?: string;
}>;

export type ParseError =
  | Readonly<{ tag: "InvalidJson"; reason: string }>
  | Readonly<{ tag: "SchemaVersionMismatch"; expected: number; actual: unknown }>
  | Readonly<{ tag: "MissingField"; field: string }>;

const REQUIRED_FIELDS: readonly string[] = [
  "ticket",
  "size",
  "createdAt",
  "closedAt",
  "currentWave",
  "status",
  "waves",
  "blockers",
  "lastEvent",
];

const isObject = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

export const parsePipelineState = (raw: string): Result<PipelineState, ParseError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({ tag: "InvalidJson", reason: (e as Error).message });
  }
  if (!isObject(parsed)) {
    return err({ tag: "InvalidJson", reason: "root is not a JSON object" });
  }
  if (!("schemaVersion" in parsed)) {
    return err({ tag: "MissingField", field: "schemaVersion" });
  }
  if (parsed["schemaVersion"] !== PIPELINE_STATE_SCHEMA_VERSION) {
    return err({
      tag: "SchemaVersionMismatch",
      expected: PIPELINE_STATE_SCHEMA_VERSION,
      actual: parsed["schemaVersion"],
    });
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      return err({ tag: "MissingField", field });
    }
  }
  return ok(parsed as unknown as PipelineState);
};

// ─── Construção e transições (puras) ──────────────────────────────────────

const emptyWave = (id: WaveId): WaveEntry => ({
  id,
  status: "pending",
  agent: null,
  startedAt: null,
  finishedAt: null,
  rounds: 0,
  reportPath: null,
  outcome: null,
});

export const initState = (ticket: string, size: TicketSize, now: string): PipelineState => ({
  schemaVersion: PIPELINE_STATE_SCHEMA_VERSION,
  ticket,
  size,
  createdAt: now,
  closedAt: null,
  currentWave: "W0",
  status: "open",
  waves: WAVE_IDS.map(emptyWave),
  blockers: [],
  lastEvent: "init",
});

const mapWave = (
  state: PipelineState,
  id: WaveId,
  f: (w: WaveEntry) => WaveEntry,
): PipelineState => ({
  ...state,
  waves: state.waves.map((w) => (w.id === id ? f(w) : w)),
});

export const waveStart = (
  state: PipelineState,
  id: WaveId,
  agent: string | null,
  now: string,
): PipelineState => ({
  ...mapWave(state, id, (w) => ({
    ...w,
    status: "in-progress",
    agent: agent ?? w.agent,
    startedAt: w.startedAt ?? now,
  })),
  currentWave: id,
  status: "in-progress",
  lastEvent: `${id}:start`,
});

export type WaveFinish = Readonly<{
  outcome: WaveOutcome | null;
  reportPath: string | null;
  now: string;
}>;

export const waveFinish = (state: PipelineState, id: WaveId, finish: WaveFinish): PipelineState =>
  mapWave({ ...state, lastEvent: `${id}:finish` }, id, (w) => ({
    ...w,
    status: "done",
    finishedAt: finish.now,
    outcome: finish.outcome ?? w.outcome,
    reportPath: finish.reportPath ?? w.reportPath,
  }));

export const waveRound = (state: PipelineState, id: WaveId): PipelineState =>
  mapWave({ ...state, lastEvent: `${id}:round` }, id, (w) => ({ ...w, rounds: w.rounds + 1 }));

export const waveReopen = (state: PipelineState, id: WaveId): PipelineState => ({
  ...mapWave(state, id, (w) => ({ ...w, status: "in-progress", finishedAt: null })),
  currentWave: id,
  status: "in-progress",
  lastEvent: `${id}:reopen`,
});

export const closeTicket = (
  state: PipelineState,
  outcome: "green" | "rejected",
  now: string,
): PipelineState => ({
  ...state,
  status: outcome === "green" ? "closed-green" : "closed-rejected",
  closedAt: now,
  currentWave: null,
  lastEvent: `close:${outcome}`,
});

const CLOSED_TERMINAL: readonly TicketStatus[] = ["closed-green"];

export const supersede = (
  state: PipelineState,
  by: string,
  now: string,
): Result<PipelineState, string> => {
  if (CLOSED_TERMINAL.includes(state.status)) {
    return err(`não é possível supersedar ticket ${state.status}`);
  }
  return ok({
    ...state,
    status: "superseded",
    supersededBy: by,
    closedAt: now,
    currentWave: null,
    lastEvent: `superseded:${by}`,
  });
};

// ─── IO (Bun) ─────────────────────────────────────────────────────────────

const STATE_FILENAME = "STATE.json";
const PIPELINE_DIR = ".pipeline";

export const pipelineRoot = (cwd: string = process.cwd()): string => join(cwd, PIPELINE_DIR);
export const ticketDir = (ticket: string, cwd?: string): string => join(pipelineRoot(cwd), ticket);

export const readState = async (
  ticket: string,
  cwd?: string,
): Promise<Result<PipelineState, ParseError | { tag: "NotFound"; ticket: string }>> => {
  const path = join(ticketDir(ticket, cwd), STATE_FILENAME);
  if (!existsSync(path)) return err({ tag: "NotFound", ticket });
  const raw = await Bun.file(path).text();
  return parsePipelineState(raw);
};

export const writeState = async (state: PipelineState, cwd?: string): Promise<string> => {
  const dir = ticketDir(state.ticket, cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, STATE_FILENAME);
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`);
  // STATE.md derivado (conveniência humana).
  await Bun.write(join(dir, "STATE.md"), renderStateMarkdown(state));
  return path;
};

export const listTickets = (cwd?: string): readonly string[] => {
  const root = pipelineRoot(cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => {
      const d = join(root, name);
      return statSync(d).isDirectory() && existsSync(join(d, STATE_FILENAME));
    })
    .sort();
};

// ─── Render Markdown ──────────────────────────────────────────────────────

const STATUS_ICON: Readonly<Record<WaveStatus, string>> = {
  pending: "⬜",
  "in-progress": "🟡",
  done: "✅",
  failed: "🔴",
};

export const renderStateMarkdown = (s: PipelineState): string => {
  const rows = s.waves
    .map((w) => {
      const icon = STATUS_ICON[w.status];
      const report = w.reportPath ?? "—";
      const when = w.finishedAt ?? w.startedAt ?? "—";
      return `| ${w.id} — ${WAVE_LABELS[w.id]} | ${icon} ${w.status} | ${w.agent ?? "—"} | ${w.rounds} | ${w.outcome ?? "—"} | ${report} | ${when} |`;
    })
    .join("\n");
  const blockers = s.blockers.length > 0 ? s.blockers.map((b) => `- ${b}`).join("\n") : "_nenhum_";
  return `# Estado do Ticket ${s.ticket}

- **Tamanho**: ${s.size} · **Status**: ${s.status} · **Wave atual**: ${s.currentWave ?? "—"}
- **Criado**: ${s.createdAt}${s.closedAt !== null ? ` · **Fechado**: ${s.closedAt}` : ""}
- **Último evento**: ${s.lastEvent}${s.supersededBy !== undefined ? ` · **Supersedido por**: ${s.supersededBy}` : ""}

| Wave | Status | Agente | Rounds | Outcome | Report | Quando |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

## Blockers

${blockers}
`;
};

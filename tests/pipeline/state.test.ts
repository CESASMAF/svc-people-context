import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PIPELINE_STATE_SCHEMA_VERSION,
  WAVE_IDS,
  initState,
  waveStart,
  waveFinish,
  waveRound,
  waveReopen,
  closeTicket,
  supersede,
  parsePipelineState,
  renderStateMarkdown,
  readState,
  writeState,
  listTickets,
} from "../../scripts/pipeline/state.ts";

const NOW = "2026-06-09T12:00:00.000Z";
const tmpRoots: string[] = [];
const freshCwd = (): string => {
  const d = mkdtempSync(join(tmpdir(), "ppl-"));
  tmpRoots.push(d);
  return d;
};

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe("initState", () => {
  test("cria ticket com 4 waves pending em W0/open", () => {
    const s = initState("PEO-1", "M", NOW);
    expect(s.schemaVersion).toBe(PIPELINE_STATE_SCHEMA_VERSION);
    expect(s.status).toBe("open");
    expect(s.currentWave).toBe("W0");
    expect(s.waves.map((w) => w.id)).toEqual([...WAVE_IDS]);
    expect(s.waves.every((w) => w.status === "pending")).toBe(true);
    expect(s.createdAt).toBe(NOW);
  });
});

describe("transições de wave", () => {
  const base = initState("PEO-2", "L", NOW);

  test("waveStart marca in-progress, agente e currentWave", () => {
    const s = waveStart(base, "W0", "test-writer", NOW);
    const w0 = s.waves.find((w) => w.id === "W0");
    expect(w0?.status).toBe("in-progress");
    expect(w0?.agent).toBe("test-writer");
    expect(w0?.startedAt).toBe(NOW);
    expect(s.currentWave).toBe("W0");
    expect(s.status).toBe("in-progress");
    expect(s.lastEvent).toBe("W0:start");
  });

  test("waveFinish marca done + outcome + report", () => {
    const s = waveFinish(waveStart(base, "W0", null, NOW), "W0", {
      outcome: "RED",
      reportPath: "002/REPORT.md",
      now: NOW,
    });
    const w0 = s.waves.find((w) => w.id === "W0");
    expect(w0?.status).toBe("done");
    expect(w0?.outcome).toBe("RED");
    expect(w0?.reportPath).toBe("002/REPORT.md");
    expect(w0?.finishedAt).toBe(NOW);
  });

  test("waveStart preserva startedAt já existente", () => {
    const once = waveStart(base, "W1", null, NOW);
    const twice = waveStart(once, "W1", "x", "2026-06-09T13:00:00.000Z");
    expect(twice.waves.find((w) => w.id === "W1")?.startedAt).toBe(NOW);
  });

  test("waveRound incrementa rounds", () => {
    const s = waveRound(waveRound(base, "W2"), "W2");
    expect(s.waves.find((w) => w.id === "W2")?.rounds).toBe(2);
    expect(s.lastEvent).toBe("W2:round");
  });

  test("waveReopen volta a in-progress e limpa finishedAt", () => {
    const done = waveFinish(base, "W2", { outcome: "APPROVED", reportPath: null, now: NOW });
    const reopened = waveReopen(done, "W2");
    const w2 = reopened.waves.find((w) => w.id === "W2");
    expect(w2?.status).toBe("in-progress");
    expect(w2?.finishedAt).toBeNull();
    expect(reopened.currentWave).toBe("W2");
  });
});

describe("closeTicket / supersede", () => {
  const base = initState("PEO-3", "S", NOW);

  test("close green", () => {
    const s = closeTicket(base, "green", NOW);
    expect(s.status).toBe("closed-green");
    expect(s.closedAt).toBe(NOW);
    expect(s.currentWave).toBeNull();
  });

  test("close rejected", () => {
    expect(closeTicket(base, "rejected", NOW).status).toBe("closed-rejected");
  });

  test("supersede de ticket aberto retorna ok com supersededBy", () => {
    const r = supersede(base, "PEO-9", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("superseded");
      expect(r.value.supersededBy).toBe("PEO-9");
    }
  });

  test("supersede de ticket closed-green falha", () => {
    const closed = closeTicket(base, "green", NOW);
    const r = supersede(closed, "PEO-9", NOW);
    expect(r.ok).toBe(false);
  });
});

describe("parsePipelineState", () => {
  test("round-trip de um estado válido", () => {
    const s = initState("PEO-4", "XL", NOW);
    const r = parsePipelineState(JSON.stringify(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ticket).toBe("PEO-4");
  });

  test("JSON inválido", () => {
    const r = parsePipelineState("{ não json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("InvalidJson");
  });

  test("root não-objeto", () => {
    const r = parsePipelineState("[1,2,3]");
    expect(r.ok).toBe(false);
  });

  test("schemaVersion ausente", () => {
    const r = parsePipelineState(JSON.stringify({ ticket: "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("MissingField");
  });

  test("schemaVersion divergente", () => {
    const r = parsePipelineState(JSON.stringify({ schemaVersion: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("SchemaVersionMismatch");
  });

  test("campo obrigatório ausente", () => {
    const r = parsePipelineState(JSON.stringify({ schemaVersion: PIPELINE_STATE_SCHEMA_VERSION }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("MissingField");
  });
});

describe("renderStateMarkdown", () => {
  test("inclui ticket, tabela de waves e blockers", () => {
    const md = renderStateMarkdown(initState("PEO-5", "M", NOW));
    expect(md).toContain("# Estado do Ticket PEO-5");
    expect(md).toContain("| W0 — RED");
    expect(md).toContain("## Blockers");
    expect(md).toContain("_nenhum_");
  });

  test("renderiza supersededBy e closedAt quando presentes", () => {
    const s = supersede(initState("PEO-6", "M", NOW), "PEO-7", NOW);
    if (s.ok) {
      const md = renderStateMarkdown(s.value);
      expect(md).toContain("Supersedido por");
      expect(md).toContain("Fechado");
    }
  });
});

describe("io: write → read → list", () => {
  test("persiste e relê o estado, lista o ticket", async () => {
    const cwd = freshCwd();
    const s = initState("PEO-IO", "M", NOW);
    const path = await writeState(s, cwd);
    expect(path).toContain("PEO-IO");

    const r = await readState("PEO-IO", cwd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ticket).toBe("PEO-IO");

    expect(listTickets(cwd)).toEqual(["PEO-IO"]);
  });

  test("readState de ticket inexistente → NotFound", async () => {
    const cwd = freshCwd();
    const r = await readState("NOPE", cwd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("NotFound");
  });

  test("listTickets em .pipeline ausente → []", () => {
    expect(listTickets(freshCwd())).toEqual([]);
  });
});

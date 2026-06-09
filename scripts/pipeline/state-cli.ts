#!/usr/bin/env bun
/**
 * CLI `bun run pipeline:state` — máquina fail-first W0→W3 do people-context.
 *
 * Comandos:
 *   init <ticket> --size <XS|S|M|L|XL>
 *   wave-start  <ticket> <W0|W1|W2|W3> [--agent <nome>]
 *   wave-finish <ticket> <W0|W1|W2|W3> [--outcome <RED|GREEN|APPROVED|REJECTED|ALL-GREEN>] [--report <path>]
 *   wave-round  <ticket> <W0|W1|W2|W3>
 *   wave-reopen <ticket> <W0|W1|W2|W3>
 *   close       <ticket> [--rejected]
 *   supersede   <ticket> --by <ticket>
 *   render      <ticket>
 *   show        <ticket>
 */

import {
  TICKET_SIZES,
  WAVE_IDS,
  type TicketSize,
  type WaveId,
  type WaveOutcome,
  initState,
  waveStart,
  waveFinish,
  waveRound,
  waveReopen,
  closeTicket,
  supersede,
  readState,
  writeState,
  renderStateMarkdown,
  type PipelineState,
} from "./state.ts";

const nowIso = (): string => new Date().toISOString();

const fail = (msg: string): never => {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (argv: readonly string[], name: string): boolean => argv.includes(`--${name}`);

const isWaveId = (s: string | undefined): s is WaveId =>
  s !== undefined && (WAVE_IDS as readonly string[]).includes(s);

const requireWave = (s: string | undefined): WaveId =>
  isWaveId(s) ? s : fail(`wave id obrigatória (${WAVE_IDS.join("|")})`);

const loadOrFail = async (ticket: string): Promise<PipelineState> => {
  const r = await readState(ticket);
  if (!r.ok) return fail(`ticket "${ticket}" não encontrado/inválido (${JSON.stringify(r.error)})`);
  return r.value;
};

const persist = async (state: PipelineState, event: string): Promise<void> => {
  const path = await writeState(state);
  process.stdout.write(`✓ ${event}: ${state.ticket} → ${state.status} (${path})\n`);
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(2);

  if (sub === undefined) {
    process.stdout.write(
      "uso: pipeline:state <init|wave-start|wave-finish|wave-round|wave-reopen|close|supersede|render|show> <ticket> [args]\n",
    );
    process.exit(0);
  }
  const ticket = argv[1] ?? fail(`ticket obrigatório para "${sub}"`);

  switch (sub) {
    case "init": {
      const size = (flag(argv, "size") ?? "M") as TicketSize;
      if (!(TICKET_SIZES as readonly string[]).includes(size)) {
        fail(`--size inválido: ${size} (use ${TICKET_SIZES.join("|")})`);
      }
      const existing = await readState(ticket);
      if (existing.ok) fail(`ticket "${ticket}" já existe`);
      await persist(initState(ticket, size, nowIso()), "init");
      return;
    }
    case "wave-start": {
      const id = requireWave(rest[0]);
      const agent = flag(argv, "agent") ?? null;
      await persist(waveStart(await loadOrFail(ticket), id, agent, nowIso()), `${id} start`);
      return;
    }
    case "wave-finish": {
      const id = requireWave(rest[0]);
      const outcome = (flag(argv, "outcome") as WaveOutcome | undefined) ?? null;
      const reportPath = flag(argv, "report") ?? null;
      await persist(
        waveFinish(await loadOrFail(ticket), id, { outcome, reportPath, now: nowIso() }),
        `${id} finish`,
      );
      return;
    }
    case "wave-round": {
      const id = requireWave(rest[0]);
      await persist(waveRound(await loadOrFail(ticket), id), `${id} round`);
      return;
    }
    case "wave-reopen": {
      const id = requireWave(rest[0]);
      await persist(waveReopen(await loadOrFail(ticket), id), `${id} reopen`);
      return;
    }
    case "close": {
      const outcome = hasFlag(argv, "rejected") ? "rejected" : "green";
      await persist(closeTicket(await loadOrFail(ticket), outcome, nowIso()), `close ${outcome}`);
      return;
    }
    case "supersede": {
      const by = flag(argv, "by") ?? fail("--by <ticket> obrigatório");
      const r = supersede(await loadOrFail(ticket), by, nowIso());
      if (!r.ok) return fail(r.error);
      await persist(r.value, `supersede by ${by}`);
      return;
    }
    case "render":
    case "show": {
      process.stdout.write(renderStateMarkdown(await loadOrFail(ticket)));
      return;
    }
    default:
      fail(`subcomando desconhecido: ${sub}`);
  }
};

await main();

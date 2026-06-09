#!/usr/bin/env bun
/**
 * CLI `bun run pipeline:metrics` — métricas agregadas dos tickets em `.pipeline/`.
 */

import { listTickets, readState, type PipelineState, type TicketStatus } from "./state.ts";

export type PipelineMetrics = Readonly<{
  total: number;
  byStatus: Readonly<Record<string, number>>;
  bySize: Readonly<Record<string, number>>;
  closedGreen: number;
  greenRate: number; // closedGreen / total
  reviewRounds: number; // Σ rounds da wave W2 (retrabalho de review)
  blocked: number;
}>;

export const computeMetrics = (states: readonly PipelineState[]): PipelineMetrics => {
  const byStatus: Record<string, number> = {};
  const bySize: Record<string, number> = {};
  let reviewRounds = 0;
  for (const s of states) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    bySize[s.size] = (bySize[s.size] ?? 0) + 1;
    const w2 = s.waves.find((w) => w.id === "W2");
    reviewRounds += w2?.rounds ?? 0;
  }
  const closedGreen = byStatus["closed-green"] ?? 0;
  const total = states.length;
  return {
    total,
    byStatus,
    bySize,
    closedGreen,
    greenRate: total === 0 ? 0 : closedGreen / total,
    reviewRounds,
    blocked: (byStatus["blocked"] as number | undefined) ?? 0,
  };
};

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

const main = async (): Promise<void> => {
  const tickets = listTickets();
  const states: PipelineState[] = [];
  for (const t of tickets) {
    const r = await readState(t);
    if (r.ok) states.push(r.value);
  }
  const m = computeMetrics(states);

  process.stdout.write(`\n📈 Pipeline metrics — ${m.total} ticket(s)\n\n`);
  process.stdout.write(`  Closed GREEN : ${m.closedGreen} (${pct(m.greenRate)})\n`);
  process.stdout.write(`  Blocked      : ${m.blocked}\n`);
  process.stdout.write(`  Review rounds (Σ W2): ${m.reviewRounds}\n`);
  process.stdout.write(`\n  Por status:\n`);
  for (const [k, v] of Object.entries(m.byStatus).sort()) {
    process.stdout.write(`    ${(k as TicketStatus).padEnd(18)} ${v}\n`);
  }
  process.stdout.write(`\n  Por tamanho:\n`);
  for (const [k, v] of Object.entries(m.bySize).sort()) {
    process.stdout.write(`    ${k.padEnd(4)} ${v}\n`);
  }
  process.stdout.write("\n");
};

await main();

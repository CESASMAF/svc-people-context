#!/usr/bin/env bun
/**
 * CLI `bun run pipeline:status` — dashboard de todos os tickets em `.pipeline/`.
 */

import { listTickets, readState, WAVE_IDS, type PipelineState, type WaveStatus } from "./state.ts";

const WAVE_GLYPH: Readonly<Record<WaveStatus, string>> = {
  pending: "·",
  "in-progress": "◐",
  done: "●",
  failed: "✗",
};

const waveBar = (s: PipelineState): string =>
  WAVE_IDS.map((id) => {
    const w = s.waves.find((x) => x.id === id);
    return WAVE_GLYPH[w?.status ?? "pending"];
  }).join(" ");

const main = async (): Promise<void> => {
  const tickets = listTickets();
  if (tickets.length === 0) {
    process.stdout.write(
      "Nenhum ticket em .pipeline/. Crie com: bun run pipeline:state init <T> --size <S|M|L>\n",
    );
    return;
  }

  process.stdout.write(`\n📊 Pipeline — ${tickets.length} ticket(s) · waves [W0 W1 W2 W3]\n\n`);
  const header =
    "TICKET".padEnd(28) +
    "SIZE".padEnd(6) +
    "STATUS".padEnd(18) +
    "WAVES".padEnd(10) +
    "ÚLTIMO EVENTO";
  process.stdout.write(`${header}\n${"─".repeat(header.length)}\n`);

  for (const ticket of tickets) {
    const r = await readState(ticket);
    if (!r.ok) {
      process.stdout.write(`${ticket.padEnd(28)}—     (STATE.json inválido)\n`);
      continue;
    }
    const s = r.value;
    process.stdout.write(
      ticket.padEnd(28) +
        s.size.padEnd(6) +
        s.status.padEnd(18) +
        waveBar(s).padEnd(10) +
        s.lastEvent +
        "\n",
    );
  }
  process.stdout.write("\n");
};

await main();

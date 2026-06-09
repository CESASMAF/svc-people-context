#!/usr/bin/env bun

// Parses `bun test --coverage` output and enforces a minimum line coverage threshold.
// Bun outputs: "All files | XX.XX% | YY.YY% | ..."
// We check the "% Lines" column (second percentage).
// Exit code 1 if coverage is below the gate.

const MINIMUM_COVERAGE = 95;

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  // Match the "All files" row: "All files | 92.56 | 99.25 | ..."
  // First % is Funcs, second % is Lines
  const match = input.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) {
    console.error("Could not parse coverage from bun test --coverage output.");
    process.exit(1);
  }

  const lineCoverage = parseFloat(match[2]);

  if (lineCoverage < MINIMUM_COVERAGE) {
    console.error(
      `\nLine coverage ${lineCoverage.toFixed(2)}% is below the ${MINIMUM_COVERAGE}% threshold.`,
    );
    process.exit(1);
  }

  console.log(
    `\nLine coverage ${lineCoverage.toFixed(2)}% meets the ${MINIMUM_COVERAGE}% threshold.`,
  );
});

import * as readline from 'node:readline';

/**
 * Reads one line at a time from a single shared async iterator over a
 * readline interface. Using `rl.question()` repeatedly (once per prompt)
 * is unsafe with piped/scripted input: readline can buffer and emit lines
 * faster than each `question()` call re-attaches its listener, silently
 * dropping any line that arrives while nothing is listening. Pulling from
 * one continuously-consumed iterator has no such race. Shared by every GAP
 * CLI that needs interactive input (gap.ts, gap-generate.ts) so there's one
 * implementation, not a parallel one per entry point.
 */
export type LineReader = () => Promise<string | null>;

export function createLineReader(rl: readline.Interface): LineReader {
  const iterator = rl[Symbol.asyncIterator]();
  return async () => {
    const { value, done } = await iterator.next();
    return done ? null : value;
  };
}

export async function prompt(readLine: LineReader, text: string): Promise<string | null> {
  process.stdout.write(text);
  return readLine();
}

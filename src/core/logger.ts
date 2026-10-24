import path from 'node:path';
import { mkdirSync } from 'node:fs';
import pino, { type Logger } from 'pino';

/** Log legível no terminal + JSON em logs/<processo>_<data>.log. */
export function createLogger(processName: string, level: string, logsDir: string): Logger {
  mkdirSync(logsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const transport = pino.transport({
    targets: [
      { target: 'pino-pretty', level, options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
      {
        target: 'pino/file',
        level,
        options: { destination: path.join(logsDir, `${processName}_${day}.log`) },
      },
    ],
  });
  return pino({ level, base: { process: processName } }, transport);
}

export type { Logger };

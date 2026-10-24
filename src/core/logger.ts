import path from 'node:path';
import { mkdirSync } from 'node:fs';
import pino, { type Logger, type StreamEntry } from 'pino';
import pretty from 'pino-pretty';

export type LoggerOptions = {
  /** Log legível no terminal. Desligado no app instalado, que não tem terminal. */
  console?: boolean;
};

/**
 * Log legível no terminal + JSON em logs/<processo>_<data>.log.
 * Usa streams no próprio processo (sem worker thread), o que também funciona dentro do app.asar.
 */
export function createLogger(
  processName: string,
  level: pino.Level,
  logsDir: string,
  { console = true }: LoggerOptions = {},
): Logger {
  mkdirSync(logsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const streams: StreamEntry[] = [
    {
      level,
      stream: pino.destination({
        dest: path.join(logsDir, `${processName}_${day}.log`),
        sync: true,
      }),
    },
  ];
  if (console) {
    streams.push({
      level,
      stream: pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', sync: true }),
    });
  }
  return pino({ level, base: { process: processName } }, pino.multistream(streams));
}

export type { Logger };

import type { Logger } from 'pino';

import type { Config } from '../config/env.js';

export type ProcessContext = {
  config: Config;
  logger: Logger;
  args: string[];
};

export type RpaProcess = {
  name: string;
  description?: string;
  run(ctx: ProcessContext): Promise<void>;
};

/** Helper só para tipar a definição do processo. */
export function defineProcess(process: RpaProcess): RpaProcess {
  return process;
}

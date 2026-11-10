import { escolherUrlDaApi } from '../ambiente-dev.js';

// Injetada pelo `define` do esbuild em scripts/build-app.mjs (RPA_API_URL no build).
declare const __RPA_API_URL__: string;

/** Em dev, `RPA_API_URL` do ambiente vale sobre a do build (usado pela suíte E2E). */
export const urlDaApi = (empacotado: boolean): string =>
  escolherUrlDaApi(__RPA_API_URL__, process.env, empacotado);

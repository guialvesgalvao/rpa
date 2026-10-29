// Injetada pelo `define` do esbuild em scripts/build-app.mjs (RPA_API_URL no build).
declare const __RPA_API_URL__: string;

export const urlDaApi = (): string => __RPA_API_URL__;

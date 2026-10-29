import { criarApp } from './app.js';
import { lerConfig } from './config.js';

const config = lerConfig();
const app = criarApp({ logger: true });

// O Railway encerra o processo com SIGTERM a cada deploy.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.porta, host: config.host });

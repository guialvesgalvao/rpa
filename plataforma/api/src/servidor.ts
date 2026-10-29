import { criarApp } from './app.js';
import { lerConfig } from './config.js';
import { criarBanco } from './db/cliente.js';

const config = lerConfig();
const { db, fechar } = criarBanco(config.bancoUrl);
const app = criarApp({ db, jwtSegredo: config.jwtSegredo, logger: true });
app.addHook('onClose', () => fechar());

// O Railway encerra o processo com SIGTERM a cada deploy.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.porta, host: config.host });

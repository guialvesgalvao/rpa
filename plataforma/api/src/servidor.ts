import { criarApp } from './app.js';
import { criarArmazemS3 } from './arquivos/s3.js';
import { lerConfig } from './config.js';
import { criarBanco } from './db/cliente.js';

const config = lerConfig();
const { db, fechar } = criarBanco(config.bancoUrl);
const app = criarApp({
  db,
  jwtSegredo: config.jwtSegredo,
  logger: true,
  ...(config.bling && { bling: config.bling }),
  ...(config.arquivosS3 && { armazem: criarArmazemS3(config.arquivosS3) }),
});
app.log.info(
  config.arquivosS3 ? 'Arquivos no bucket S3' : 'Arquivos no Postgres (sem ARQUIVOS_S3_*)',
);
app.addHook('onClose', () => fechar());

// O Railway encerra o processo com SIGTERM a cada deploy.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.porta, host: config.host });

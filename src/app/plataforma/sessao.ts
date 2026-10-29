import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { ensureDir } from '../../utils/fs.js';
import { type ClientePlataforma, ErroIndisponivel, ErroRecusado } from './cliente.js';
import { EsquemaEu, type Eu } from './contratos.js';

/** Cifra do token de renovação; no app é o `safeStorage` assíncrono do Electron. */
export type CifraSessao = {
  disponivel(): boolean;
  cifrar(texto: string): Promise<string>;
  decifrar(cifrado: string): Promise<string>;
};

export type EstadoSessao =
  | { situacao: 'deslogado' }
  /** `offline`: o servidor não respondeu; vale o perfil em cache. */
  | { situacao: 'online' | 'offline'; perfil: Eu };

export type Sessao = {
  /** Reabre a sessão salva: renova o acesso, ou fica offline com o perfil em cache. */
  iniciar(): Promise<EstadoSessao>;
  /** Erros do cliente (`ErroRecusado`, `ErroIndisponivel`) sobem para quem chamou. */
  entrar(email: string, senha: string): Promise<EstadoSessao>;
  /** Revoga na API se puder; apaga a sessão local sempre. */
  sair(): Promise<void>;
  /** Token de acesso válido (renovado antes de expirar), ou `undefined` se deslogado ou offline. */
  obterAcesso(): Promise<string | undefined>;
  estado(): EstadoSessao;
};

export type DepsSessao = {
  cliente: ClientePlataforma;
  cifra: CifraSessao;
  /** Caminho de `<baseDir>/data/sessao.json`. */
  arquivo: string;
  relogio: () => Date;
};

/** Renova o acesso com esta folga antes de `expiraEm`. */
const MARGEM_RENOVACAO_MS = 60_000;

const arquivoSchema = z.object({
  renovacaoEnc: z.string().min(1),
  perfil: EsquemaEu,
  atualizadoEm: z.iso.datetime(),
});

export function criarSessao({ cliente, cifra, arquivo, relogio }: DepsSessao): Sessao {
  let estado: EstadoSessao = { situacao: 'deslogado' };
  let renovacao: string | undefined;
  let acesso: { token: string; expiraEm: number } | undefined;
  let renovando: Promise<string | undefined> | undefined;

  async function salvar(token: string, perfil: Eu): Promise<void> {
    await ensureDir(path.dirname(arquivo));
    const conteudo = {
      renovacaoEnc: await cifra.cifrar(token),
      perfil,
      atualizadoEm: relogio().toISOString(),
    };
    await writeFile(arquivo, `${JSON.stringify(conteudo, null, 2)}\n`, 'utf8');
  }

  async function esquecer(): Promise<void> {
    estado = { situacao: 'deslogado' };
    renovacao = undefined;
    acesso = undefined;
    await rm(arquivo, { force: true });
  }

  function guardar(tokens: { acesso: string; renovacao: string; expiraEm: string }): void {
    renovacao = tokens.renovacao;
    acesso = { token: tokens.acesso, expiraEm: Date.parse(tokens.expiraEm) };
  }

  /** Uma renovação por vez: o token rotaciona a cada uso, e reaproveitar um antigo revoga a sessão. */
  function renovar(): Promise<string | undefined> {
    renovando ??= executarRenovacao().finally(() => {
      renovando = undefined;
    });
    return renovando;
  }

  async function executarRenovacao(): Promise<string | undefined> {
    const atual = renovacao;
    if (!atual || estado.situacao === 'deslogado') return undefined;
    const perfilEmCache = estado.perfil;
    try {
      const tokens = await cliente.renovar(atual);
      guardar(tokens);
      // O perfil pode ter mudado no servidor; sem rede para buscá-lo, vale o cache.
      let perfil = perfilEmCache;
      try {
        perfil = await cliente.eu(tokens.acesso);
      } catch (erro) {
        if (!(erro instanceof ErroIndisponivel)) throw erro;
      }
      estado = { situacao: 'online', perfil };
      await salvar(tokens.renovacao, perfil);
      return tokens.acesso;
    } catch (erro) {
      if (erro instanceof ErroRecusado) {
        await esquecer();
        return undefined;
      }
      if (erro instanceof ErroIndisponivel) {
        acesso = undefined;
        estado = { situacao: 'offline', perfil: perfilEmCache };
        return undefined;
      }
      throw erro;
    }
  }

  return {
    estado: () => estado,

    async iniciar() {
      let conteudo: z.infer<typeof arquivoSchema>;
      try {
        conteudo = arquivoSchema.parse(JSON.parse(await readFile(arquivo, 'utf8')));
        renovacao = await cifra.decifrar(conteudo.renovacaoEnc);
      } catch {
        // Ausente, corrompido ou cifrado por outro usuário do Windows: sem sessão.
        await esquecer();
        return estado;
      }
      estado = { situacao: 'offline', perfil: conteudo.perfil };
      await renovar();
      return estado;
    },

    async entrar(email, senha) {
      if (!cifra.disponivel()) {
        throw new Error('Cifra do sistema indisponível: não é possível guardar a sessão.');
      }
      const resposta = await cliente.entrar(email, senha);
      guardar(resposta);
      estado = { situacao: 'online', perfil: resposta.eu };
      await salvar(resposta.renovacao, resposta.eu);
      return estado;
    },

    async sair() {
      // Uma renovação em curso rotaciona o token: espera para revogar o vigente.
      await renovando;
      const token = renovacao;
      if (token) {
        try {
          await cliente.sair(token);
        } catch {
          // Sem rede ou token já inválido: o logout local vale do mesmo jeito.
        }
      }
      await esquecer();
    },

    async obterAcesso() {
      if (estado.situacao === 'deslogado') return undefined;
      if (acesso && acesso.expiraEm - MARGEM_RENOVACAO_MS > relogio().getTime()) {
        return acesso.token;
      }
      return renovar();
    },
  };
}

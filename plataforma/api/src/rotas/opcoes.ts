import { EsquemaNovaCor, validarNovaCor, type Opcao } from '@plataforma/contratos';
import type { FastifyInstance } from 'fastify';

import { criarCor, listarCores, listarMaquinas } from '../artes/repositorio.js';
import { violouUnico } from '../artes/servico.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi, lerCorpo } from '../erros.js';

// Cores e máquinas são globais (iguais nas duas empresas): basta estar autenticado. Cor nova: quem pode
// adicionar artes em alguma empresa.
export function rotasOpcoes(app: FastifyInstance, { db }: { db: Banco }): void {
  const preHandler = app.autenticacao.exigirUsuario;
  const cadastro = [preHandler, app.autenticacao.exigirPermissaoEmAlgumaEmpresa('artes.adicionar')];

  app.get('/v1/cores', { preHandler }, async (): Promise<Opcao[]> => listarCores(db));
  app.get('/v1/maquinas', { preHandler }, async (): Promise<Opcao[]> => listarMaquinas(db));

  app.post('/v1/cores', { preHandler: cadastro }, async (request, reply): Promise<Opcao> => {
    const { nome } = lerCorpo(EsquemaNovaCor, request.body);
    const erro = validarNovaCor(nome);
    if (erro) throw new ErroApi(422, 'validacao', erro);
    try {
      const cor = await criarCor(db, nome);
      request.log.info({ corId: cor.id }, 'Cor criada');
      return reply.code(201).send(cor);
    } catch (falha) {
      if (violouUnico(falha)) {
        throw new ErroApi(409, 'cor_existente', `A cor '${nome.trim()}' já existe.`);
      }
      throw falha;
    }
  });
}

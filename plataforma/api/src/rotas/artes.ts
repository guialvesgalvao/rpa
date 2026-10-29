import multipart from '@fastify/multipart';
import {
  type Arte,
  detectarTipo,
  LIMITES,
  type TipoArquivo,
  validarNovaArte,
} from '@plataforma/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { buscarCliente, ehUuid, idDaEmpresa } from '../artes/repositorio.js';
import { type ArquivoRecebido, atualizarArte, criarArte, removerArte } from '../artes/servico.js';
import type { Banco } from '../db/cliente.js';
import { ErroApi } from '../erros.js';
import { usuarioDe } from '../plugins/autenticacao.js';

type CamposArte = {
  produtoId?: string;
  nome?: string;
  corId?: string;
  maquinaIds?: string[];
  removerPdf: boolean;
  removerImagem: boolean;
  pdf?: ArquivoRecebido;
  imagem?: ArquivoRecebido;
};

const NOMES_TEXTO = new Set([
  'produtoId',
  'nome',
  'corId',
  'maquinaIds',
  'removerPdf',
  'removerImagem',
]);
const LIMITE_POR_TIPO: Record<TipoArquivo, number> = {
  pdf: LIMITES.pdfBytes,
  imagem: LIMITES.imagemBytes,
};
const MB = 1024 * 1024;

const requisicaoInvalida = (detalhe: string) =>
  new ErroApi(400, 'requisicao_invalida', `Requisição inválida (${detalhe}).`);
const arquivoGrande = (campo: TipoArquivo) =>
  new ErroApi(
    413,
    'arquivo_grande',
    `O ${campo === 'pdf' ? 'PDF' : 'arquivo de imagem'} passa de ${LIMITE_POR_TIPO[campo] / MB} MB.`,
  );

// Lê o multipart em memória, com o limite de cada arquivo (413) e o tipo conferido pelos primeiros bytes (415).
async function lerCampos(request: FastifyRequest): Promise<CamposArte> {
  const campos: CamposArte = { removerPdf: false, removerImagem: false };
  const maquinaIds: string[] = [];
  let enviouMaquinas = false;

  for await (const parte of request.parts()) {
    if (parte.type === 'field') {
      if (!NOMES_TEXTO.has(parte.fieldname)) throw requisicaoInvalida(parte.fieldname);
      const valor = String(parte.value).trim();
      switch (parte.fieldname) {
        case 'maquinaIds':
          enviouMaquinas = true;
          if (valor) maquinaIds.push(valor);
          break;
        case 'removerPdf':
          campos.removerPdf = valor === 'true';
          break;
        case 'removerImagem':
          campos.removerImagem = valor === 'true';
          break;
        default:
          // O nome é guardado como veio (só `nomeOuPadrao` o trata); ids em branco valem como ausentes.
          campos[parte.fieldname as 'produtoId' | 'nome' | 'corId'] =
            parte.fieldname === 'nome' ? String(parte.value) : valor;
      }
      continue;
    }

    if (parte.fieldname !== 'pdf' && parte.fieldname !== 'imagem') {
      parte.file.resume();
      throw requisicaoInvalida(parte.fieldname);
    }
    const campo: TipoArquivo = parte.fieldname;
    let conteudo: Buffer;
    try {
      conteudo = await parte.toBuffer();
    } catch (erro) {
      if ((erro as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw arquivoGrande(campo);
      throw erro;
    }
    // Campo de arquivo sem seleção (formulário HTML): vem sem nome e sem bytes.
    if (!parte.filename && conteudo.length === 0) continue;
    if (conteudo.length > LIMITE_POR_TIPO[campo]) throw arquivoGrande(campo);

    const detectado = detectarTipo(conteudo);
    if (detectado?.tipo !== campo) {
      throw new ErroApi(
        415,
        'tipo_nao_suportado',
        campo === 'pdf'
          ? 'O arquivo enviado como PDF não é um PDF.'
          : 'A imagem precisa ser PNG, JPEG ou WebP.',
      );
    }
    campos[campo] = {
      nomeOriginal: parte.filename || `${campo}`,
      tipoMime: detectado.mime,
      conteudo,
    };
  }

  if (enviouMaquinas) campos.maquinaIds = maquinaIds;
  return campos;
}

function exigirIds(campos: CamposArte): void {
  const invalidos = [campos.produtoId, campos.corId, ...(campos.maquinaIds ?? [])].filter(
    (id) => id && !ehUuid(id),
  );
  if (invalidos.length) throw new ErroApi(422, 'validacao', 'Identificador inválido.');
}

export function rotasArtes(app: FastifyInstance, { db }: { db: Banco }): void {
  // Registro encapsulado: o parser multipart vale só para estas rotas.
  void app.register(async (escopo) => {
    await escopo.register(multipart, {
      // O teto do parser é o do maior arquivo; a imagem tem o limite próprio conferido acima.
      limits: { fileSize: LIMITES.pdfBytes, files: 2, fields: 20, parts: 30 },
    });

    const comEmpresa = [
      escopo.autenticacao.exigirUsuario,
      escopo.autenticacao.exigirEmpresa('empresa'),
    ];
    const cadastro = [...comEmpresa, escopo.autenticacao.exigirPerfil('admin', 'arte_finalista')];
    const soAdmin = [...comEmpresa, escopo.autenticacao.exigirPerfil('admin')];

    // Empresa do token que não existe no banco: tratada como inexistente.
    async function empresaDe(request: FastifyRequest): Promise<string> {
      const { empresa } = request.params as { empresa: string };
      const id = await idDaEmpresa(db, empresa);
      if (!id) throw new ErroApi(404, 'empresa_nao_encontrada', 'Empresa não encontrada.');
      return id;
    }

    const arteNaoEncontrada = () => new ErroApi(404, 'arte_nao_encontrada', 'Arte não encontrada.');

    escopo.post(
      '/v1/empresas/:empresa/clientes/:id/artes',
      { preHandler: cadastro },
      async (request, reply): Promise<Arte> => {
        const empresaId = await empresaDe(request);
        const { id } = request.params as { id: string };
        const cliente = ehUuid(id) ? await buscarCliente(db, empresaId, id) : null;
        if (!cliente) throw new ErroApi(404, 'cliente_nao_encontrado', 'Cliente não encontrado.');

        const campos = await lerCampos(request);
        exigirIds(campos);
        const erros = validarNovaArte({
          produtoId: campos.produtoId ?? '',
          nome: campos.nome,
          corId: campos.corId ?? '',
          maquinaIds: campos.maquinaIds ?? [],
          pdf: campos.pdf && { tamanho: campos.pdf.conteudo.length, tipo: 'pdf' },
          imagem: campos.imagem && { tamanho: campos.imagem.conteudo.length, tipo: 'imagem' },
        });
        const primeiroErro = Object.values(erros)[0];
        if (primeiroErro) throw new ErroApi(422, 'validacao', primeiroErro);

        const arte = await criarArte(db, {
          empresaId,
          clienteId: cliente.id,
          usuarioId: usuarioDe(request).usuarioId,
          produtoId: campos.produtoId ?? '',
          nome: campos.nome,
          corId: campos.corId ?? '',
          maquinaIds: campos.maquinaIds ?? [],
          pdf: campos.pdf,
          imagem: campos.imagem,
        });
        return reply.code(201).send(arte);
      },
    );

    escopo.patch(
      '/v1/empresas/:empresa/artes/:id',
      { preHandler: soAdmin },
      async (request): Promise<Arte> => {
        const empresaId = await empresaDe(request);
        const { id } = request.params as { id: string };
        if (!ehUuid(id)) throw arteNaoEncontrada();

        const campos = await lerCampos(request);
        exigirIds(campos);
        const arte = await atualizarArte(db, {
          empresaId,
          arteId: id,
          usuarioId: usuarioDe(request).usuarioId,
          ...campos,
        });
        if (!arte) throw arteNaoEncontrada();
        return arte;
      },
    );

    escopo.delete(
      '/v1/empresas/:empresa/artes/:id',
      { preHandler: soAdmin },
      async (request, reply) => {
        const empresaId = await empresaDe(request);
        const { id } = request.params as { id: string };
        if (!ehUuid(id) || !(await removerArte(db, empresaId, id))) throw arteNaoEncontrada();
        return reply.code(204).send();
      },
    );
  });
}

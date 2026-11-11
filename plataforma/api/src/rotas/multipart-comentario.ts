import { ANEXOS_POR_COMENTARIO, detectarTipo, LIMITES } from '@plataforma/contratos';
import type { FastifyRequest } from 'fastify';

import type { ArquivoRecebido } from '../arquivos/armazem.js';
import { ErroApi } from '../erros.js';

const MB = 1024 * 1024;

// Comentário em multipart: `texto` (opcional com anexo) e até 5 `anexos` (PDF ou imagem, com os limites e a
// detecção de tipo das artes). Um arquivo a mais que o limite é lido só para responder 400.
export async function lerComentarioMultipart(
  request: FastifyRequest,
  textoMax: number,
): Promise<{ texto: string; anexos: ArquivoRecebido[] }> {
  let texto = '';
  const anexos: ArquivoRecebido[] = [];
  const partes = request.parts({
    limits: { fileSize: LIMITES.pdfBytes, files: ANEXOS_POR_COMENTARIO + 1, fields: 2, parts: 10 },
  });
  for await (const parte of partes) {
    if (parte.type === 'field') {
      if (parte.fieldname !== 'texto') {
        throw new ErroApi(400, 'requisicao_invalida', `Requisição inválida (${parte.fieldname}).`);
      }
      texto = String(parte.value).trim();
      continue;
    }
    if (parte.fieldname !== 'anexos') {
      parte.file.resume();
      throw new ErroApi(400, 'requisicao_invalida', `Requisição inválida (${parte.fieldname}).`);
    }
    if (anexos.length >= ANEXOS_POR_COMENTARIO) {
      parte.file.resume();
      throw new ErroApi(
        400,
        'anexos_demais',
        `Anexe no máximo ${ANEXOS_POR_COMENTARIO} arquivos por comentário.`,
      );
    }
    let conteudo: Buffer;
    try {
      conteudo = await parte.toBuffer();
    } catch (erro) {
      if ((erro as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ErroApi(413, 'arquivo_grande', `O PDF passa de ${LIMITES.pdfBytes / MB} MB.`);
      }
      throw erro;
    }
    // Campo de arquivo sem seleção (formulário HTML): vem sem nome e sem bytes.
    if (!parte.filename && conteudo.length === 0) continue;
    const detectado = detectarTipo(conteudo);
    if (!detectado) {
      throw new ErroApi(
        415,
        'tipo_nao_suportado',
        'O anexo precisa ser PDF ou imagem PNG, JPEG ou WebP.',
      );
    }
    if (detectado.tipo === 'imagem' && conteudo.length > LIMITES.imagemBytes) {
      throw new ErroApi(
        413,
        'arquivo_grande',
        `O arquivo de imagem passa de ${LIMITES.imagemBytes / MB} MB.`,
      );
    }
    anexos.push({
      nomeOriginal: parte.filename || `anexo-${anexos.length + 1}`,
      tipoMime: detectado.mime,
      conteudo,
    });
  }
  if (texto.length > textoMax) {
    throw new ErroApi(400, 'requisicao_invalida', 'Requisição inválida (texto).');
  }
  return { texto, anexos };
}

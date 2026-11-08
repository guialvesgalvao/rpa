import 'server-only';

import { EsquemaUsuarioResumo, type UsuarioResumo } from '@plataforma/contratos';
import { z } from 'zod';

import { lerDaApi } from './artes';

// Usuários que o admin pode ver (todas as empresas deles entre as do admin). Outro perfil: a API responde
// 403 e a página vira 404.
export const usuariosDoAdmin = (): Promise<UsuarioResumo[]> =>
  lerDaApi('/v1/usuarios', z.array(EsquemaUsuarioResumo));

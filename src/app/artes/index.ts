import type { ArtesApi } from '../api.js';
import { montarCliente } from './cliente.js';
import { montarFormulario } from './formulario.js';
import { montarLista } from './lista.js';

type Visao = { encerrar(): void };

/**
 * Navegação da aba Artes: lista → cliente → nova arte. A lista fica montada (com a busca e o que já
 * carregou) enquanto se vê um cliente; `reiniciar` descarta tudo, para a troca de empresa ou de usuário.
 */
export function criarArtes(
  raiz: HTMLElement,
  api: ArtesApi,
): { reiniciar(): void; encerrar(): void } {
  const areaLista = document.createElement('div');
  const areaDetalhe = document.createElement('div');
  raiz.append(areaLista, areaDetalhe);
  areaDetalhe.hidden = true;

  let lista: Visao | undefined;
  let detalhe: Visao | undefined;

  function mostrarLista() {
    detalhe?.encerrar();
    detalhe = undefined;
    areaDetalhe.hidden = true;
    areaLista.hidden = false;
  }

  function mostrarDetalhe(abrir: () => Visao) {
    detalhe?.encerrar();
    areaLista.hidden = true;
    areaDetalhe.hidden = false;
    detalhe = abrir();
  }

  function mostrarCliente(clienteId: string, sucesso?: string) {
    mostrarDetalhe(() =>
      montarCliente(areaDetalhe, {
        api,
        clienteId,
        sucesso,
        voltar: mostrarLista,
        cadastrar: (cliente) =>
          mostrarDetalhe(() =>
            montarFormulario(areaDetalhe, {
              api,
              cliente,
              voltar: () => mostrarCliente(clienteId),
              concluido: () => mostrarCliente(clienteId, 'Arte cadastrada'),
            }),
          ),
      }),
    );
  }

  function encerrar() {
    lista?.encerrar();
    lista = undefined;
    mostrarLista();
  }

  return {
    encerrar,
    reiniciar() {
      encerrar();
      lista = montarLista(areaLista, {
        api,
        abrirCliente: (cliente) => mostrarCliente(cliente.id),
      });
    },
  };
}

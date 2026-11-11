import type { EmpresaSessaoTela, UsuariosApi } from '../api.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import {
  alternarPermissao,
  type Area,
  AREAS,
  modulosDaEmpresa,
  normalizarPermissoes,
  type Permissao,
  ROTULOS_AREA,
  SENHA_MINIMA,
  temPermissao,
  type UsuarioDetalhe,
} from '../plataforma/contratos.js';
import { descreverUsuario, empresasCom, empresasDoFormulario, podeEditarDados } from './dados.js';

/** Quem usa o app: as empresas dele com as permissões em cada uma, a empresa em uso e o e-mail. */
export type ContextoUsuarios = {
  empresas: EmpresaSessaoTela[];
  empresaAtual: string;
  email: string;
};

function campo(rotulo: string, controle: HTMLElement, id: string): HTMLElement {
  const bloco = criar('div', 'artes-campo');
  const label = criar('label', undefined, rotulo);
  label.htmlFor = id;
  controle.id = id;
  bloco.append(label, controle);
  return bloco;
}

function status(): HTMLElement {
  const mensagem = criar('div', 'hint');
  mensagem.setAttribute('role', 'status');
  return mensagem;
}

function seletorDeArea(valor: Area | null): HTMLSelectElement {
  const area = criar('select');
  area.append(new Option('Selecione…', ''));
  for (const a of AREAS) area.append(new Option(ROTULOS_AREA[a], a));
  area.value = valor ?? '';
  return area;
}

/**
 * As permissões de uma empresa como caixas: cada módulo e, recuadas, as subpermissões dele, que só podem ser
 * marcadas com o módulo marcado. Os módulos vêm do catálogo: módulo novo aparece aqui sozinho.
 */
function camposDePermissoes(
  empresa: EmpresaSessaoTela,
  iniciais: readonly string[],
): { bloco: HTMLElement; valor(): Permissao[] } {
  let valor = normalizarPermissoes(iniciais);
  const bloco = criar('div', 'artes-campo');
  const grupo = criar('div', 'artes-opcoes permissoes');
  grupo.setAttribute('role', 'group');
  grupo.setAttribute('aria-label', `Permissões em ${empresa.nome}`);
  bloco.append(criar('label', undefined, `Permissões em ${empresa.nome}`), grupo);

  function desenhar() {
    grupo.replaceChildren();
    const caixa = (chave: Permissao, rotulo: string, travada: boolean, recuada: boolean) => {
      const linha = criar('label', recuada ? 'check permissao-sub' : 'check');
      const check = criar('input');
      check.type = 'checkbox';
      check.checked = valor.includes(chave);
      check.disabled = travada;
      check.addEventListener('change', () => {
        valor = alternarPermissao(valor, chave, check.checked);
        desenhar();
      });
      linha.append(check, rotulo);
      grupo.append(linha);
    };
    for (const modulo of modulosDaEmpresa(empresa.slug)) {
      caixa(modulo.chave, modulo.rotulo, false, false);
      for (const sub of modulo.subpermissoes) {
        caixa(sub.chave, sub.rotulo, !valor.includes(modulo.chave), true);
      }
    }
  }
  desenhar();
  return { bloco, valor: () => valor };
}

/**
 * Aba Usuários (ADR 0011): quem tem o módulo vê a lista da empresa em uso; criar, editar e excluir exigem
 * "Editar e excluir usuários"; marcar permissões exige "Editar permissão de usuários". A API confere de novo.
 */
export function criarUsuarios(
  raiz: HTMLElement,
  api: UsuariosApi,
): { reiniciar(contexto: ContextoUsuarios): void; encerrar(): void } {
  let geracao = 0;

  function gruposDeEmpresas(
    opcoes: readonly EmpresaSessaoTela[],
    marcadas: readonly string[],
    fixa: boolean,
    aoMudar?: () => void,
  ): { bloco: HTMLElement; escolhidas(): string[] } {
    const bloco = criar('div', 'artes-campo');
    const grupo = criar('div', 'artes-opcoes');
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', 'Empresas');
    bloco.append(criar('label', undefined, 'Empresas'), grupo);
    const checks = opcoes.map((empresa) => {
      const rotulo = criar('label', 'check');
      const check = criar('input');
      check.type = 'checkbox';
      check.value = empresa.slug;
      check.checked = marcadas.includes(empresa.slug);
      check.disabled = fixa;
      if (aoMudar) check.addEventListener('change', aoMudar);
      rotulo.append(check, empresa.nome);
      grupo.append(rotulo);
      return check;
    });
    return { bloco, escolhidas: () => checks.filter((c) => c.checked).map((c) => c.value) };
  }

  function montarLista(contexto: ContextoUsuarios, aviso?: string) {
    const minha = ++geracao;
    raiz.replaceChildren();
    const minhas =
      contexto.empresas.find((empresa) => empresa.slug === contexto.empresaAtual)?.permissoes ?? [];
    const podeEditar = temPermissao(minhas, 'usuarios.editar');
    const podeAbrir = podeEditar || temPermissao(minhas, 'usuarios.permissoes');

    const cardLista = criar('div', 'card');
    const lista = criar('ul', 'artes-lista');
    const situacao = criar('div', 'artes-situacao');
    const avisoLista = status();
    avisoLista.textContent = aviso ?? '';
    cardLista.append(criar('h2', undefined, 'Usuários'), avisoLista, lista, situacao);

    async function carregar() {
      situacao.replaceChildren(criar('div', 'hint', 'Carregando…'));
      try {
        const usuarios = await api.listar();
        if (minha !== geracao) return;
        lista.replaceChildren(
          ...usuarios.map((usuario) => {
            const item = criar('li', 'artes-item');
            const texto = criar('span', 'tarefa-item-texto');
            texto.append(
              criar('span', 'artes-item-nome', `${usuario.nome} — ${usuario.email}`),
              criar('span', 'artes-item-cnpj', descreverUsuario(usuario, contexto.empresas)),
            );
            item.append(texto);
            if (podeAbrir) {
              const editar = botao('Editar', () => montarEdicao(contexto, usuario));
              editar.setAttribute('aria-label', `Editar ${usuario.nome}`);
              item.append(editar);
            }
            return item;
          }),
        );
        situacao.replaceChildren(
          ...(usuarios.length ? [] : [criar('div', 'hint', 'Nenhum usuário encontrado.')]),
        );
      } catch (erro) {
        if (minha !== geracao) return;
        situacao.replaceChildren(blocoErro(mensagemErro(erro), () => void carregar()));
      }
    }

    const topo = criar('div', 'artes-topo');
    topo.append(botao('Atualizar lista', () => void carregar()));
    raiz.append(topo, cardLista);
    if (podeEditar) raiz.append(cardNovoUsuario(contexto, minha, () => void carregar()));
    void carregar();
  }

  function cardNovoUsuario(
    contexto: ContextoUsuarios,
    minha: number,
    aoCriar: () => void,
  ): HTMLElement {
    const { opcoes, fixa, marcadas } = empresasDoFormulario(
      empresasCom(contexto.empresas, 'usuarios.editar'),
    );
    const comPermissoes = empresasCom(contexto.empresas, 'usuarios.permissoes').map(
      (empresa) => empresa.slug,
    );
    const form = criar('form', 'artes-form');
    form.noValidate = true;
    const nome = criar('input');
    nome.type = 'text';
    nome.maxLength = 200;
    const email = criar('input');
    email.type = 'email';
    email.autocomplete = 'off';
    email.maxLength = 200;
    const area = seletorDeArea(null);
    const senha = criar('input');
    senha.type = 'password';
    senha.autocomplete = 'new-password';
    senha.maxLength = 200;
    const blocoSenha = campo('Senha inicial', senha, 'usuario-senha');
    blocoSenha.append(
      criar(
        'div',
        'hint',
        `Ao menos ${SENHA_MINIMA} caracteres. Passe a senha ao usuário por um canal seguro; ele troca no primeiro login.`,
      ),
    );

    // Um bloco de permissões por empresa marcada em que quem cria pode editar permissões.
    const areaPermissoes = criar('div');
    let permissoes = new Map<string, ReturnType<typeof camposDePermissoes>>();
    const empresas = gruposDeEmpresas(opcoes, marcadas, fixa, () => desenharPermissoes());
    function desenharPermissoes() {
      const novas = new Map<string, ReturnType<typeof camposDePermissoes>>();
      for (const empresa of opcoes) {
        if (!empresas.escolhidas().includes(empresa.slug)) continue;
        if (!comPermissoes.includes(empresa.slug)) continue;
        novas.set(
          empresa.slug,
          camposDePermissoes(empresa, permissoes.get(empresa.slug)?.valor() ?? []),
        );
      }
      permissoes = novas;
      areaPermissoes.replaceChildren(...[...novas.values()].map((campos) => campos.bloco));
    }
    desenharPermissoes();

    const mensagem = status();
    const criarBotao = criar('button', 'primary', 'Criar usuário');
    criarBotao.type = 'submit';
    const acoes = criar('div', 'actions');
    acoes.append(criarBotao);
    form.append(
      campo('Nome', nome, 'usuario-nome'),
      campo('E-mail', email, 'usuario-email'),
      campo('Área', area, 'usuario-area'),
      empresas.bloco,
      blocoSenha,
      areaPermissoes,
      mensagem,
      acoes,
    );

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mensagem.className = 'hint';
      mensagem.textContent = '';
      // A área é obrigatória no formulário (usuários antigos podem estar sem; a API aceita vazio).
      if (!area.value) {
        mensagem.className = 'hint warn';
        mensagem.textContent = 'Escolha a área.';
        return;
      }
      criarBotao.disabled = true;
      try {
        const criado = await api.criar({
          nome: nome.value,
          email: email.value,
          area: area.value as Area,
          empresas: empresas.escolhidas(),
          senha: senha.value,
          permissoes: Object.fromEntries(
            [...permissoes].map(([slug, campos]) => [slug, campos.valor()]),
          ),
        });
        if (minha !== geracao) return;
        mensagem.textContent = `Usuário ${criado.email} criado. Ele troca a senha no primeiro login.`;
        form.reset();
        area.value = '';
        permissoes = new Map();
        desenharPermissoes();
        aoCriar();
      } catch (erro) {
        if (minha !== geracao) return;
        mensagem.className = 'hint warn';
        mensagem.textContent = mensagemErro(erro);
      } finally {
        criarBotao.disabled = false;
      }
    });

    const card = criar('div', 'card');
    card.append(criar('h2', undefined, 'Novo usuário'), form);
    return card;
  }

  function montarEdicao(contexto: ContextoUsuarios, usuario: UsuarioDetalhe) {
    const minha = ++geracao;
    raiz.replaceChildren();
    const voltar = (aviso?: string) => montarLista(contexto, aviso);
    const topo = criar('div', 'artes-topo');
    topo.append(botao('← Usuários', () => voltar()));

    const cabecalho = criar('div', 'card');
    cabecalho.append(
      criar('h2', undefined, usuario.nome),
      criar('div', 'hint', `${usuario.email} · ${descreverUsuario(usuario, contexto.empresas)}`),
    );
    raiz.append(topo, cabecalho);

    const minhas =
      contexto.empresas.find((empresa) => empresa.slug === contexto.empresaAtual)?.permissoes ?? [];
    const podeEditar = temPermissao(minhas, 'usuarios.editar');
    const emTodas = podeEditarDados(usuario, contexto.empresas);

    if (podeEditar) {
      const card = criar('div', 'card');
      card.append(criar('h2', undefined, 'Dados'));
      if (emTodas) card.append(formDados(contexto, usuario, minha));
      else
        card.append(
          criar(
            'p',
            'hint',
            'Este usuário também pertence a uma empresa em que você não pode editar usuários. Os dados e a exclusão ficam com quem administra todas as empresas dele.',
          ),
        );
      raiz.append(card);
    }

    for (const empresa of empresasCom(contexto.empresas, 'usuarios.permissoes')) {
      const dele = usuario.empresas.find(({ slug }) => slug === empresa.slug);
      if (!dele) continue;
      raiz.append(cardPermissoes(empresa, usuario, dele.permissoes, minha));
    }

    if (podeEditar && emTodas && usuario.email !== contexto.email) {
      const card = criar('div', 'card');
      const mensagem = criar('div', 'hint warn');
      mensagem.setAttribute('role', 'alert');
      const excluir = botao('Excluir usuário', () => {
        if (!window.confirm(`Excluir o usuário ${usuario.nome}? Ele perde o acesso imediatamente.`))
          return;
        excluir.disabled = true;
        mensagem.textContent = '';
        api
          .excluir(usuario.id)
          .then(() => {
            if (minha === geracao) voltar('Usuário excluído');
          })
          .catch((erro: unknown) => {
            if (minha !== geracao) return;
            mensagem.textContent = mensagemErro(erro);
            excluir.disabled = false;
          });
      });
      const acoes = criar('div', 'actions');
      acoes.append(excluir);
      card.append(
        criar('h2', undefined, 'Excluir'),
        criar(
          'p',
          'hint',
          'O usuário perde o acesso na hora e sai da lista. O histórico continua mostrando o nome dele, e o e-mail não pode ser usado em outro cadastro.',
        ),
        mensagem,
        acoes,
      );
      raiz.append(card);
    }
  }

  function formDados(
    contexto: ContextoUsuarios,
    usuario: UsuarioDetalhe,
    minha: number,
  ): HTMLElement {
    const form = criar('form', 'artes-form');
    form.noValidate = true;
    const nome = criar('input');
    nome.type = 'text';
    nome.maxLength = 200;
    nome.value = usuario.nome;
    const email = criar('input');
    email.type = 'email';
    email.autocomplete = 'off';
    email.maxLength = 200;
    email.value = usuario.email;
    const area = seletorDeArea(usuario.area);
    const { opcoes } = empresasDoFormulario(empresasCom(contexto.empresas, 'usuarios.editar'));
    const empresas = gruposDeEmpresas(
      opcoes,
      usuario.empresas.map(({ slug }) => slug),
      false,
    );
    const mensagem = status();
    const salvar = criar('button', 'primary', 'Salvar dados');
    salvar.type = 'submit';
    const acoes = criar('div', 'actions');
    acoes.append(salvar);
    form.append(
      campo('Nome', nome, 'usuario-nome'),
      campo('E-mail', email, 'usuario-email'),
      campo('Área', area, 'usuario-area'),
      empresas.bloco,
      mensagem,
      acoes,
    );
    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mensagem.className = 'hint';
      mensagem.textContent = '';
      if (!area.value) {
        mensagem.className = 'hint warn';
        mensagem.textContent = 'Escolha a área.';
        return;
      }
      salvar.disabled = true;
      try {
        const salvo = await api.editar(usuario.id, {
          nome: nome.value,
          email: email.value,
          area: area.value as Area,
          empresas: empresas.escolhidas(),
        });
        if (minha !== geracao) return;
        // A tela é refeita com o usuário salvo (as empresas podem ter mudado os blocos de permissões).
        montarEdicao(contexto, salvo);
        const aviso = raiz.querySelector<HTMLElement>('form [role="status"]');
        if (aviso) aviso.textContent = 'Dados salvos.';
      } catch (erro) {
        if (minha !== geracao) return;
        mensagem.className = 'hint warn';
        mensagem.textContent = mensagemErro(erro);
        salvar.disabled = false;
      }
    });
    return form;
  }

  function cardPermissoes(
    empresa: EmpresaSessaoTela,
    usuario: UsuarioDetalhe,
    iniciais: readonly string[],
    minha: number,
  ): HTMLElement {
    const card = criar('div', 'card');
    const form = criar('form', 'artes-form');
    form.noValidate = true;
    const campos = camposDePermissoes(empresa, iniciais);
    const mensagem = status();
    const salvar = criar('button', 'primary', `Salvar permissões em ${empresa.nome}`);
    salvar.type = 'submit';
    const acoes = criar('div', 'actions');
    acoes.append(salvar);
    form.append(campos.bloco, mensagem, acoes);
    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mensagem.className = 'hint';
      mensagem.textContent = '';
      salvar.disabled = true;
      try {
        await api.definirPermissoes(usuario.id, empresa.slug, campos.valor());
        if (minha !== geracao) return;
        mensagem.textContent = `Permissões em ${empresa.nome} salvas.`;
      } catch (erro) {
        if (minha !== geracao) return;
        mensagem.className = 'hint warn';
        mensagem.textContent = mensagemErro(erro);
      } finally {
        salvar.disabled = false;
      }
    });
    card.append(criar('h2', undefined, 'Permissões'), form);
    return card;
  }

  return {
    reiniciar: (contexto) => montarLista(contexto),
    encerrar() {
      geracao++;
      raiz.replaceChildren();
    },
  };
}

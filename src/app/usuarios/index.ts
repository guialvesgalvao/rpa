import type { EmpresaTela, UsuariosApi } from '../api.js';
import { blocoErro, botao, criar, mensagemErro } from '../artes/dom.js';
import { type Perfil, ROTULOS_PERFIL, SENHA_MINIMA } from '../plataforma/contratos.js';
import { descreverUsuario, empresasDoFormulario } from './dados.js';

const PERFIS: Perfil[] = ['arte_finalista', 'admin'];

function campo(rotulo: string, controle: HTMLElement, id: string): HTMLElement {
  const bloco = criar('div', 'artes-campo');
  const label = criar('label', undefined, rotulo);
  label.htmlFor = id;
  controle.id = id;
  bloco.append(label, controle);
  return bloco;
}

/**
 * Aba Usuários (só admin): lista os usuários das empresas do admin e cria novos com a senha inicial,
 * que o usuário troca no primeiro login. Editar, desativar e trocar a senha de outro continuam na CLI.
 */
export function criarUsuarios(
  raiz: HTMLElement,
  api: UsuariosApi,
): { reiniciar(empresas: EmpresaTela[]): void; encerrar(): void } {
  let geracao = 0;

  function montar(empresas: EmpresaTela[]) {
    const minha = ++geracao;
    raiz.replaceChildren();

    const cardLista = criar('div', 'card');
    const lista = criar('ul', 'artes-lista');
    const situacao = criar('div', 'artes-situacao');
    cardLista.append(criar('h2', undefined, 'Usuários'), lista, situacao);

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
              criar('span', 'artes-item-cnpj', descreverUsuario(usuario, empresas)),
            );
            item.append(texto);
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

    // Formulário de novo usuário.
    const { opcoes, fixa, marcadas } = empresasDoFormulario(empresas);
    const form = criar('form', 'artes-form');
    form.noValidate = true;
    const nome = criar('input');
    nome.type = 'text';
    nome.maxLength = 200;
    const email = criar('input');
    email.type = 'email';
    email.autocomplete = 'off';
    email.maxLength = 200;
    const perfil = criar('select');
    for (const p of PERFIS) perfil.append(new Option(ROTULOS_PERFIL[p], p));
    const grupoEmpresas = criar('div', 'artes-campo');
    const opcoesEmpresas = criar('div', 'artes-opcoes');
    opcoesEmpresas.setAttribute('role', 'group');
    opcoesEmpresas.setAttribute('aria-label', 'Empresas');
    grupoEmpresas.append(criar('label', undefined, 'Empresas'), opcoesEmpresas);
    const checks = opcoes.map((empresa) => {
      const rotulo = criar('label', 'check');
      const check = criar('input');
      check.type = 'checkbox';
      check.value = empresa.slug;
      check.checked = marcadas.includes(empresa.slug);
      check.disabled = fixa;
      rotulo.append(check, empresa.nome);
      opcoesEmpresas.append(rotulo);
      return check;
    });
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
    const mensagem = criar('div', 'hint');
    mensagem.setAttribute('role', 'status');
    const criarBotao = criar('button', 'primary', 'Criar usuário');
    criarBotao.type = 'submit';
    const acoes = criar('div', 'actions');
    acoes.append(criarBotao);
    form.append(
      campo('Nome', nome, 'usuario-nome'),
      campo('E-mail', email, 'usuario-email'),
      campo('Perfil', perfil, 'usuario-perfil'),
      grupoEmpresas,
      blocoSenha,
      mensagem,
      acoes,
    );

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mensagem.className = 'hint';
      mensagem.textContent = '';
      criarBotao.disabled = true;
      try {
        const criado = await api.criar({
          nome: nome.value,
          email: email.value,
          perfil: perfil.value as Perfil,
          empresas: checks.filter((c) => c.checked).map((c) => c.value),
          senha: senha.value,
        });
        if (minha !== geracao) return;
        mensagem.textContent = `Usuário ${criado.email} criado. Ele troca a senha no primeiro login.`;
        nome.value = '';
        email.value = '';
        senha.value = '';
        perfil.value = 'arte_finalista';
        if (!fixa) for (const c of checks) c.checked = false;
        void carregar();
      } catch (erro) {
        if (minha !== geracao) return;
        mensagem.className = 'hint warn';
        mensagem.textContent = mensagemErro(erro);
      } finally {
        criarBotao.disabled = false;
      }
    });

    const cardNovo = criar('div', 'card');
    cardNovo.append(criar('h2', undefined, 'Novo usuário'), form);
    const topo = criar('div', 'artes-topo');
    topo.append(botao('Atualizar lista', () => void carregar()));
    raiz.append(topo, cardLista, cardNovo);
    void carregar();
  }

  return {
    reiniciar: montar,
    encerrar() {
      geracao++;
      raiz.replaceChildren();
    },
  };
}

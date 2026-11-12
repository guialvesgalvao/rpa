# ADR 0011 — Permissões por módulo, definidas por empresa

- **Status:** aceito; item 7 complementado pela [ADR 0013](0013-redefinicao-e-troca-de-senha.md) (redefinir a senha também é de `usuarios.editar`)
- **Data:** 2026-11-11
- **Substitui em parte:** ADR 0003, itens 2 e 8 (perfil no token e `exigirPerfil`); ADR 0005, itens 1, 2 e 6 (rotas só de admin e editar/desativar só na CLI); ADR 0007, item 3 (alcance das tarefas por perfil)

## Contexto

O sistema estava em produção com dois perfis, `admin` e `arte_finalista`. Quem não era arte-finalista virava administrador e recebia acesso a tudo: Fatura, OP, Usuários, Configurações do Bling e todas as tarefas. O perfil ia no token de acesso (ADR 0003), então tirar um acesso só valia quando o token expirava (até 15 min). A tela de usuários só criava usuários (ADR 0005), e o alcance das tarefas de arte dependia do perfil (ADR 0007). O módulo Compras (ADR 0012) precisava de um terceiro tipo de acesso.

## Decisão

1. **Catálogo único** em `@plataforma/contratos` (`permissoes.ts`): cada módulo da aba lateral tem uma permissão, e dentro dela as subpermissões:
   - `artes` · `artes.adicionar` · `artes.editar` · `artes.acompanhar` (ver todas as tarefas e definir o responsável automático)
   - `faturas` · `ops`
   - `usuarios` · `usuarios.permissoes` · `usuarios.editar`
   - `compras` · `compras.pedir` · `compras.acompanhar`

   Uma subpermissão só vale com o módulo marcado (`temPermissao`, `normalizarPermissoes`).

2. **Regra para módulos novos:** todo módulo novo da aba lateral, no site e no app, nasce com uma permissão no catálogo. O painel de usuários a mostra sozinho, porque as caixas saem de `MODULOS` (`modulosDaEmpresa`). O menu do site (`ITENS_MENU`) e o do app (`AUTOMACOES`) declaram a permissão de cada aba. A API exige a permissão em cada rota do módulo. O CHECK de `usuario_empresas.permissoes` repete a lista e muda junto.
3. **Por empresa:** as permissões ficam em `usuario_empresas.permissoes` (`text[]`, migração `0017`). A mesma pessoa pode acompanhar as tarefas na ABA e só adicionar artes na Roma.
4. **Lidas do banco a cada requisição:** `exigirUsuario` lê as permissões na mesma consulta que já confere se o usuário está ativo. `exigirPermissao(chave)` usa a empresa da rota e responde 403 `permissao_proibida`; `exigirPermissaoEmAlgumaEmpresa(chave)` serve às rotas sem empresa. Tirar uma permissão vale na próxima requisição, sem esperar o token.
5. **Migração dos usuários atuais**, na própria `0017` (atômica, no pre-deploy): `arte_finalista` vira `artes` + `artes.adicionar`; `admin` vira o catálogo inteiro, em cada empresa do usuário. O backfill só preenche vínculos ainda sem permissões.
6. **Perfil derivado na transição:** a coluna `usuarios.perfil` fica no banco, sem uso, e não é gravada em usuário novo. O login, `GET /v1/eu` e o token continuam levando `perfil`, calculado por `perfilLegado`: `admin` para quem tem alguma permissão fora de Artes em alguma empresa, senão `arte_finalista`. Assim o app já instalado continua entrando. Nada decide acesso pelo perfil. As rotas antigas `GET`/`POST /v1/usuarios` continuam para esse app: o `POST` converte `perfil` em permissões (`PERMISSOES_DO_PERFIL`). A remoção fica para um plano futuro.
7. **Gestão de usuários pela tela**, em `/v1/empresas/:empresa/usuarios`:
   - `usuarios`: ver a lista;
   - `usuarios.editar`: criar, editar nome, e-mail, área e empresas, excluir e, pela ADR 0013, redefinir a senha;
   - `usuarios.permissoes`: marcar as permissões; sem ela, o usuário novo nasce sem permissões.

   Para editar os dados, redefinir a senha ou excluir um usuário de mais de uma empresa, é preciso ter `usuarios.editar` em todas elas. Quem gerencia só uma empresa ajusta só as permissões daquela.

8. **Exclusão é soft delete** (`usuarios.excluido_em`). Ela desliga o usuário, revoga as sessões (motivo `usuario_excluido`) e o tira da lista. O histórico mantém o nome, e o e-mail continua bloqueado para cadastro novo.
9. **Travas:** ninguém exclui a si mesmo (409 `proprio_usuario`) nem tira a própria `usuarios.permissoes` (`propria_permissao`). Toda empresa mantém ao menos um usuário ativo com `usuarios.permissoes` (409 `ultimo_administrador`).
10. **Área** (`arte_finalista`, `producao`, `administracao`, `direcao`) em `usuarios.area`. É só informativa e não muda acesso. Fica nula nos usuários anteriores; os formulários exigem a área, mas a API aceita vazio.
11. **Alcance das tarefas de arte:** `artes.acompanhar` vê todas as da empresa; sem ela, cada um vê só as de que é responsável. É elegível como responsável automático o usuário ativo com `artes.adicionar` e **sem** `artes.acompanhar` na empresa. Sem essa exclusão, todo ex-administrador ficaria elegível depois da migração.
12. **Configurações do Bling no app:** as credenciais são de quem tem `faturas` ou `ops`; a conexão e a sincronização, de quem tem `ops` na empresa com sincronização.

## Alternativas consideradas

| Alternativa                                                 | Por que não                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mais perfis fixos (ex.: `producao`, `compras`)              | Cada combinação nova pediria um perfil novo; o cliente quer marcar módulo por módulo.                                                          |
| Permissões globais do usuário (iguais em todas as empresas) | Uma pessoa pode ter papéis diferentes na ABA e na Roma; o vínculo `usuario_empresas` já era o lugar natural.                                   |
| Permissões no JWT                                           | Tirar um acesso esperaria até 15 min; `exigirUsuario` já consultava o banco a cada requisição, e ler as permissões na mesma consulta é barato. |
| Remover `perfil` de uma vez                                 | O app já instalado exige o campo em `/v1/eu` e desloga se ele faltar; a remoção espera todos estarem na versão nova.                           |
| Exclusão definitiva (apagar a linha)                        | Perderia o autor no histórico e liberaria o e-mail; o cliente quer o e-mail bloqueado.                                                         |
| Migrar os perfis por script fora da migração                | Haveria uma janela, entre o deploy e o script, em que ninguém teria permissão; dentro da `0017`, a troca é atômica com o pre-deploy.           |

## Consequências

- Tirar uma permissão ou excluir um usuário corta o acesso na hora, nas rotas protegidas. As empresas continuam vindo do token (ADR 0003), com até 15 min de atraso.
- O app antigo ainda mostra as abas pelo `perfil` derivado, e a API nega o que a pessoa não pode. Isso some com a versão nova do app.
- Um usuário criado pela API antiga durante a janela do deploy nasce sem permissões e precisa de ajuste pela tela.
- Os ex-administradores ficam com o catálogo inteiro. Quem não é administrador de fato perde o excesso só pela tela, ajustado pelo administrador oficial depois do deploy.
- No app, uma sessão salva antes das permissões é aceita com a lista vazia e se atualiza na próxima renovação. Se o app abrir offline com essa sessão, fica sem abas até reconectar.
- A CLI `usuarios` mantém `--perfil` como atalho que converte em permissões.

## Gatilho de revisão

- Todos os usuários na versão nova do app: executar o plano de remoção do `perfil` legado (coluna, campo na resposta e no token, rotas antigas `/v1/usuarios`, atalho `--perfil`).
- Pedido de permissão mais fina que módulo e subpermissão, por exemplo por cliente ou por status.
- Precisar de corte imediato de empresa: as empresas também passam a ser lidas do banco.

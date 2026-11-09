# ADR 0008 — Aplicativo e conta do Bling por empresa

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

A ADR 0004 liga cada empresa ao Bling por OAuth 2, com as credenciais do aplicativo (`BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI`) globais na API. Nada conferia qual conta do Bling autorizava a conexão: a conexão local da `roma` foi autorizada com o login da ABA, e a sincronização gravou na Roma clientes, produtos e tarefas da conta da ABA sem nenhum aviso. Os dados foram apagados à mão.

A Roma vai para produção agora (importação de clientes, produtos e pedidos em aberto); a ABA fica para depois. A NF-e da Roma está em produção, então os dados precisam vir da conta certa.

## Decisão

1. **Um aplicativo do Bling por empresa**, criado no Bling da própria empresa (Área do Integrador, visibilidade privada), com os escopos de leitura de Produtos, Contatos, Pedidos de Venda e dados da empresa.
2. **Só a Roma sincroniza hoje** (`EMPRESAS_SINCRONIZACAO_BLING = ['roma']`): as variáveis globais `BLING_*` recebem o aplicativo da Roma. Credenciais por empresa (`BLING_<SLUG>_CLIENT_ID`/`_SECRET`) não são implementadas agora.
3. **Verificação da conta antes de gravar a conexão:** no retorno do OAuth, a API lê `GET /empresas/me/dados-basicos` com o token recém-emitido e recusa, sem gravar nada, quando:
   - o CNPJ da conta difere do `BLING_<SLUG>_CNPJ` da empresa (hoje só `BLING_ROMA_CNPJ`; opcional, fora do grupo das quatro variáveis);
   - o CNPJ já está ligado à conexão de outra empresa;
   - o Bling responde `403`: o aplicativo não tem o escopo de dados da empresa, que passa a ser obrigatório.
4. **A conta fica registrada:** `bling_conexoes.conta_cnpj` (só dígitos) e `conta_nome`, gravados só na autorização (o refresh não muda a conta). O status da sincronização automática devolve a conta e o app mostra "Conectado a: <nome> (<CNPJ>)" nas Configurações.
5. **Mensagens sem dados da conta:** a página de retorno mostra o nome da conta só no sucesso; na recusa, diz apenas que a conta não é a da empresa e pede para entrar com a conta certa (de preferência numa janela anônima). CNPJ e tokens nunca vão para o log.

## Alternativas consideradas

| Alternativa                                        | Por que não                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Um aplicativo só para todas as empresas            | Não se sabe se o Bling permite autorizar um aplicativo privado a partir de outra conta; e a conta errada continuaria passando sem aviso. |
| Só mostrar o nome da conta conectada, sem bloquear | Depende de alguém notar; a sincronização grava dados da conta errada antes disso, e a automática repete a cada ciclo.                    |
| Credenciais por empresa já nesta entrega           | Só a Roma sincroniza: seria configuração e código sem uso até a ABA entrar.                                                              |

## Consequências

- O aplicativo do Bling precisa do escopo de dados da empresa. Editar os escopos depois revoga as autorizações, então os escopos são fechados antes da primeira autorização.
- Conexões anteriores à migração `0014` ficam sem conta (o app mostra "Conta do Bling não identificada") até serem autorizadas de novo. Produção não tinha nenhuma.
- Sem `BLING_ROMA_CNPJ`, a única proteção é o CNPJ único entre empresas: a primeira conta autorizada vale.
- Com as credenciais globais, a ABA não pode ser ligada à sincronização sem antes separar as credenciais por empresa.

## Gatilho de revisão

- A ABA (ou outra empresa) entrar em `EMPRESAS_SINCRONIZACAO_BLING`: credenciais por empresa (`BLING_<SLUG>_CLIENT_ID`/`_SECRET`, e o redirect se precisar) e `BLING_<SLUG>_CNPJ` para cada uma.
- O Bling mudar o formato ou o escopo de `GET /empresas/me/dados-basicos`.

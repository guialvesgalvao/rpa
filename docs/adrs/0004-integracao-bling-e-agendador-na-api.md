# ADR 0004 — Integração com o Bling e sincronização agendada na API

- **Status:** aceito
- **Data:** 2026-11-05

## Contexto

Clientes e produtos da Roma vêm do Bling (API v3, OAuth 2). Antes, o botão "Sincronizar dados" gravava um JSON local, fora do banco único (ADR 0001), e só atualizava quando alguém clicava. A API roda com 1 réplica no Railway (ADR 0002, ADR 0003) e é a única dona das regras.

## Decisão

1. **Conexão por empresa:** OAuth 2 do Bling na API; tokens cifrados com AES-256-GCM (`BLING_CHAVE_TOKENS`) em `bling_conexoes`. Só leitura: nenhuma chamada além de `GET`, fora o `/oauth/token`.
2. **Gravação nas tabelas atuais** (`clientes`, `produtos`), numa transação:
   - `id_bling` único por empresa; um cadastro manual sem vínculo é adotado pelo CNPJ ou pelo `codigo`;
   - o Bling é a fonte da verdade dos campos sincronizados;
   - registros inválidos ou repetidos (CNPJ, `codigo`, nome de produto) ficam de fora, com aviso agregado; num duplicado, fica o vínculo existente;
   - inativo ou excluído no Bling recebe `inativo_no_bling_em`: some das listas, mas fica no banco com as artes.
3. **Dois modos:** completa (lê tudo e marca os ausentes) e incremental (só o incluído ou alterado desde o início do último ciclo bem-sucedido, com 10 min de margem, em horário de Brasília).
4. **Agendador dentro da API**, sem serviço extra: ligado por `BLING_SINCRONIZACAO_AUTOMATICA`; incremental a cada `BLING_INTERVALO_MINUTOS` (contados do fim do ciclo anterior); completa a cada `BLING_COMPLETA_DIAS`. O botão sempre faz uma completa, pelo mesmo job (nunca dois por empresa).
5. **Estado em `bling_sincronizacoes`:** janela do incremental, última completa, último resultado e um lease (`em_execucao_desde`, validade de 1 h) contra ciclos duplicados.
6. **Visibilidade:** log da API só com contagens e códigos; status no app (Configurações, admin) via `GET …/bling/sincronizacao/automatica`.

## Alternativas consideradas

| Alternativa                               | Por que não                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Serviço/cron separado no Railway          | Mais um deploy e mais variáveis para um trabalho leve; com 1 réplica, o timer na API basta e o lease cobre o caso de duas. |
| Webhooks do Bling                         | Exigem endpoint público e tratamento de entrega/reenvio; a completa periódica ainda seria necessária para exclusões.       |
| Manter o JSON local                       | Fora do banco único (ADR 0001); as artes não se ligam aos registros do Bling.                                              |
| Tabelas separadas para o espelho do Bling | Duplicaria clientes e produtos; a adoção liga os cadastros manuais sem perder as artes.                                    |
| Só completa, sem incremental              | ~490 chamadas por ciclo; o incremental faz poucas chamadas e mantém o intervalo curto.                                     |

## Consequências

- O incremental não vê inativação de produto, troca de tipo de contato nem exclusões: a completa corrige em até `BLING_COMPLETA_DIAS`.
- Edições manuais nos campos sincronizados são sobrescritas.
- Clientes sem CNPJ válido (pessoa física) não entram no banco.
- Um contato recriado no Bling com o mesmo CNPJ fica de fora como duplicado; a linha antiga recebe a marca de inativo.
- A conexão expirada não se renova sozinha: o status mostra `nao_conectado` e o admin autoriza de novo pelo app.
- O job do botão guarda o andamento em memória; o deploy aborta o job em curso sem gravar resultado.

## Gatilho de revisão

- Mais de 1 réplica da API: o estado do job do botão precisa sair da memória.
- O Bling passar a oferecer webhooks confiáveis ou a cota diária apertar.
- Outra empresa além da Roma, ou aceitar CPF em `Cliente`.
- As hipóteses do incremental (fuso, inclusão × alteração) se mostrarem falsas.

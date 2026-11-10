# ADR 0010 — Testes E2E locais nos planos e na execução

- **Status:** aceito
- **Data:** 2026-11-10

## Contexto

Os planos terminavam com várias tarefas manuais do usuário, e boa parte delas era fluxo funcional local, que não depende do Bling nem do Railway: busca de clientes, cadastro de arte, Ultra, "Nova cor", observação da OP com `RPA_OP_MOCK=1`, perfis e sessão offline. Esses fluxos ficaram manuais porque o repositório não tinha E2E. O plano de 2026-10-23 dizia "Não há E2E no repositório, e não configurar", e os planos seguintes repetiram "manual (sem E2E no repositório)" como justificativa.

Agora existe uma suíte E2E local (`npm run e2e`, pasta `e2e/`) com Playwright para o site e o app Electron. Ela sobe Postgres, API e site em portas próprias, recria o banco `rpa_e2e` com dados fictícios e abre o app numa pasta de dados temporária.

## Decisão

1. **Todo plano avalia E2E local** para cada mudança com efeito em tela ou em fluxo local (site, app, API vista pela tela). Se fizer sentido, criar ou ajustar os specs em `e2e/` entra nas próprias tasks de código. Quando não fizer, o plano diz por quê.
2. **A suíte inteira roda numa task de agente** depois de todas as tasks autônomas do plano e antes das tasks manuais (`npm run e2e`, junto com typecheck, lint, prettier e os testes unitários). Falha bloqueia a passagem para as tasks manuais. O agente corrige o código ou o spec e roda de novo.
3. **Tasks manuais ficam sempre por último** e só cobrem o que um agente não pode validar:
   - Bling real, com autorização e número do pedido a cada execução;
   - Railway e produção;
   - aceite visual ou de negócio.
     Fluxos simples são validados por agentes, não pelo usuário.
4. **A E2E nunca usa o Bling, credenciais reais nem dados reais:**
   - banco `rpa_e2e` (o preparo recusa outro nome e host não local);
   - seed fictício do `semear` mais os usuários da suíte;
   - API sem as variáveis `BLING_*` e `ARQUIVOS_S3_*`;
   - app com `RPA_OP_MOCK=1`, `RPA_DATA_DIR` temporária, `RPA_API_URL` local e sem o `.env` da raiz.
     A suíte não clica em Fatura → Gerar, em "Sincronizar dados" nem salva usuário e senha do Bling.
5. **A suíte é local e serial** (`workers: 1`): os cenários compartilham o banco e o app abre uma janela por vez. Ela não roda no CI por enquanto.

Supera a orientação "não configurar E2E" do plano de 2026-10-23.

## Alternativas consideradas

| Alternativa                           | Por que não                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Continuar com validação manual        | O usuário repetia a cada plano conferências que um agente faz sozinho e com repetição exata.           |
| E2E só sob demanda, fora dos planos   | Sem regra nos planos, a suíte para de ser atualizada e volta a frase "sem E2E".                        |
| Rodar a suíte em cada task            | Mais lento; os specs afetados já entram na verificação da task, e a suíte inteira roda uma vez no fim. |
| E2E contra o Bling de homologação     | Exige credenciais e autorização a cada execução (`AGENTS.md`) e muda o estado dos pedidos de teste.    |
| Usar o banco `rpa` de desenvolvimento | Os cenários apagariam ou poluiriam os dados de quem desenvolve; `rpa_teste` é recriado pelo vitest.    |

## Consequências

- O agente consegue fechar sozinho a validação de fluxos de tela; as tasks manuais encolhem ao que depende de pessoa, Bling ou produção.
- Os specs precisam acompanhar as mudanças de tela. Os seletores usam rótulos e papéis em pt-BR; mudar um texto visível pode quebrar um spec.
- `npm run e2e` precisa de Docker, das dependências da `plataforma/` (`npm --prefix plataforma ci`) e do Chromium do Playwright (`npm run browsers:install`).
- A suíte usa as portas 3100 (site) e 3101 (API) e a pasta `.next-e2e` do site. O site e o app de desenvolvimento podem continuar abertos.
- A geração de OP na E2E reserva números de OP só no banco `rpa_e2e`.

## Gatilho de revisão

- A suíte passar de ~10 minutos ou ficar instável com frequência.
- Decisão de rodar a suíte no CI (GitHub Actions com Postgres como serviço).
- Surgir um ambiente de testes do Bling que dispense autorização a cada execução.

# Integração app da hamburgueria → ZIA (análise do código do ZIA v2.57.0)

Análise feita lendo `natanaelsantos478/ZIA-NOVO` (commit 7463d46). Cada afirmação aponta o arquivo/função.

## 1. Como uma venda "existe" no ZIA

| Caminho | O que acontece | Serve para venda já concluída no balcão/app? |
|---|---|---|
| `erp_pdv_registrar_venda` (migr. 13) | Exige **sessão de caixa ABERTA**; ao FINALIZAR dispara financeiro e **saída de estoque** `VENDA_PDV` | Não: exige caixa aberto no ZIA e estoque no ZIA; não tem canal (iFood) |
| Pedido `CONFIRMADO` (padrão do `lojaImportar`) | **Reserva estoque** (`VEN_RESERVA_ESTOQUE`, migr. 44), entra no **fluxo de caixa previsto** (`fin_fluxo_pedidos`, migr. 52) e na **demanda do MRP** (`pcp_mrp`, migr. 68) | **Não**: venda já paga ficaria eternamente como "a receber/a produzir" |
| Pedido `FATURADO` (`ven_faturar` / motor) | Saída de estoque, títulos, título do canal pelo líquido com repasse (`fn_titulo_canal`, migr. 69) e **documento fiscal** | Sim, é o único estado "verdadeiro", mas com os bloqueios abaixo |

Resultado por canal (`ven_canal_resultado`) lê **títulos**, que só nascem no faturamento.

## 2. Bloqueios para faturar vendas da hamburgueria

1. **Fiscal:** `fis_documentar_pedido` (migr. 58) gera **NF-e modelo 55** para toda venda faturada, sem exceção para MEI
   nem para consumidor final. Não existe geração de NFC-e (65). Falha "não bloqueia", mas cria documento PENDENTE e
   `fis_apuracao_fechar` exige zero pendentes. Para MEI vendendo a pessoa física, a nota normalmente é dispensada
   (confirmar com o contador): falta uma regra por empresa.
2. **Estoque:** a guarda do kardex (migr. 13) recusa saída sem saldo, a menos que `EST_PERMITE_NEGATIVO` esteja ligado na
   empresa. O estoque e o custo da hamburgueria vivem no app, então o ZIA ficaria negativo ou exigiria duplicar as compras.
   Só `tipo_produto='SV'` (serviço) e assinatura pulam estoque (migr. 58, bloco "Serviço não movimenta estoque"), e SV
   vira NFS-e/ISS, o que é errado para lanche. Falta uma flag de produto "não controla estoque" (mesmo padrão de skip).
3. **Produto:** `fn_produto_fiscal` exige **NCM de 8 dígitos existente em `fis_ncm`**. Código `codigo_interno` é único por
   empresa (migr. 02). Os lanches precisam ser cadastrados no ZIA com o mesmo código do app.
4. **CMV:** sem movimento de estoque no ZIA, o custo da venda lá é zero (DRE/contabilidade sem CMV). O custo real está no app
   (`venda_itens.custo_unitario`).

## 3. Pontos do ZIA reaproveitáveis

- `zia-integracoes` → `lojaImportar` / `buscarPedidosLoja` (Nuvemshop/WooCommerce): credencial write-only em
  `zia_integracoes` (provedor é texto livre), idempotência por `(tenant_id, origem_externa, id_externo)` (migr. 04),
  tela ERP → Integração Loja. **Bom molde** para um provedor "hamburgueria".
- `ven_canais` com `cliente_id` intermediador (iFood): título a receber do iFood pelo líquido, com data de repasse, e
  `ven_canal_repasse` para baixar em lote. **Isso o app não faz** e é o maior ganho real da integração.

## 4. Problemas do ZIA encontrados durante a análise (valem para qualquer cliente)

- `lojaImportar`: pedido sem CPF/e-mail **cria um cliente novo a cada pedido**; pedidos **cancelados** na loja são
  ignorados (um já importado continua valendo); importa como CONFIRMADO (efeitos da seção 1).
- `ia-api-gateway`: `MODULE_TABLES` aponta para **13 tabelas que não existem** no schema atual (`fin_contas_pagar`,
  `fin_contas_receber`, `fin_transacoes`, `fin_caixa`, `erp_orcamentos`, `erp_notas_fiscais`, `scm_estoque`,
  `scm_pedidos_compra`, `scm_fornecedores`, `hr_employees`, `hr_payroll`, `eam_assets`, `crm_clientes`), usa
  service_role (ignora RLS) e não tem `erp_pedidos_itens`. Não serve para integração de pedidos.
- Fiscal sem NFC-e e sem dispensa para MEI → afeta todo cliente de alimentação/varejo.
- Agendamentos via pg_cron + pg_net já derrubaram o projeto (queda de 26/09 a 02/10, CLAUDE.md). Sincronização
  automática precisa ser leve, com histórico limpo.

## 5. Desenho recomendado

**Dono de cada coisa:** app = operação (venda, estoque, custo, compras). ZIA = gestão comercial e financeira
(vendas por canal, recebíveis e repasse do iFood, relatórios).

**Mudanças no ZIA (fase 1, só vendas):**
1. `erp_produtos.controla_estoque boolean default true`; quando false, pular estoque nos mesmos 6 motores do skip de SV
   (`ven_faturar`, `ven_devolver`, `fn_erp_pedido_efeitos`, `fn_erp_caixa_venda_efeitos`, `fn_erp_caixa_item_estoque`,
   `com_recebimento_efetivar`).
2. Parâmetro por empresa `FIS_DOC_VENDA_CONSUMIDOR` (`NFE` | `NFCE` | `NENHUM`); para `regime_tributario='MEI'` e cliente
   PF/sem documento, padrão `NENHUM`. `fis_documentar_pedido` respeita.
3. Cliente fixo "Consumidor final" por empresa para vendas sem documento.
4. RPC `ven_importar_venda_externa(tenant, origem, id_externo, jsonb)` (INVOKER, idempotente): cria pedido com canal,
   itens, desconto e entrega, **fatura na mesma transação**, baixa à vista na conta quando o canal não é intermediador
   (iFood fica a receber pelo repasse). Cancelamento: `ven_cancelar_venda_externa(origem, id_externo)` estorna.
   O custo de cada item pode ir num campo `custo_externo` do item para relatórios de margem (opcional).
5. Provedor `hamburgueria` em `buscarPedidosLoja`, que lê do app via `exportar_vendas(desde)` (contrato estável) logado
   com usuário técnico somente leitura, e chama a RPC do item 4. Manual pelo botão; automático depois, com cuidado (seção 4).

**Mudanças no app (fase 1):**
- `produtos.codigo` (= `codigo_interno` do ZIA).
- Papel `leitura` em `membros` com RLS que impede gravação.
- RPC `exportar_vendas(desde timestamptz)` → número, data, canal, status (inclui canceladas), itens (código, qtd, preço,
  custo), desconto, entrega, taxa do canal, líquido.

**Decisão a tomar:** se o ZIA passar a controlar os recebíveis/repasses, as receitas e as contas a pagar devem ficar **em um
lugar só**. Na fase 1 o app continua com o financeiro do dia a dia e o ZIA fica com o comercial e os recebíveis do iFood.

# Hamburgueria — app de controle

App Android (instalado direto, sem Play Store) para controlar a hamburgueria: vendas, estoque, cardápio com ficha técnica, compras, contas a pagar e resultado do mês. Importa e exporta planilhas `.xlsx`.

- **App:** React 19 + TypeScript + Vite + Tailwind v4, empacotado com Capacitor 7 (Android).
- **Banco:** Supabase próprio da hamburgueria (projeto `nmkvjwfpqawiwqmxlywl`, região São Paulo). Não é o banco do ZIA.
- **Regra de negócio fica no banco** (funções SQL). App, planilhas e Claude usam as mesmas funções. Por isso o resultado é igual por qualquer caminho.

## Telas

| Tela | Para quê |
|---|---|
| Início | Resultado do período (vendido − taxas − ingredientes − despesas), alertas de contas vencidas e estoque baixo, investimento × retorno, caixa |
| Vender | Toca nos lanches, escolhe o canal (Balcão, WhatsApp, iFood…), registra. Mostra a sobra da venda já descontada a taxa do app |
| Estoque | Saldo e custo médio de cada insumo; contagem, perda, entrada manual; compras com frete, desconto e parcelas |
| Cardápio | Produto + ficha técnica → custo, sobra por canal, preço sugerido pela margem desejada |
| Dinheiro | A pagar (vencidas / 30 dias / depois), extrato do mês, saldos; lançamentos com repetição mensal |
| Ajustes | Exportar tudo, importar planilhas (com prévia e erro por linha), canais e taxas, categorias, contas, senha |

## Modelo de dados (`supabase/migrations/`)

| Tabela | Conteúdo |
|---|---|
| `membros` | Quem pode usar (user_id do Supabase Auth). Fora daqui = não vê nada |
| `insumos` | Matéria-prima e embalagem. `estoque_atual` e `custo_medio` são **calculados pelo banco** |
| `movimentos` | Kardex: entrada/saída por compra, venda, ajuste, perda, contagem, inicial |
| `produtos` + `ficha_tecnica` | Cardápio e quanto de cada insumo vai em 1 unidade |
| `canais` | Onde vende e taxa % + fixa (iFood Entrega = 23% + 3,2% = 26,2%) |
| `compras` + `compra_itens` | Item com `insumo_id` entra no estoque; com `categoria_id` vai para a categoria |
| `vendas` + `venda_itens` | Total, taxa do canal, líquido, custo (CMV) congelados no momento da venda |
| `lancamentos` | Contas a pagar/receber. Os de compra/venda são gerados pelo banco e protegidos |
| `categorias` | `receita`, `despesa` (entra no resultado), `estoque` (vira CMV quando vende), `investimento` (abertura/equipamento) |
| `contas` | `empresa` (caixa) ou `dono` (dinheiro do bolso = aporte) |

### Funções (use sempre estas, nunca INSERT direto em vendas/compras/movimentos)

| Função | O que faz |
|---|---|
| `registrar_venda(p jsonb)` | `{canal_id, conta_id?, cliente?, desconto?, taxa_entrega?, data?, itens:[{produto_id, quantidade, preco_unitario?}]}` → baixa estoque pela ficha, calcula taxa, lança receita líquida |
| `cancelar_venda(id)` | Devolve estoque e tira a receita |
| `registrar_compra(p jsonb)` | `{id? (edita), data, fornecedor, conta_id, frete, desconto, parcelas, primeiro_vencimento?, pago?, itens:[{insumo_id? \| categoria_id?, descricao, quantidade, valor_total}]}` → estoque com frete/desconto rateados + parcelas |
| `excluir_compra(id)` | Tira do estoque e apaga as parcelas |
| `ajustar_estoque(insumo, 'entrada'\|'saida', qtd, 'ajuste'\|'perda'\|'inicial', custo?, obs?)` | Ajuste manual |
| `contar_estoque(insumo, qtd_contada)` | Lança a diferença da contagem física |
| `painel(inicio, fim)` | JSON com vendas, CMV, lucro, despesas, resultado, caixa, a pagar, investimento, aporte do bolso, retorno %, estoque baixo, mais vendidos, por canal |
| `v_produtos_custo`, `v_saldos_contas` | Visões de custo por produto e saldo por conta |

### Segurança
- RLS em todas as tabelas: só `membros` leem/gravam. `anon` não tem acesso a nada.
- Saldo/custo do insumo só mudam pelo banco (grant por coluna). Movimentos só por função.
- Lançamento de compra/venda: o app só pode mudar data de pagamento e conta (gatilho `lancamentos_guarda`).
- A chave `sb_publishable_…` em `.env.production` é pública por natureza (vai dentro do APK). **A chave secreta nunca entra no código.**

## Desenvolvimento

```bash
npm install
npx supabase start            # Supabase local (Docker)
./testar-banco.sh             # recria o banco local e roda supabase/tests/fluxos.sql (deve dar TESTES_OK)
npm test                      # testes de leitura de planilha/números
npm run dev                   # app em http://localhost:5173 (usa .env.development.local → Supabase local)
node tests/e2e.mjs            # 14 fluxos no navegador (login, compra, ficha, venda, DAS, exportar, importar, cancelar)
```

`.env.development.local` (não versionado):
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_KEY=<ANON_KEY do `npx supabase status`>
```

## Gerar o APK

Precisa de JDK 21 e Android SDK (platform 35, build-tools 35).

```bash
npx vite build && npx cap sync android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

A assinatura usa `chave/hamburgueria.jks` + `chave/assinatura.properties` (**fora do Git**, guardados pelo dono). Atualizações precisam da mesma chave para instalar por cima. A cada versão, suba `versionCode` em `android/app/build.gradle`.

## Mudanças no banco

1. Nova migration em `supabase/migrations/` (nunca editar a já aplicada na nuvem).
2. `./testar-banco.sh` + `node tests/e2e.mjs` precisam passar.
3. Aplicar na nuvem pelo SQL Editor do Supabase.

## Claude com acesso aos dados (MCP)

Num chat do Claude com o conector **Supabase** ligado, o Claude consegue consultar e lançar dados neste projeto (`nmkvjwfpqawiwqmxlywl`). Regras para ele:
- Para ler o resumo, use `select public.painel('AAAA-MM-01','AAAA-MM-31')`. Ela exige membro: rode antes `set local role authenticated; set local request.jwt.claims = '{"sub":"<user_id do dono>"}'`, ou consulte as tabelas direto.
- Para lançar venda, compra ou ajuste, use **as funções acima** (nunca INSERT direto em `vendas`, `compras` ou `movimentos`).
- O conector também enxerga outros projetos da conta (ex.: ZIA). Confira sempre o project id antes de executar.

## Integração com o ZIA (futuro)

Os bancos são separados de propósito: o ZIA usa auth própria (JWT custom, multi-tenant) e este app usa o Supabase Auth nativo, com um dono só. Se for integrar:
- Faça **sincronização por API** (ex.: Edge Function no ZIA que lê `painel()`/vendas daqui com um usuário técnico em `membros`), em vez de juntar os bancos.
- Nunca coloque chave secreta do ZIA dentro deste APK nem a chave secreta daqui dentro do ZIA no front.

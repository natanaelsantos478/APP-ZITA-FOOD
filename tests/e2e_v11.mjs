// E2E da v1.1 no navegador (tela de celular) contra o Supabase local.
// Uso: ./testar-banco.sh && node tests/e2e_v11.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = 'tests/telas';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const erros = [];
page.on('pageerror', e => erros.push(String(e)));
page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) erros.push(`HTTP ${r.status()} ${r.url()}`); });

let passo = 0;
const ok = m => console.log(`✓ ${++passo}. ${m}`);
const foto = n => page.screenshot({ path: path.join(OUT, `v11-${n}.png`) });
const dlg = n => page.getByRole('dialog', { name: n });
const nav = n => page.getByRole('navigation').getByRole('button', { name: n });
const aviso = t => page.getByRole('status').filter({ hasText: t }).first().waitFor({ timeout: 10000 });

try {
  await page.goto(URL);
  await page.getByLabel('E-mail').fill('dono@teste.local');
  await page.getByLabel('Senha').fill('senha-teste-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Início', level: 1 }).waitFor();

  // 1. taxa do crédito em Ajustes
  await page.getByRole('button', { name: 'Ajustes, planilhas e backup' }).click();
  await page.getByRole('button', { name: /^Cartão de crédito/ }).click();
  let d = dlg('Forma de pagamento');
  await d.getByLabel('Taxa (%)').fill('3,1');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await aviso('Forma de pagamento salva');
  await page.getByRole('button', { name: /Cartão de crédito\s*3,1% · 30d/ }).waitFor();
  ok('forma de pagamento editada (crédito 3,1%, 30 dias)');
  await page.getByRole('button', { name: 'Voltar ao Início' }).click();

  // 2. insumos + compra
  await nav('Estoque').click();
  for (const [nome, un] of [['Carne', 'kg'], ['Pão', 'un']]) {
    await page.getByRole('button', { name: 'Novo insumo' }).click();
    d = dlg('Novo insumo');
    await d.getByLabel('Nome').fill(nome); await d.getByLabel('Unidade').fill(un);
    await d.getByRole('button', { name: 'Cadastrar insumo' }).click();
    await aviso('Insumo cadastrado');
  }
  await page.getByRole('radio', { name: 'Compras', exact: true }).click();
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  d = dlg('Registrar compra');
  await d.getByLabel('Insumo').first().selectOption({ label: 'Carne (kg)' });
  await d.getByLabel('Quantidade (kg)').fill('2'); await d.getByLabel('Valor pago (R$)').first().fill('70');
  await d.getByRole('button', { name: 'Adicionar item' }).click();
  await d.getByLabel('Insumo').nth(1).selectOption({ label: 'Pão (un)' });
  await d.getByLabel('Quantidade (un)').fill('12'); await d.getByLabel('Valor pago (R$)').nth(1).fill('36');
  await d.getByLabel('Pago com').selectOption({ label: 'Do meu bolso' });
  await d.getByRole('button', { name: 'Registrar compra' }).click();
  await aviso('Compra registrada');
  ok('compra de carne e pão');

  // 3. pré-preparo: Blend rende 6 com 1 kg de carne
  await page.getByRole('radio', { name: 'O que tenho' }).click();
  await page.getByRole('button', { name: 'Novo insumo' }).click();
  d = dlg('Novo insumo');
  await d.getByLabel('Nome').fill('Blend 160g');
  await d.getByLabel('É um pré-preparo').check();
  await d.getByLabel('A receita abaixo rende quantos un?').fill('6');
  await d.getByRole('button', { name: 'Adicionar ingrediente' }).click();
  await d.getByLabel('Ingrediente 1 da receita').selectOption({ label: 'Carne (kg)' });
  await d.getByLabel('Quantidade do ingrediente 1').fill('1');
  await d.getByText('R$ 5,83').waitFor();
  await foto('01-preparo');
  await d.getByRole('button', { name: 'Cadastrar insumo' }).click();
  await aviso('Insumo cadastrado');
  await page.getByRole('button', { name: /Blend 160g/ }).click();
  d = dlg('Blend 160g');
  await d.getByRole('button', { name: 'Produzi' }).click();
  await d.getByLabel('Quanto produziu (un)?').fill('6');
  await d.getByText(/Usa 1 kg de Carne/).waitFor();
  await d.getByRole('button', { name: 'Confirmar' }).click();
  await aviso('Produzido: 6 un');
  await page.getByRole('button', { name: /Blend 160g.*6\s*un/ }).waitFor();
  await page.getByRole('button', { name: /^Carne.*1\s*kg/ }).waitFor();
  ok('pré-preparo produzido: 6 blends a R$ 5,83, carne baixou para 1 kg');

  // 4. cardápio com blend + código
  await nav('Cardápio').click();
  await page.getByRole('button', { name: 'Novo' }).click();
  d = dlg('Novo produto');
  await d.getByLabel('Nome').fill('Burger');
  await d.getByLabel('Preço de venda (R$)').fill('40');
  await d.getByLabel('Código (opcional)').fill('brg-01');
  await d.getByLabel('Insumo da linha 1').selectOption({ label: 'Blend 160g' });
  await d.getByLabel('Quantidade da linha 1').fill('1');
  await d.getByRole('button', { name: 'Adicionar insumo' }).click();
  await d.getByLabel('Insumo da linha 2').selectOption({ label: 'Pão' });
  await d.getByLabel('Quantidade da linha 2').fill('1');
  await d.getByText('R$ 8,83').first().waitFor();
  await d.getByRole('button', { name: 'Cadastrar produto' }).click();
  await aviso('Produto cadastrado');
  ok('produto com blend na ficha (custo R$ 8,83) e código BRG-01');

  // 5. venda em dinheiro com entregador
  await nav('Vender').click();
  await page.getByRole('button', { name: 'Adicionar Burger' }).click();
  await page.getByRole('button', { name: 'Adicionar Burger' }).click();
  await page.getByRole('button', { name: /2 itens/ }).click();
  await page.getByRole('radio', { name: 'Dinheiro', exact: true }).click();
  await page.getByLabel('Taxa de entrega (R$)').fill('5');
  await page.getByLabel('Paguei ao entregador (R$)').fill('8');
  const dinheiroMarcado = await page.getByRole('radio', { name: 'Dinheiro', exact: true }).getAttribute('aria-checked');
  if (dinheiroMarcado !== 'true') throw new Error('Balcão não abriu em Dinheiro');
  await page.getByText('R$ 59,34').waitFor();        // 85 − 8 − 2 × 8,83
  await foto('02-comanda-forma');
  await page.getByRole('button', { name: 'Registrar venda' }).click();
  await aviso('Venda registrada: R$ 85,00');
  ok('Balcão abre em Dinheiro; venda com entregador (sobra estimada R$ 59,34)');

  // 6. venda no crédito: taxa e prazo
  await page.getByRole('button', { name: 'Adicionar Burger' }).click();
  await page.getByRole('radio', { name: 'Cartão de crédito' }).click();
  await page.getByText('Cai na conta em 30 dias').waitFor();
  await page.getByRole('button', { name: /1 item/ }).click();
  await page.getByText('R$ 1,24').waitFor();
  await page.getByRole('button', { name: 'Registrar venda' }).click();
  await aviso('Venda registrada: R$ 40,00');
  ok('venda no crédito: taxa R$ 1,24 e recebe em 30 dias');

  // 7. iFood escolhe sozinho "Pago no app"
  await page.getByRole('radio', { name: 'iFood' }).click();
  await page.getByRole('button', { name: 'Adicionar Burger' }).click();
  const radioApp = page.getByRole('radio', { name: 'Pago no app (iFood)' });
  if ((await radioApp.getAttribute('aria-checked')) !== 'true') throw new Error('iFood não marcou a forma padrão');
  await page.getByRole('button', { name: 'Registrar venda' }).click();
  await aviso('Venda registrada: R$ 40,00');
  ok('iFood marcou "Pago no app" sozinho');

  // 8. fechamento do dia e gaveta
  await page.getByRole('button', { name: 'Vendas', exact: true }).click();
  d = dlg('Vendas do dia');
  await d.getByText('Fechamento do dia').waitFor();
  await d.getByText('R$ 77,00').waitFor();           // 85 em dinheiro − 8 do entregador
  await d.getByLabel('Valor contado na gaveta').fill('70');
  await d.getByText('Faltam R$ 7,00').waitFor();
  await foto('03-fechamento');
  await d.getByRole('button', { name: 'Lançar a diferença no caixa' }).click();
  await aviso('Diferença da gaveta lançada');
  await d.getByLabel('Valor contado na gaveta').fill('70');
  await d.getByText('Gaveta certinha.').waitFor();
  ok('fechamento: gaveta esperada R$ 77, faltaram R$ 7, lançado e conferido');
  await page.keyboard.press('Escape');

  // 9. a receber + receber o crédito
  await nav('Dinheiro').click();
  await page.getByRole('radio', { name: 'A receber' }).click();
  await page.getByText('R$ 68,28').waitFor();        // 38,76 + 29,52
  await foto('04-a-receber');
  await page.getByText(/Cartão de crédito/).first().click();
  d = dlg('Pagamento');
  await d.getByLabel('Já recebi').check().catch(async () => { await d.getByLabel('Já paguei').check(); });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await aviso('Recebimento registrado');
  await page.getByText('R$ 29,52').first().waitFor();
  ok('A receber mostra R$ 68,28; crédito recebido, sobra o iFood (R$ 29,52)');

  // 10. lista de compras → compra preenchida
  await nav('Estoque').click();
  await page.getByRole('radio', { name: 'Lista de compras' }).click();
  await page.getByText('Carne', { exact: true }).waitFor();
  await foto('05-lista-compras');
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  d = dlg('Registrar compra');
  const sel = await d.getByLabel('Insumo').first().inputValue();
  if (!sel) throw new Error('Compra não veio preenchida pela lista');
  ok('lista de compras sugere carne e abre a compra já preenchida');
  await page.keyboard.press('Escape');

  // 11. início mostra a receber
  await nav('Início').click();
  await page.getByText('A receber (iFood, cartão…)').waitFor();
  await foto('06-inicio');
  ok('Início mostra o valor a receber');

  const relevantes = erros.filter(e => !/favicon/.test(e));
  if (relevantes.length) throw new Error('Erros:\n' + relevantes.join('\n'));
  ok('nenhum erro no console nem HTTP');
  console.log('E2E_V11_OK');
} catch (e) {
  await foto('ERRO');
  console.error('✗ FALHOU no passo', passo + 1, '\n', e.message);
  if (erros.length) console.error(erros.join('\n'));
  process.exitCode = 1;
} finally {
  await b.close();
}

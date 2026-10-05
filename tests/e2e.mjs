// Teste de ponta a ponta no navegador (tela de celular) contra o Supabase local.
// Uso: ./testar-banco.sh && node tests/e2e.mjs   (app em http://localhost:5173)
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
XLSX.set_fs(fs);

const URL = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tests/telas';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await ctx.newPage();
const errosConsole = [];
page.on('console', m => { if (m.type() === 'error') errosConsole.push(m.text()); });
page.on('pageerror', e => errosConsole.push(String(e)));
page.on('response', r => { if (r.status() >= 400) errosConsole.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });

let passo = 0;
const ok = msg => console.log(`✓ ${++passo}. ${msg}`);
const foto = async nome => page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: false });
const dialogo = nome => page.getByRole('dialog', { name: nome });
const nav = nome => page.getByRole('navigation').getByRole('button', { name: nome });
const aviso = async texto => { await page.getByRole('status').filter({ hasText: texto }).first().waitFor({ timeout: 10000 }); };

try {
  // 1. Login com senha errada e certa
  await page.goto(URL);
  await page.getByLabel('E-mail').fill('dono@teste.local');
  await page.getByLabel('Senha').fill('errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' }).waitFor();
  errosConsole.length = 0; // o 400 da senha errada é esperado
  await foto('01-login');
  await page.getByLabel('Senha').fill('senha-teste-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Início', level: 1 }).waitFor();
  ok('login (senha errada recusada, certa aceita)');
  await foto('02-inicio-vazio');

  // 2. Cadastrar insumo
  await nav('Estoque').click();
  await page.getByRole('button', { name: 'Novo insumo' }).click();
  let d = dialogo('Novo insumo');
  await d.getByLabel('Nome').fill('Carne moída');
  await d.getByLabel('Unidade').fill('kg');
  await d.getByLabel('Avisar quando ficar abaixo de').fill('0,5');
  await d.getByRole('button', { name: 'Cadastrar insumo' }).click();
  await aviso('Insumo cadastrado');
  ok('insumo cadastrado');

  // 3. Registrar compra com 2 itens (um insumo novo criado dentro da compra)
  await page.getByRole('radio', { name: 'Compras' }).click();
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  d = dialogo('Registrar compra');
  await d.getByLabel('Onde comprou').fill('Costa Atacadão');
  await d.getByLabel('Insumo').first().selectOption({ label: 'Carne moída (kg)' });
  await d.getByLabel('Quantidade (kg)').fill('1,062');
  await d.getByLabel('Valor pago (R$)').first().fill('37,16');
  await d.getByRole('button', { name: 'Adicionar item' }).click();
  await d.getByLabel('Insumo').nth(1).selectOption('+');
  const dn = dialogo('Novo insumo');
  await dn.getByLabel('Nome').fill('Pão brioche');
  await dn.getByRole('button', { name: 'Cadastrar e usar' }).click();
  await dn.waitFor({ state: 'detached' });
  await d.getByLabel('Quantidade (un)').fill('12');
  await d.getByLabel('Valor pago (R$)').nth(1).fill('45,98');
  await d.getByLabel('Pago com').selectOption({ label: 'Do meu bolso' });
  await d.getByText('R$ 83,14').waitFor();
  await foto('03-compra');
  await d.getByRole('button', { name: 'Registrar compra' }).click();
  await aviso('Compra registrada: R$ 83,14');
  await page.getByText('Costa Atacadão').waitFor();
  ok('compra registrada com insumo novo criado no meio (R$ 83,14)');

  await page.getByRole('radio', { name: 'O que tenho' }).click();
  await page.getByText('1,062').first().waitFor();
  await page.getByText('R$ 34,99 / kg').waitFor();
  ok('estoque e custo médio atualizados (1,062 kg a R$ 34,99/kg)');
  await foto('04-estoque');

  // 4. Cardápio com ficha técnica
  await nav('Cardápio').click();
  await page.getByRole('button', { name: 'Novo' }).click();
  d = dialogo('Novo produto');
  await d.getByLabel('Nome').fill('Burger da casa');
  await d.getByLabel('Preço de venda (R$)').fill('42');
  await d.getByLabel('Insumo da linha 1').selectOption({ label: 'Carne moída' });
  await d.getByLabel('Quantidade da linha 1').fill('0,177');
  await d.getByRole('button', { name: 'Adicionar insumo' }).click();
  await d.getByLabel('Insumo da linha 2').selectOption({ label: 'Pão brioche' });
  await d.getByLabel('Quantidade da linha 2').fill('1');
  await d.getByText('R$ 10,03').first().waitFor();  // 0,177 × 34,9906 + 3,8317 = 10,025
  await foto('05-ficha-tecnica');
  await d.getByRole('button', { name: 'Cadastrar produto' }).click();
  await aviso('Produto cadastrado');
  await page.getByText(/custo R\$\s10,03/).waitFor();
  ok('produto com ficha técnica: custo R$ 10,03 calculado');
  await foto('06-cardapio');

  // 5. Vender no iFood
  await nav('Vender').click();
  await page.getByRole('radio', { name: 'iFood' }).click();
  await page.getByRole('button', { name: 'Adicionar Burger da casa' }).click();
  await page.getByRole('button', { name: 'Adicionar Burger da casa' }).click();
  await page.getByText('2 itens').waitFor();
  await page.getByRole('button', { name: /2 itens/ }).click();
  await page.getByText('R$ 22,01').waitFor();        // taxa 26,2% de 84
  await foto('07-comanda');
  await page.getByRole('button', { name: 'Registrar venda' }).click();
  await aviso('Venda registrada: R$ 84,00');
  ok('venda no iFood registrada (R$ 84,00, taxa R$ 22,01)');

  // 6. Início mostra o resultado certo: 84 − 22,01 − 20,05 = 41,94
  await nav('Início').click();
  await page.getByText('R$ 41,94').first().waitFor();
  ok('Início: resultado R$ 41,94 (vendido − taxa − ingredientes)');
  await foto('08-inicio-com-venda');

  // 7. DAS repetido 12 meses, em aberto
  await nav('Dinheiro').click();
  await page.getByRole('button', { name: 'Lançar' }).click();
  d = dialogo('Novo lançamento');
  await d.getByLabel('Descrição').fill('DAS');
  await d.getByLabel('Valor (R$)').fill('86,05');
  await d.getByLabel('Categoria').selectOption({ label: 'Impostos (DAS)' });
  await d.getByLabel('Repetir todo mês').fill('12');
  await d.getByLabel('Já paguei').uncheck();
  await d.getByRole('button', { name: 'Lançar' }).click();
  await aviso('12 lançamentos criados');
  await page.getByText('DAS (1/12)').waitFor();
  ok('DAS lançado 12 vezes em aberto');
  await foto('09-a-pagar');

  // 8. Pagar a 1ª parcela do DAS
  await page.getByText('DAS (1/12)').click();
  d = dialogo('Lançamento');
  await d.getByLabel('Já paguei').check();
  await d.getByLabel('Conta').selectOption({ label: 'Conta da empresa' });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await aviso('Lançamento salvo');
  await page.getByRole('radio', { name: 'Saldos' }).click();
  await page.getByText('R$ 83,14').waitFor();         // do meu bolso
  ok('DAS pago; "Do meu bolso" mostra R$ 83,14 aportado');
  await foto('10-saldos');

  // 9. Exportar tudo
  await nav('Início').click();
  await page.getByRole('button', { name: 'Ajustes, planilhas e backup' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar tudo (.xlsx)' }).click()]);
  const arq = path.join(OUT, 'backup.xlsx');
  await download.saveAs(arq);
  const wb = XLSX.read(fs.readFileSync(arq));
  const vendas = XLSX.utils.sheet_to_json(wb.Sheets['Vendas']);
  const lancs = XLSX.utils.sheet_to_json(wb.Sheets['Lançamentos']);
  if (vendas.length !== 1 || vendas[0]['Quantidade'] !== 2) throw new Error('Exportação: vendas erradas ' + JSON.stringify(vendas));
  if (lancs.length !== 14) throw new Error('Exportação: esperava 14 lançamentos (1 compra, 1 venda, 12 DAS) e veio ' + lancs.length);
  ok(`exportação com ${wb.SheetNames.length} abas (${wb.SheetNames.join(', ')})`);
  await foto('11-ajustes');

  // 10. Importar planilha com erro → mostra a linha e não grava
  await page.getByLabel('O que vai importar').selectOption('lancamentos');
  const ruim = path.join(OUT, 'import-ruim.xlsx');
  const wbr = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbr, XLSX.utils.json_to_sheet([
    { Tipo: 'despesa', Descrição: 'Gás', Categoria: 'Gás', Valor: '120,00', Vencimento: '10/10/2026' },
    { Tipo: 'despesa', Descrição: 'Errado', Categoria: 'Não existe', Valor: '1', Vencimento: '10/10/2026' },
  ]), 'Lançamentos');
  XLSX.writeFile(wbr, ruim);
  await page.getByLabel('Arquivo da planilha').setInputFiles(ruim);
  d = dialogo('Conferir importação');
  await d.getByText('Linha 3:').waitFor();
  await d.getByText('Categoria "Não existe" não existe').waitFor();
  await foto('12-import-erro');
  await d.getByRole('button', { name: 'Corrigir a planilha e escolher de novo' }).click();
  ok('importação com erro mostra a linha e não grava');

  // 11. Importar planilha certa
  const boa = path.join(OUT, 'import-bom.xlsx');
  const wbb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbb, XLSX.utils.json_to_sheet([
    { tipo: 'saída', descricao: 'Botijão de gás', categoria: 'gas', valor: '120,00', data: '10/10/2026', 'pago em': '05/10/2026', conta: 'Conta da empresa' },
  ]), 'Planilha1');
  XLSX.writeFile(wbb, boa);
  await page.getByLabel('Arquivo da planilha').setInputFiles(boa);
  d = dialogo('Conferir importação');
  await d.getByText('1 lançamentos').waitFor();
  await d.getByRole('button', { name: 'Importar agora' }).click();
  await aviso('1 lançamentos importados');
  ok('importação de lançamento com cabeçalhos diferentes (sinônimos) funcionou');

  // 12. Cancelar a venda devolve o estoque
  await page.getByRole('button', { name: 'Voltar ao Início' }).click();
  await nav('Vender').click();
  await page.getByRole('button', { name: 'Vendas' }).click();
  d = dialogo('Vendas do dia');
  await d.getByText(/#\d+ · iFood/).waitFor();
  await foto('13-vendas-do-dia');
  await d.getByRole('button', { name: 'Cancelar venda' }).click();
  await page.getByRole('dialog', { name: /Cancelar a venda #\d+\?/ }).getByRole('button', { name: 'Cancelar venda' }).click();
  await aviso('Venda cancelada');
  await page.keyboard.press('Escape');
  await nav('Estoque').click();
  await page.getByText('1,062').first().waitFor();
  ok('venda cancelada e carne voltou para 1,062 kg');

  // 13. Telas finais para revisão visual
  await nav('Início').click();
  await page.waitForTimeout(600);
  await foto('14-inicio-final');
  await nav('Cardápio').click(); await page.waitForTimeout(400);

  const relevantes = errosConsole.filter(e => !/favicon|DevTools/.test(e));
  if (relevantes.length) throw new Error('Erros no console:\n' + relevantes.join('\n'));
  ok('nenhum erro no console');
  console.log('E2E_OK');
} catch (e) {
  await foto('ERRO');
  console.error('✗ FALHOU no passo', passo + 1, '\n', e.message);
  if (errosConsole.length) console.error('Console:', errosConsole.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}

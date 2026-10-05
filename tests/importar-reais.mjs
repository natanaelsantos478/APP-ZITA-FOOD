// Carrega os dados reais na nuvem usando a importação do próprio app (build de produção).
import { chromium } from 'playwright';
import fs from 'node:fs';
const senha = fs.readFileSync('.senha-inicial', 'utf8').trim();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })).newPage();
const erros = []; p.on('pageerror', e => erros.push(String(e)));
await p.goto('http://localhost:4173');
await p.getByLabel('E-mail').fill('natanaelper3@gmail.com');
await p.getByLabel('Senha').fill(senha);
await p.getByRole('button', { name: 'Entrar' }).click();
await p.getByRole('heading', { name: 'Início', level: 1 }).waitFor();
await p.getByRole('button', { name: 'Ajustes, planilhas e backup' }).click();
const etapas = process.argv[2] === 'so-lancamentos' ? [['lancamentos', '3-lancamentos.xlsx', '1 lançamentos importados']] : [['insumos', '1-insumos.xlsx', '27 insumos importados'], ['compras', '2-compras.xlsx', '15 compras importadas'], ['lancamentos', '3-lancamentos.xlsx', '1 lançamentos importados']];
for (const [tipo, arq, msg] of etapas) {
  await p.getByLabel('O que vai importar').selectOption(tipo);
  await p.getByLabel('Arquivo da planilha').setInputFiles('entrega/planilhas/' + arq);
  const d = p.getByRole('dialog', { name: 'Conferir importação' });
  await d.waitFor();
  const texto = await d.innerText();
  if (/problema/.test(texto)) { console.log(texto); throw new Error('Planilha com erro: ' + arq); }
  console.log('•', arq, '→', (await d.locator('p.font-medium').first().innerText()));
  await d.getByRole('button', { name: 'Importar agora' }).click();
  await p.getByRole('status').filter({ hasText: msg }).waitFor({ timeout: 60000 });
  console.log('  ✓', msg);
}
if (erros.length) throw new Error(erros.join('\n'));
await b.close();

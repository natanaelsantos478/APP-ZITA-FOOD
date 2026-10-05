import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await p.goto('http://localhost:5173');
await p.getByLabel('E-mail').fill('dono@teste.local'); await p.getByLabel('Senha').fill('senha-teste-123');
await p.getByRole('button', { name: 'Entrar' }).click();
await p.getByRole('heading', { name: 'Início', level: 1 }).waitFor();
await p.evaluate(() => localStorage.setItem('versao_vista', '1.2.0'));   // simula quem estava na 1.2.0
await p.reload();
await p.getByRole('status').filter({ hasText: 'App atualizado para a versão 1.2.1' }).waitFor({ timeout: 8000 });
console.log('✓ aviso de atualização aparece');
await p.reload(); await p.waitForTimeout(1500);
const repetiu = await p.getByText('App atualizado para a versão').count();
console.log(repetiu === 0 ? '✓ não repete na abertura seguinte' : '✗ aviso repetiu');
await p.screenshot({ path: 'tests/telas/v121-inicio.png' });
await b.close();

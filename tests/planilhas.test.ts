import assert from 'node:assert/strict';
import { lerNumero, lerData, chave } from '../src/lib/formato.ts';
import { interpretar, normalizarCabecalhos, resumo, type Cadastros } from '../src/lib/planilhas.ts';

let n = 0;
const teste = (nome: string, fn: () => void) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${nome}`); throw e; }
};

teste('lerNumero formatos brasileiros', () => {
  assert.equal(lerNumero('1.234,56'), 1234.56);
  assert.equal(lerNumero('1234,56'), 1234.56);
  assert.equal(lerNumero('1234.56'), 1234.56);
  assert.equal(lerNumero('R$ 12,90'), 12.9);
  assert.equal(lerNumero('1.062'), 1062);       // milhar (sem vírgula, 3 dígitos após ponto)
  assert.equal(lerNumero('0,177'), 0.177);
  assert.equal(lerNumero('1.5'), 1.5);
  assert.equal(lerNumero(12.9), 12.9);
  assert.equal(lerNumero('-5,5'), -5.5);
  assert.equal(lerNumero(''), null);
  assert.equal(lerNumero('abc'), null);
  assert.equal(lerNumero('1,2,3'), null);
  assert.equal(lerNumero(NaN), null);
});

teste('lerData', () => {
  assert.equal(lerData('05/10/2026'), '2026-10-05');
  assert.equal(lerData('5/10/26'), '2026-10-05');
  assert.equal(lerData('2026-10-05'), '2026-10-05');
  assert.equal(lerData(46300), '2026-10-05');   // serial do Excel
  assert.equal(lerData('31/02/2026'), null);
  assert.equal(lerData('ontem'), null);
  assert.equal(lerData(''), null);
});

teste('chave ignora acento e caixa', () => {
  assert.equal(chave('  Pão   Brioche '), 'pao brioche');
});

const cad: Cadastros = {
  insumos: [{ id: 'i-carne', nome: 'Carne moída', unidade: 'kg' }, { id: 'i-pao', nome: 'Pão brioche', unidade: 'un' }],
  produtos: [{ id: 'p-burger', nome: 'Burger Goiabacon', preco_venda: 42 }],
  categorias: [{ id: 'c-equip', nome: 'Equipamentos e utensílios', tipo: 'investimento' }, { id: 'c-das', nome: 'Impostos (DAS)', tipo: 'despesa' },
               { id: 'c-vendas', nome: 'Vendas', tipo: 'receita' }],
  contas: [{ id: 'ct-bolso', nome: 'Do meu bolso' }, { id: 'ct-emp', nome: 'Conta da empresa' }],
  canais: [{ id: 'ch-ifood', nome: 'iFood' }, { id: 'ch-balcao', nome: 'Balcão' }],
};

teste('cabeçalhos por sinônimo e sem acento', () => {
  const r = normalizarCabecalhos('lancamentos', [{ TIPO: 'despesa', descricao: 'x', categoria: 'y', valor: 1, data: '01/01/2026' }]);
  assert.deepEqual(r.faltando, []);
  assert.equal(r.linhas[0]['Vencimento'], '01/01/2026');
  assert.equal(r.linhas[0]['Descrição'], 'x');
  const f = normalizarCabecalhos('cardapio', [{ Nome: 'a' }]);
  assert.deepEqual(f.faltando, ['Preço']);
});

teste('insumos: novo, existente, saldo inicial, erros por linha', () => {
  const { resultado, erros } = interpretar('insumos', [
    { Nome: 'Carne moída', Unidade: 'kg', 'Estoque mínimo': '0,5' },
    { Nome: 'Bacon', Unidade: 'kg', 'Saldo inicial': '0,25', 'Custo unitário': '88' },
    { Nome: 'bacon' },                  // repetido
    { Nome: '', Unidade: 'kg' },        // sem nome
    {},                                 // vazia: ignorada
    { Nome: 'Queijo', 'Estoque mínimo': '-1' },
  ], cad);
  assert.equal(resultado?.tipo, 'insumos');
  if (resultado?.tipo !== 'insumos') return;
  assert.equal(resultado.itens.length, 2);
  assert.equal(resultado.itens[0].existente_id, 'i-carne');
  assert.equal(resultado.itens[0].estoque_minimo, 0.5);
  assert.equal(resultado.itens[1].saldo_inicial, 0.25);
  assert.equal(resultado.itens[1].custo, 88);
  assert.deepEqual(erros.map(e => e.linha), [4, 5, 7]);
  assert.match(resumo(resultado), /1 insumos novos, 1 atualizados, 1 com saldo inicial/);
});

teste('compras: agrupa por data+fornecedor, cria insumo novo, categoria, valida conta', () => {
  const { resultado, erros } = interpretar('compras', [
    { Data: '04/10/2026', Fornecedor: 'Costa Atacadão', Insumo: 'Carne moída', Quantidade: '1,062', 'Valor pago': '37,16', 'Pago com': 'Do meu bolso' },
    { Data: '04/10/2026', Fornecedor: 'costa atacadão', Insumo: 'Cebola roxa', Unidade: 'kg', Quantidade: '0,966', 'Valor pago': '9,55' },
    { Data: '20/08/2026', Fornecedor: 'Mercado Livre', Item: 'Fritador + chapa', Categoria: 'Equipamentos e utensílios', Quantidade: 1, 'Valor pago': '297,20', Parcelas: 4 },
    { Data: '02/10/2026', Fornecedor: 'ML', Item: 'Caixa', Quantidade: 1, 'Valor pago': 10 },               // sem insumo nem categoria
    { Data: '02/10/2026', Fornecedor: 'ML', Insumo: 'Caixa combo', Quantidade: 50, 'Valor pago': '61,26', 'Pago com': 'Cartão X' }, // conta inexistente
    { Data: '02/13/2026', Insumo: 'Pão brioche', Quantidade: 1, 'Valor pago': 1 },                         // data inválida
  ], cad);
  assert.equal(resultado?.tipo, 'compras');
  if (resultado?.tipo !== 'compras') return;
  assert.equal(resultado.itens.length, 2);
  const mercado = resultado.itens[0];
  assert.equal(mercado.itens.length, 2);
  assert.equal(mercado.conta_id, 'ct-bolso');
  assert.equal(mercado.itens[1].insumo_novo, 'Cebola roxa');
  assert.deepEqual(resultado.novos_insumos, [{ nome: 'Cebola roxa', unidade: 'kg' }]);
  const frit = resultado.itens[1];
  assert.equal(frit.parcelas, 4);
  assert.equal(frit.itens[0].categoria_id, 'c-equip');
  assert.deepEqual(erros.map(e => e.linha).sort(), [5, 6, 7]);
});

teste('compras: à vista sem conta é erro', () => {
  const { erros } = interpretar('compras', [{ Data: '01/10/2026', Insumo: 'Pão brioche', Quantidade: 12, 'Valor pago': 45.98 }], cad);
  assert.equal(erros.length, 1);
  assert.match(erros[0].mensagem, /Pago com/);
});

teste('vendas: agrupa por código, cada linha sem código é uma venda, valida canal/produto', () => {
  const { resultado, erros } = interpretar('vendas', [
    { Venda: 'A1', Data: '05/10/2026', Canal: 'ifood', Produto: 'burger goiabacon', Quantidade: 2 },
    { Venda: 'A1', Data: '05/10/2026', Canal: 'iFood', Produto: 'Burger Goiabacon', Quantidade: 1, Preço: '40' },
    { Data: '05/10/2026', Canal: 'Balcão', Produto: 'Burger Goiabacon' },
    { Data: '05/10/2026', Canal: 'Balcão', Produto: 'Burger Goiabacon' },
    { Data: '05/10/2026', Canal: 'Rappi', Produto: 'Burger Goiabacon' },
    { Venda: 'A1', Data: '06/10/2026', Canal: 'iFood', Produto: 'Burger Goiabacon' },
  ], cad);
  if (resultado?.tipo !== 'vendas') throw new Error('tipo');
  assert.equal(resultado.itens.length, 3);
  assert.equal(resultado.itens[0].itens.length, 2);
  assert.equal(resultado.itens[0].itens[1].preco_unitario, 40);
  assert.equal(resultado.itens[0].itens[0].preco_unitario, undefined);
  assert.deepEqual(erros.map(e => e.linha), [6, 7]);
});

teste('lançamentos: tipo por sinônimo, categoria compatível, pago exige conta', () => {
  const { resultado, erros } = interpretar('lancamentos', [
    { Tipo: 'Despesa', Descrição: 'DAS outubro', Categoria: 'impostos (das)', Valor: '86,05', Vencimento: '20/10/2026' },
    { Tipo: 'saída', Descrição: 'DAS setembro', Categoria: 'Impostos (DAS)', Valor: '86,05', Vencimento: '20/09/2026', 'Pago em': '20/09/2026', Conta: 'Conta da empresa' },
    { Tipo: 'receita', Descrição: 'x', Categoria: 'Impostos (DAS)', Valor: 1, Vencimento: '01/10/2026' },
    { Tipo: 'despesa', Descrição: 'y', Categoria: 'Impostos (DAS)', Valor: 1, Vencimento: '01/10/2026', 'Pago em': '01/10/2026' },
    { Tipo: 'talvez', Descrição: 'z', Categoria: 'Impostos (DAS)', Valor: 1, Vencimento: '01/10/2026' },
  ], cad);
  if (resultado?.tipo !== 'lancamentos') throw new Error('tipo');
  assert.equal(resultado.itens.length, 2);
  assert.equal(resultado.itens[1].pago_em, '2026-09-20');
  assert.equal(resultado.itens[1].conta_id, 'ct-emp');
  assert.deepEqual(erros.map(e => e.linha), [4, 5, 6]);
});

teste('ficha: agrupa por produto e recusa duplicado', () => {
  const { resultado, erros } = interpretar('ficha', [
    { Produto: 'Burger Goiabacon', Insumo: 'Carne moída', Quantidade: '0,177' },
    { Produto: 'Burger Goiabacon', Insumo: 'Pão brioche', Quantidade: 1 },
    { Produto: 'Burger Goiabacon', Insumo: 'pão brioche', Quantidade: 1 },
    { Produto: 'X-Tudo', Insumo: 'Pão brioche', Quantidade: 1 },
  ], cad);
  if (resultado?.tipo !== 'ficha') throw new Error('tipo');
  assert.equal(resultado.itens.length, 1);
  assert.equal(resultado.itens[0].linhas.length, 2);
  assert.equal(resultado.itens[0].linhas[0].quantidade, 0.177);
  assert.deepEqual(erros.map(e => e.linha), [4, 5]);
});

teste('planilha sem colunas obrigatórias', () => {
  const { resultado, erros } = interpretar('vendas', [{ Data: '01/01/2026' }], cad);
  assert.equal(resultado, null);
  assert.match(erros[0].mensagem, /Canal, Produto/);
});

console.log(`✓ ${n} testes de planilha passaram`);

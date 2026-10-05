// Leitura e validação de planilhas de importação. Puro (sem banco, sem XLSX) → testado em tests/planilhas.test.ts.
// O formato de cada tipo é o MESMO da exportação: exporte, edite no Excel e importe de volta.
import { chave, lerData, lerNumero } from './formato.ts';

export type TipoImport = 'insumos' | 'cardapio' | 'ficha' | 'compras' | 'vendas' | 'lancamentos';

interface Coluna { nome: string; obrigatoria?: boolean; sinonimos?: string[]; ajuda: string }

export const MODELOS: Record<TipoImport, { aba: string; titulo: string; descricao: string; colunas: Coluna[] }> = {
  insumos: {
    aba: 'Insumos', titulo: 'Insumos (estoque)',
    descricao: 'Cadastra ou atualiza insumos. Nome igual a um existente = atualiza.',
    colunas: [
      { nome: 'Nome', obrigatoria: true, sinonimos: ['insumo', 'produto', 'item'], ajuda: 'Ex.: Carne moída' },
      { nome: 'Unidade', sinonimos: ['un', 'medida'], ajuda: 'un, kg, g, L, ml, fatia, pct…' },
      { nome: 'Grupo', sinonimos: ['categoria', 'tipo'], ajuda: 'Ingrediente, Embalagem, Bebida, Limpeza, Outro' },
      { nome: 'Estoque mínimo', sinonimos: ['minimo', 'estoque minimo', 'alerta'], ajuda: 'Avisa quando ficar abaixo' },
      { nome: 'Saldo inicial', sinonimos: ['estoque', 'quantidade', 'estoque atual', 'saldo'], ajuda: 'Só para quem já tinha antes do app' },
      { nome: 'Custo unitário', sinonimos: ['custo', 'custo medio', 'preco'], ajuda: 'Custo por unidade do saldo inicial' },
    ],
  },
  cardapio: {
    aba: 'Cardápio', titulo: 'Cardápio',
    descricao: 'Cadastra ou atualiza produtos. Nome igual = atualiza preço e grupo.',
    colunas: [
      { nome: 'Nome', obrigatoria: true, sinonimos: ['produto', 'lanche'], ajuda: 'Ex.: Burger Goiabacon' },
      { nome: 'Grupo', sinonimos: ['categoria'], ajuda: 'Lanches, Bebidas, Porções…' },
      { nome: 'Preço', obrigatoria: true, sinonimos: ['preco venda', 'preço de venda', 'valor'], ajuda: 'Preço de venda' },
      { nome: 'À venda', sinonimos: ['ativo', 'a venda'], ajuda: 'sim / não (vazio = sim)' },
      { nome: 'Código', sinonimos: ['codigo', 'sku', 'cod'], ajuda: 'Opcional; o mesmo código do produto no ZIA' },
    ],
  },
  ficha: {
    aba: 'Ficha técnica', titulo: 'Ficha técnica',
    descricao: 'Uma linha por insumo de cada produto. Substitui a ficha dos produtos que estão na planilha.',
    colunas: [
      { nome: 'Produto', obrigatoria: true, sinonimos: ['lanche'], ajuda: 'Nome igual ao do cardápio' },
      { nome: 'Insumo', obrigatoria: true, sinonimos: ['ingrediente'], ajuda: 'Nome igual ao do estoque' },
      { nome: 'Quantidade', obrigatoria: true, sinonimos: ['qtd', 'qtde'], ajuda: 'Na unidade do insumo (ex.: 0,15 kg)' },
    ],
  },
  compras: {
    aba: 'Compras', titulo: 'Compras',
    descricao: 'Uma linha por item. Linhas com o mesmo "Compra" (ou mesma data + fornecedor) viram uma compra só.',
    colunas: [
      { nome: 'Compra', sinonimos: ['codigo', 'código', 'pedido', 'nota'], ajuda: 'Código para agrupar itens (opcional)' },
      { nome: 'Data', obrigatoria: true, ajuda: 'dd/mm/aaaa' },
      { nome: 'Fornecedor', sinonimos: ['onde comprou', 'loja'], ajuda: 'Atacadão, Mercado Livre…' },
      { nome: 'Item', sinonimos: ['descricao', 'descrição', 'produto'], ajuda: 'Descrição do item' },
      { nome: 'Insumo', ajuda: 'Se vai pro estoque: nome do insumo (cria se não existir)' },
      { nome: 'Unidade', ajuda: 'Unidade do insumo novo (padrão un)' },
      { nome: 'Categoria', ajuda: 'Se NÃO vai pro estoque: Equipamentos e utensílios, Gás…' },
      { nome: 'Quantidade', obrigatoria: true, sinonimos: ['qtd', 'qtde'], ajuda: 'Na unidade do insumo' },
      { nome: 'Valor pago', obrigatoria: true, sinonimos: ['valor', 'valor total', 'total'], ajuda: 'Valor total do item' },
      { nome: 'Frete', ajuda: 'Da compra inteira (1ª linha)' },
      { nome: 'Desconto', ajuda: 'Da compra inteira (1ª linha)' },
      { nome: 'Parcelas', ajuda: 'Da compra inteira (padrão 1)' },
      { nome: 'Pago com', sinonimos: ['conta', 'pagamento'], ajuda: 'Nome da conta (ex.: Do meu bolso)' },
    ],
  },
  vendas: {
    aba: 'Vendas', titulo: 'Vendas',
    descricao: 'Uma linha por item. Linhas com o mesmo "Venda" viram uma venda só (sem código, cada linha é uma venda).',
    colunas: [
      { nome: 'Venda', sinonimos: ['pedido', 'numero', 'número', 'codigo'], ajuda: 'Código para agrupar itens (opcional)' },
      { nome: 'Data', obrigatoria: true, ajuda: 'dd/mm/aaaa' },
      { nome: 'Canal', obrigatoria: true, ajuda: 'Balcão, WhatsApp, iFood…' },
      { nome: 'Produto', obrigatoria: true, sinonimos: ['lanche', 'item'], ajuda: 'Nome igual ao do cardápio' },
      { nome: 'Quantidade', sinonimos: ['qtd', 'qtde'], ajuda: 'Padrão 1' },
      { nome: 'Preço', sinonimos: ['preco unitario', 'valor unitario', 'valor'], ajuda: 'Vazio = preço do cardápio' },
      { nome: 'Desconto', ajuda: 'Da venda inteira (1ª linha)' },
      { nome: 'Taxa de entrega', sinonimos: ['entrega', 'frete'], ajuda: 'Da venda inteira (1ª linha)' },
      { nome: 'Cliente', ajuda: 'Opcional' },
      { nome: 'Forma de pagamento', sinonimos: ['pagamento', 'forma'], ajuda: 'Dinheiro, Pix, Cartão de crédito… (vazio = padrão do canal)' },
    ],
  },
  lancamentos: {
    aba: 'Lançamentos', titulo: 'Contas e lançamentos',
    descricao: 'Despesas e receitas avulsas (DAS, gás, aluguel…). Compras e vendas têm planilha própria.',
    colunas: [
      { nome: 'Tipo', obrigatoria: true, ajuda: 'despesa ou receita' },
      { nome: 'Descrição', obrigatoria: true, sinonimos: ['descricao', 'historico'], ajuda: 'Ex.: DAS outubro' },
      { nome: 'Categoria', obrigatoria: true, ajuda: 'Nome igual a uma categoria do app' },
      { nome: 'Valor', obrigatoria: true, ajuda: 'Ex.: 86,05' },
      { nome: 'Vencimento', obrigatoria: true, sinonimos: ['data'], ajuda: 'dd/mm/aaaa' },
      { nome: 'Pago em', sinonimos: ['pagamento', 'data pagamento', 'recebido em'], ajuda: 'Vazio = em aberto' },
      { nome: 'Conta', sinonimos: ['pago com'], ajuda: 'Obrigatória se tiver "Pago em"' },
    ],
  },
};

export interface Cadastros {
  insumos: { id: string; nome: string; unidade: string }[];
  produtos: { id: string; nome: string; preco_venda: number }[];
  categorias: { id: string; nome: string; tipo: string }[];
  contas: { id: string; nome: string }[];
  canais: { id: string; nome: string }[];
  formas?: { id: string; nome: string }[];
}

export interface ErroLinha { linha: number; mensagem: string }

export type Resultado =
  | { tipo: 'insumos'; itens: { nome: string; unidade: string; grupo: string; estoque_minimo: number; saldo_inicial: number | null; custo: number | null; existente_id: string | null }[] }
  | { tipo: 'cardapio'; itens: { nome: string; grupo: string; preco_venda: number; ativo: boolean; codigo: string | null; existente_id: string | null }[] }
  | { tipo: 'ficha'; itens: { produto_id: string; produto: string; linhas: { insumo_id: string; quantidade: number }[] }[] }
  | { tipo: 'compras'; itens: CompraImport[]; novos_insumos: { nome: string; unidade: string }[] }
  | { tipo: 'vendas'; itens: VendaImport[] }
  | { tipo: 'lancamentos'; itens: LancImport[] };

export interface CompraImport {
  linhas: number[]; data: string; fornecedor: string | null; conta_id: string | null; frete: number; desconto: number; parcelas: number;
  itens: { insumo_id: string | null; insumo_novo: string | null; categoria_id: string | null; descricao: string; quantidade: number; valor_total: number }[];
}
export interface VendaImport {
  linhas: number[]; data: string; canal_id: string; forma_pagamento_id: string | null; cliente: string | null; desconto: number; taxa_entrega: number;
  itens: { produto_id: string; quantidade: number; preco_unitario?: number }[];
}
export interface LancImport {
  tipo: 'receita' | 'despesa'; descricao: string; categoria_id: string; valor: number; vencimento: string;
  pago_em: string | null; conta_id: string | null;
}

/** Converte linhas cruas da planilha (cabeçalho → valor) em linhas com os nomes oficiais das colunas */
export function normalizarCabecalhos(tipo: TipoImport, linhas: Record<string, unknown>[]): { linhas: Record<string, unknown>[]; faltando: string[] } {
  const cols = MODELOS[tipo].colunas;
  const mapa = new Map<string, string>();
  for (const c of cols) {
    mapa.set(chave(c.nome), c.nome);
    c.sinonimos?.forEach(s => { if (!mapa.has(chave(s))) mapa.set(chave(s), c.nome); });
  }
  const presentes = new Set<string>();
  const saida = linhas.map(l => {
    const n: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(l)) {
      const oficial = mapa.get(chave(k));
      if (oficial && n[oficial] === undefined) { n[oficial] = v; presentes.add(oficial); }
    }
    return n;
  });
  const faltando = cols.filter(c => c.obrigatoria && !presentes.has(c.nome)).map(c => c.nome);
  return { linhas: saida, faltando };
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const vazio = (l: Record<string, unknown>) => Object.values(l).every(v => txt(v) === '');
const simNao = (v: unknown, padrao: boolean) => {
  const s = chave(v);
  if (!s) return padrao;
  if (['sim', 's', 'yes', 'true', '1', 'x', 'ativo'].includes(s)) return true;
  if (['nao', 'n', 'no', 'false', '0', 'inativo'].includes(s)) return false;
  return padrao;
};

function porNome<T extends { nome: string }>(lista: T[]) {
  const m = new Map<string, T>();
  lista.forEach(x => m.set(chave(x.nome), x));
  return (nome: unknown) => m.get(chave(nome));
}

/**
 * Valida e converte. A linha 1 da planilha é o cabeçalho, então a 1ª linha de dados é a 2.
 */
export function interpretar(tipo: TipoImport, cruas: Record<string, unknown>[], cad: Cadastros): { resultado: Resultado | null; erros: ErroLinha[] } {
  const { linhas, faltando } = normalizarCabecalhos(tipo, cruas);
  if (faltando.length) return { resultado: null, erros: [{ linha: 1, mensagem: `Faltam as colunas: ${faltando.join(', ')}` }] };
  const erros: ErroLinha[] = [];
  const err = (linha: number, mensagem: string) => erros.push({ linha, mensagem });
  const insumo = porNome(cad.insumos), produto = porNome(cad.produtos), categoria = porNome(cad.categorias),
        conta = porNome(cad.contas), canal = porNome(cad.canais), forma = porNome(cad.formas ?? []);
  const dados = linhas.map((l, i) => ({ l, n: i + 2 })).filter(x => !vazio(x.l));
  if (!dados.length) return { resultado: null, erros: [{ linha: 2, mensagem: 'A planilha não tem linhas preenchidas' }] };

  if (tipo === 'insumos') {
    const vistos = new Set<string>();
    const itens: Extract<Resultado, { tipo: 'insumos' }>['itens'] = [];
    for (const { l, n } of dados) {
      const nome = txt(l['Nome']);
      if (!nome) { err(n, 'Nome vazio'); continue; }
      if (vistos.has(chave(nome))) { err(n, `"${nome}" repetido na planilha`); continue; }
      vistos.add(chave(nome));
      const min = txt(l['Estoque mínimo']) ? lerNumero(l['Estoque mínimo']) : 0;
      const saldo = txt(l['Saldo inicial']) ? lerNumero(l['Saldo inicial']) : null;
      const custo = txt(l['Custo unitário']) ? lerNumero(l['Custo unitário']) : null;
      if (min === null || min < 0) { err(n, 'Estoque mínimo inválido'); continue; }
      if (txt(l['Saldo inicial']) && (saldo === null || saldo < 0)) { err(n, 'Saldo inicial inválido'); continue; }
      if (txt(l['Custo unitário']) && (custo === null || custo < 0)) { err(n, 'Custo unitário inválido'); continue; }
      itens.push({ nome, unidade: txt(l['Unidade']) || insumo(nome)?.unidade || 'un', grupo: txt(l['Grupo']) || 'Ingrediente',
        estoque_minimo: min, saldo_inicial: saldo && saldo > 0 ? saldo : null, custo, existente_id: insumo(nome)?.id ?? null });
    }
    return { resultado: { tipo, itens }, erros };
  }

  if (tipo === 'cardapio') {
    const vistos = new Set<string>();
    const itens: Extract<Resultado, { tipo: 'cardapio' }>['itens'] = [];
    for (const { l, n } of dados) {
      const nome = txt(l['Nome']);
      const preco = lerNumero(l['Preço']);
      if (!nome) { err(n, 'Nome vazio'); continue; }
      if (vistos.has(chave(nome))) { err(n, `"${nome}" repetido na planilha`); continue; }
      vistos.add(chave(nome));
      if (preco === null || preco < 0) { err(n, 'Preço inválido'); continue; }
      const codigo = txt(l['Código']).toUpperCase() || null;
      if (codigo && itens.some(i => i.codigo === codigo)) { err(n, `Código "${codigo}" repetido na planilha`); continue; }
      itens.push({ nome, grupo: txt(l['Grupo']) || 'Lanches', preco_venda: preco, ativo: simNao(l['À venda'], true), codigo, existente_id: produto(nome)?.id ?? null });
    }
    return { resultado: { tipo, itens }, erros };
  }

  if (tipo === 'ficha') {
    const grupos = new Map<string, { produto_id: string; produto: string; linhas: { insumo_id: string; quantidade: number }[] }>();
    for (const { l, n } of dados) {
      const p = produto(l['Produto']); const i = insumo(l['Insumo']); const q = lerNumero(l['Quantidade']);
      if (!p) { err(n, `Produto "${txt(l['Produto'])}" não está no cardápio`); continue; }
      if (!i) { err(n, `Insumo "${txt(l['Insumo'])}" não está no estoque`); continue; }
      if (!q || q <= 0) { err(n, 'Quantidade inválida'); continue; }
      const g = grupos.get(p.id) ?? { produto_id: p.id, produto: p.nome, linhas: [] };
      if (g.linhas.some(x => x.insumo_id === i.id)) { err(n, `${i.nome} aparece duas vezes em ${p.nome}`); continue; }
      g.linhas.push({ insumo_id: i.id, quantidade: q });
      grupos.set(p.id, g);
    }
    return { resultado: { tipo, itens: [...grupos.values()] }, erros };
  }

  if (tipo === 'compras') {
    const grupos = new Map<string, CompraImport>();
    const novos = new Map<string, { nome: string; unidade: string }>();
    for (const { l, n } of dados) {
      const data = lerData(l['Data']);
      if (!data) { err(n, 'Data inválida (use dd/mm/aaaa)'); continue; }
      const q = lerNumero(l['Quantidade']); const v = lerNumero(l['Valor pago']);
      if (!q || q <= 0) { err(n, 'Quantidade inválida'); continue; }
      if (v === null || v < 0) { err(n, 'Valor pago inválido'); continue; }
      const nomeIns = txt(l['Insumo']); const nomeCat = txt(l['Categoria']);
      let insumo_id: string | null = null, insumo_novo: string | null = null, categoria_id: string | null = null;
      if (nomeIns) {
        const i = insumo(nomeIns);
        if (i) insumo_id = i.id;
        else insumo_novo = nomeIns;
      } else if (nomeCat) {
        const c = categoria(nomeCat);
        if (!c) { err(n, `Categoria "${nomeCat}" não existe`); continue; }
        if (c.tipo === 'receita') { err(n, `"${c.nome}" é categoria de receita`); continue; }
        categoria_id = c.id;
      } else { err(n, 'Preencha Insumo (vai pro estoque) ou Categoria (outra coisa)'); continue; }
      const descricao = txt(l['Item']) || nomeIns;
      if (!descricao) { err(n, 'Item sem descrição'); continue; }
      const fornecedor = txt(l['Fornecedor']) || null;
      const k = txt(l['Compra']) ? `c:${chave(l['Compra'])}` : `d:${data}|${chave(fornecedor)}`;
      let g = grupos.get(k);
      if (!g) {
        const nomeConta = txt(l['Pago com']);
        const ct = nomeConta ? conta(nomeConta) : undefined;
        if (nomeConta && !ct) { err(n, `Conta "${nomeConta}" não existe`); continue; }
        const parcelas = txt(l['Parcelas']) ? lerNumero(l['Parcelas']) : 1;
        const frete = txt(l['Frete']) ? lerNumero(l['Frete']) : 0;
        const desconto = txt(l['Desconto']) ? lerNumero(l['Desconto']) : 0;
        if (!parcelas || parcelas < 1 || parcelas > 36 || !Number.isInteger(parcelas)) { err(n, 'Parcelas deve ser de 1 a 36'); continue; }
        if (frete === null || frete < 0 || desconto === null || desconto < 0) { err(n, 'Frete ou desconto inválido'); continue; }
        g = { linhas: [], data, fornecedor, conta_id: ct?.id ?? null, frete, desconto, parcelas, itens: [] };
        grupos.set(k, g);
      }
      g.linhas.push(n);
      g.itens.push({ insumo_id, insumo_novo, categoria_id, descricao, quantidade: q, valor_total: v });
      if (insumo_novo && !novos.has(chave(insumo_novo))) novos.set(chave(insumo_novo), { nome: insumo_novo, unidade: txt(l['Unidade']) || 'un' });
    }
    for (const g of grupos.values()) {
      if (g.parcelas === 1 && !g.conta_id) err(g.linhas[0], 'Compra à vista sem "Pago com": informe a conta');
      const soma = g.itens.reduce((s, i) => s + i.valor_total, 0);
      if (soma + g.frete - g.desconto < 0) err(g.linhas[0], 'Desconto maior que a compra');
    }
    return { resultado: { tipo, itens: [...grupos.values()], novos_insumos: [...novos.values()] }, erros };
  }

  if (tipo === 'vendas') {
    const grupos = new Map<string, VendaImport>();
    for (const { l, n } of dados) {
      const data = lerData(l['Data']);
      if (!data) { err(n, 'Data inválida (use dd/mm/aaaa)'); continue; }
      const c = canal(l['Canal']);
      if (!c) { err(n, `Canal "${txt(l['Canal'])}" não existe`); continue; }
      const p = produto(l['Produto']);
      if (!p) { err(n, `Produto "${txt(l['Produto'])}" não está no cardápio`); continue; }
      const q = txt(l['Quantidade']) ? lerNumero(l['Quantidade']) : 1;
      if (!q || q <= 0) { err(n, 'Quantidade inválida'); continue; }
      const preco = txt(l['Preço']) ? lerNumero(l['Preço']) : undefined;
      if (preco === null || (preco !== undefined && preco < 0)) { err(n, 'Preço inválido'); continue; }
      const k = txt(l['Venda']) ? `v:${chave(l['Venda'])}` : `linha:${n}`;
      let g = grupos.get(k);
      if (!g) {
        const desconto = txt(l['Desconto']) ? lerNumero(l['Desconto']) : 0;
        const entrega = txt(l['Taxa de entrega']) ? lerNumero(l['Taxa de entrega']) : 0;
        if (desconto === null || desconto < 0 || entrega === null || entrega < 0) { err(n, 'Desconto ou taxa de entrega inválida'); continue; }
        const nomeForma = txt(l['Forma de pagamento']);
        const fp = nomeForma ? forma(nomeForma) : undefined;
        if (nomeForma && !fp) { err(n, `Forma de pagamento "${nomeForma}" não existe`); continue; }
        g = { linhas: [], data, canal_id: c.id, forma_pagamento_id: fp?.id ?? null, cliente: txt(l['Cliente']) || null, desconto, taxa_entrega: entrega, itens: [] };
        grupos.set(k, g);
      } else if (g.canal_id !== c.id || g.data !== data) {
        err(n, `A venda "${txt(l['Venda'])}" tem data ou canal diferente em outra linha`); continue;
      }
      g.linhas.push(n);
      g.itens.push({ produto_id: p.id, quantidade: q, ...(preco !== undefined ? { preco_unitario: preco } : {}) });
    }
    return { resultado: { tipo, itens: [...grupos.values()] }, erros };
  }

  // lançamentos
  const itens: LancImport[] = [];
  for (const { l, n } of dados) {
    const t = chave(l['Tipo']);
    const tipoL = ['despesa', 'saida', 'pagar', 'd'].includes(t) ? 'despesa' : ['receita', 'entrada', 'receber', 'r'].includes(t) ? 'receita' : null;
    if (!tipoL) { err(n, 'Tipo deve ser despesa ou receita'); continue; }
    const descricao = txt(l['Descrição']);
    if (!descricao) { err(n, 'Descrição vazia'); continue; }
    const c = categoria(l['Categoria']);
    if (!c) { err(n, `Categoria "${txt(l['Categoria'])}" não existe`); continue; }
    if (tipoL === 'receita' && c.tipo !== 'receita') { err(n, `"${c.nome}" não é categoria de receita`); continue; }
    if (tipoL === 'despesa' && c.tipo === 'receita') { err(n, `"${c.nome}" é categoria de receita`); continue; }
    const valor = lerNumero(l['Valor']);
    if (!valor || valor <= 0) { err(n, 'Valor inválido'); continue; }
    const venc = lerData(l['Vencimento']);
    if (!venc) { err(n, 'Vencimento inválido (use dd/mm/aaaa)'); continue; }
    const pago = txt(l['Pago em']) ? lerData(l['Pago em']) : null;
    if (txt(l['Pago em']) && !pago) { err(n, '"Pago em" inválido'); continue; }
    const ct = txt(l['Conta']) ? conta(l['Conta']) : undefined;
    if (txt(l['Conta']) && !ct) { err(n, `Conta "${txt(l['Conta'])}" não existe`); continue; }
    if (pago && !ct) { err(n, 'Informe a conta de quem já pagou'); continue; }
    itens.push({ tipo: tipoL, descricao, categoria_id: c.id, valor, vencimento: venc, pago_em: pago, conta_id: pago ? ct!.id : ct?.id ?? null });
  }
  return { resultado: { tipo: 'lancamentos', itens }, erros };
}

/** Resumo legível do que vai acontecer na importação */
export function resumo(r: Resultado): string {
  switch (r.tipo) {
    case 'insumos': {
      const novos = r.itens.filter(i => !i.existente_id).length;
      return `${novos} insumos novos, ${r.itens.length - novos} atualizados${r.itens.some(i => i.saldo_inicial) ? `, ${r.itens.filter(i => i.saldo_inicial).length} com saldo inicial` : ''}`;
    }
    case 'cardapio': {
      const novos = r.itens.filter(i => !i.existente_id).length;
      return `${novos} produtos novos, ${r.itens.length - novos} atualizados`;
    }
    case 'ficha': return `Ficha técnica de ${r.itens.length} produtos (${r.itens.reduce((s, i) => s + i.linhas.length, 0)} linhas)`;
    case 'compras': return `${r.itens.length} compras com ${r.itens.reduce((s, c) => s + c.itens.length, 0)} itens${r.novos_insumos.length ? `; insumos novos: ${r.novos_insumos.map(i => i.nome).join(', ')}` : ''}`;
    case 'vendas': return `${r.itens.length} vendas com ${r.itens.reduce((s, v) => s + v.itens.length, 0)} itens`;
    case 'lancamentos': return `${r.itens.length} lançamentos`;
  }
}

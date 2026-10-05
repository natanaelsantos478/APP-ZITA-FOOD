import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { supabase } from './supabase';
import { MODELOS, type TipoImport, type Resultado } from './planilhas';
import { dataBR } from './formato';

// ---------------------------------------------------------------------------
// Ler e gravar .xlsx
// ---------------------------------------------------------------------------
export async function lerPlanilha(arquivo: File): Promise<{ abas: string[]; linhas: (aba: string) => Record<string, unknown>[] }> {
  const buf = await arquivo.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return {
    abas: wb.SheetNames,
    linhas: aba => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba], { defval: '', raw: true }),
  };
}

/** Salva a planilha: no navegador baixa; no celular abre o compartilhar (Drive, WhatsApp, Arquivos…) */
export async function salvarPlanilha(nome: string, abas: { nome: string; linhas: Record<string, unknown>[]; colunas: string[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const a of abas) {
    const ws = XLSX.utils.json_to_sheet(a.linhas, { header: a.colunas });
    ws['!cols'] = a.colunas.map(c => ({ wch: Math.max(12, c.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, a.nome.slice(0, 31));
  }
  if (Capacitor.isNativePlatform()) {
    const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
    const r = await Filesystem.writeFile({ path: nome, data: base64, directory: Directory.Cache });
    await Share.share({ title: nome, url: r.uri, dialogTitle: 'Salvar ou enviar planilha' });
  } else {
    XLSX.writeFile(wb, nome);
  }
}

export function baixarModelo(tipo: TipoImport) {
  const m = MODELOS[tipo];
  return salvarPlanilha(`modelo-${tipo}.xlsx`, [
    { nome: m.aba, linhas: [], colunas: m.colunas.map(c => c.nome) },
    { nome: 'Como preencher', colunas: ['Coluna', 'Obrigatória', 'O que colocar'],
      linhas: m.colunas.map(c => ({ 'Coluna': c.nome, 'Obrigatória': c.obrigatoria ? 'sim' : '', 'O que colocar': c.ajuda })) },
  ]);
}

// ---------------------------------------------------------------------------
// Exportar tudo (backup que também serve de planilha de importação)
// ---------------------------------------------------------------------------
async function tudo<T>(tabela: string, select = '*', ordem = 'criado_em'): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += 1000) {
    const r = await supabase.from(tabela).select(select).order(ordem).range(de, de + 999);
    if (r.error) throw new Error(r.error.message);
    saida.push(...(r.data as T[]));
    if (r.data.length < 1000) return saida;
  }
}

type Linha = Record<string, unknown>;
export async function exportarTudo() {
  const [insumos, produtos, ficha, categorias, contas, canais, compras, vendas, lancs, movs] = await Promise.all([
    tudo<Linha>('insumos'), tudo<Linha>('produtos'), tudo<Linha>('ficha_tecnica', '*', 'id'), tudo<Linha>('categorias'),
    tudo<Linha>('contas'), tudo<Linha>('canais'), tudo<Linha>('compras', '*, compra_itens(*)'),
    tudo<Linha>('vendas', '*, venda_itens(*)'), tudo<Linha>('lancamentos'), tudo<Linha>('movimentos'),
  ]);
  const nome = (lista: Linha[]) => { const m = new Map(lista.map(x => [x.id, x.nome as string])); return (id: unknown) => (id ? m.get(id) ?? '' : ''); };
  const nIns = nome(insumos), nProd = nome(produtos), nCat = nome(categorias), nConta = nome(contas), nCanal = nome(canais);
  const n2 = (v: unknown) => Number(v ?? 0);
  const col = (t: TipoImport) => MODELOS[t].colunas.map(c => c.nome);

  const abas = [
    { nome: 'Insumos', colunas: [...col('insumos'), 'Custo médio atual', 'Estoque atual'],
      linhas: insumos.map(i => ({ 'Nome': i.nome, 'Unidade': i.unidade, 'Grupo': i.grupo, 'Estoque mínimo': n2(i.estoque_minimo),
        'Saldo inicial': '', 'Custo unitário': '', 'Custo médio atual': n2(i.custo_medio), 'Estoque atual': n2(i.estoque_atual) })) },
    { nome: 'Cardápio', colunas: col('cardapio'),
      linhas: produtos.map(p => ({ 'Nome': p.nome, 'Grupo': p.grupo, 'Preço': n2(p.preco_venda), 'À venda': p.ativo ? 'sim' : 'não' })) },
    { nome: 'Ficha técnica', colunas: col('ficha'),
      linhas: ficha.map(f => ({ 'Produto': nProd(f.produto_id), 'Insumo': nIns(f.insumo_id), 'Quantidade': n2(f.quantidade) })) },
    { nome: 'Compras', colunas: col('compras'),
      linhas: compras.flatMap(c => ((c.compra_itens as Linha[]) ?? []).map((i, k) => ({
        'Compra': String(c.id).slice(0, 8), 'Data': dataBR(c.data as string), 'Fornecedor': c.fornecedor ?? '', 'Item': i.descricao,
        'Insumo': nIns(i.insumo_id), 'Unidade': '', 'Categoria': nCat(i.categoria_id), 'Quantidade': n2(i.quantidade), 'Valor pago': n2(i.valor_total),
        'Frete': k === 0 ? n2(c.frete) : '', 'Desconto': k === 0 ? n2(c.desconto) : '', 'Parcelas': k === 0 ? c.parcelas : '',
        'Pago com': k === 0 ? nConta(c.conta_id) : '' }))) },
    { nome: 'Vendas', colunas: [...col('vendas'), 'Status', 'Total', 'Taxa do canal', 'Líquido', 'Custo'],
      linhas: vendas.flatMap(v => ((v.venda_itens as Linha[]) ?? []).map((i, k) => ({
        'Venda': v.numero, 'Data': dataBR(new Date(v.data as string).toLocaleDateString('sv-SE')), 'Canal': nCanal(v.canal_id),
        'Produto': nProd(i.produto_id), 'Quantidade': n2(i.quantidade), 'Preço': n2(i.preco_unitario),
        'Desconto': k === 0 ? n2(v.desconto) : '', 'Taxa de entrega': k === 0 ? n2(v.taxa_entrega) : '', 'Cliente': k === 0 ? v.cliente ?? '' : '',
        'Status': v.status, 'Total': k === 0 ? n2(v.total) : '', 'Taxa do canal': k === 0 ? n2(v.taxa_canal) : '',
        'Líquido': k === 0 ? n2(v.liquido) : '', 'Custo': k === 0 ? n2(v.custo_total) : '' }))) },
    { nome: 'Lançamentos', colunas: [...col('lancamentos'), 'Origem', 'Parcela'],
      linhas: lancs.map(l => ({ 'Tipo': l.tipo, 'Descrição': l.descricao, 'Categoria': nCat(l.categoria_id), 'Valor': n2(l.valor),
        'Vencimento': dataBR(l.vencimento as string), 'Pago em': dataBR(l.pago_em as string), 'Conta': nConta(l.conta_id),
        'Origem': l.origem, 'Parcela': l.parcela ?? '' })) },
    { nome: 'Movimentos de estoque', colunas: ['Data', 'Insumo', 'Tipo', 'Quantidade', 'Custo unitário', 'Origem', 'Obs'],
      linhas: movs.map(m => ({ 'Data': new Date(m.data as string).toLocaleString('pt-BR'), 'Insumo': nIns(m.insumo_id), 'Tipo': m.tipo,
        'Quantidade': n2(m.quantidade), 'Custo unitário': n2(m.custo_unitario), 'Origem': m.origem, 'Obs': m.obs ?? '' })) },
    { nome: 'Categorias', colunas: ['Nome', 'Tipo', 'Ativa'], linhas: categorias.map(c => ({ 'Nome': c.nome, 'Tipo': c.tipo, 'Ativa': c.ativo ? 'sim' : 'não' })) },
    { nome: 'Contas', colunas: ['Nome', 'Tipo', 'Saldo inicial'], linhas: contas.map(c => ({ 'Nome': c.nome, 'Tipo': c.tipo, 'Saldo inicial': n2(c.saldo_inicial) })) },
    { nome: 'Canais', colunas: ['Nome', 'Taxa %', 'Taxa fixa'], linhas: canais.map(c => ({ 'Nome': c.nome, 'Taxa %': n2(c.taxa_percentual), 'Taxa fixa': n2(c.taxa_fixa) })) },
  ];
  const hoje = new Date().toLocaleDateString('sv-SE');
  await salvarPlanilha(`hamburgueria-${hoje}.xlsx`, abas);
  return abas.map(a => `${a.nome}: ${a.linhas.length}`).join(' · ');
}

// ---------------------------------------------------------------------------
// Executar importação já validada (usa as mesmas operações do app)
// ---------------------------------------------------------------------------
export async function executarImportacao(r: Resultado, progresso: (feito: number, total: number) => void): Promise<string> {
  const exec = async <T,>(p: PromiseLike<{ error: { message: string } | null; data: T | null }>) => {
    const x = await p; if (x.error) throw new Error(x.error.message); return x.data as T;
  };
  switch (r.tipo) {
    case 'insumos': {
      for (const [k, i] of r.itens.entries()) {
        let id = i.existente_id;
        const campos = { nome: i.nome, unidade: i.unidade, grupo: i.grupo, estoque_minimo: i.estoque_minimo };
        if (id) await exec(supabase.from('insumos').update(campos).eq('id', id));
        else id = (await exec<{ id: string }>(supabase.from('insumos').insert(campos).select('id').single())).id;
        if (i.saldo_inicial) await exec(supabase.rpc('ajustar_estoque', { p_insumo: id, p_tipo: 'entrada', p_quantidade: i.saldo_inicial,
          p_motivo: 'inicial', p_custo_unitario: i.custo, p_obs: 'Importado de planilha' }));
        progresso(k + 1, r.itens.length);
      }
      return `${r.itens.length} insumos importados`;
    }
    case 'cardapio': {
      for (const [k, p] of r.itens.entries()) {
        const campos = { nome: p.nome, grupo: p.grupo, preco_venda: p.preco_venda, ativo: p.ativo };
        if (p.existente_id) await exec(supabase.from('produtos').update(campos).eq('id', p.existente_id));
        else await exec(supabase.from('produtos').insert(campos));
        progresso(k + 1, r.itens.length);
      }
      return `${r.itens.length} produtos importados`;
    }
    case 'ficha': {
      for (const [k, f] of r.itens.entries()) {
        await exec(supabase.from('ficha_tecnica').delete().eq('produto_id', f.produto_id));
        await exec(supabase.from('ficha_tecnica').insert(f.linhas.map(l => ({ produto_id: f.produto_id, ...l }))));
        progresso(k + 1, r.itens.length);
      }
      return `Ficha técnica de ${r.itens.length} produtos importada`;
    }
    case 'compras': {
      const criados = new Map<string, string>();
      for (const n of r.novos_insumos) {
        const id = (await exec<{ id: string }>(supabase.from('insumos').insert({ nome: n.nome, unidade: n.unidade }).select('id').single())).id;
        criados.set(n.nome.toLowerCase(), id);
      }
      for (const [k, c] of r.itens.entries()) {
        await exec(supabase.rpc('registrar_compra', { p: {
          data: c.data, fornecedor: c.fornecedor, conta_id: c.conta_id, frete: c.frete, desconto: c.desconto, parcelas: c.parcelas,
          pago: c.parcelas === 1,
          itens: c.itens.map(i => ({ insumo_id: i.insumo_id ?? (i.insumo_novo ? criados.get(i.insumo_novo.toLowerCase()) : null),
            categoria_id: i.categoria_id, descricao: i.descricao, quantidade: i.quantidade, valor_total: i.valor_total })),
        } }));
        progresso(k + 1, r.itens.length);
      }
      return `${r.itens.length} compras importadas`;
    }
    case 'vendas': {
      for (const [k, v] of r.itens.entries()) {
        await exec(supabase.rpc('registrar_venda', { p: {
          data: `${v.data}T12:00:00-03:00`, canal_id: v.canal_id, cliente: v.cliente, desconto: v.desconto, taxa_entrega: v.taxa_entrega, itens: v.itens,
        } }));
        progresso(k + 1, r.itens.length);
      }
      return `${r.itens.length} vendas importadas`;
    }
    case 'lancamentos': {
      for (let i = 0; i < r.itens.length; i += 200) {
        await exec(supabase.from('lancamentos').insert(r.itens.slice(i, i + 200)));
        progresso(Math.min(i + 200, r.itens.length), r.itens.length);
      }
      return `${r.itens.length} lançamentos importados`;
    }
  }
}

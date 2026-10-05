import { supabase } from './supabase';

// ---------- Tipos (espelham o banco) ----------
export type TipoCategoria = 'receita' | 'despesa' | 'estoque' | 'investimento';
export interface Categoria { id: string; nome: string; tipo: TipoCategoria; ativo: boolean }
export interface Conta { id: string; nome: string; tipo: 'empresa' | 'dono'; saldo_inicial: number; ativo: boolean }
export interface ContaSaldo extends Conta { saldo: number }
export interface Canal { id: string; nome: string; taxa_percentual: number; taxa_fixa: number; ativo: boolean }
export interface Insumo {
  id: string; nome: string; unidade: string; grupo: string;
  estoque_minimo: number; estoque_atual: number; custo_medio: number; ativo: boolean;
}
export interface Produto { id: string; nome: string; grupo: string; preco_venda: number; ativo: boolean }
export interface ProdutoCusto extends Produto { custo: number; itens_ficha: number; margem_bruta: number }
export interface FichaItem { id: string; produto_id: string; insumo_id: string; quantidade: number }
export interface VendaItem { id: string; produto_id: string; quantidade: number; preco_unitario: number; custo_unitario: number; produtos: { nome: string } | null }
export interface Venda {
  id: string; numero: number; data: string; canal_id: string; conta_id: string | null; cliente: string | null;
  subtotal: number; desconto: number; taxa_entrega: number; total: number; taxa_canal: number; liquido: number;
  custo_total: number; status: 'concluida' | 'cancelada'; obs: string | null;
  canais: { nome: string } | null; venda_itens: VendaItem[];
}
export interface CompraItem { id: string; insumo_id: string | null; categoria_id: string | null; descricao: string; quantidade: number; valor_total: number }
export interface Compra {
  id: string; data: string; fornecedor: string | null; conta_id: string | null; frete: number; desconto: number;
  total: number; parcelas: number; primeiro_vencimento: string | null; obs: string | null; compra_itens: CompraItem[];
}
export interface Lancamento {
  id: string; tipo: 'receita' | 'despesa'; categoria_id: string; descricao: string; valor: number;
  vencimento: string; pago_em: string | null; conta_id: string | null; origem: 'manual' | 'compra' | 'venda';
  compra_id: string | null; venda_id: string | null; parcela: string | null;
  categorias: { nome: string; tipo: TipoCategoria } | null; contas: { nome: string } | null;
}
export interface Movimento {
  id: string; insumo_id: string; data: string; tipo: 'entrada' | 'saida'; quantidade: number; custo_unitario: number;
  origem: string; obs: string | null; compra_id: string | null; venda_id: string | null;
}
export interface Painel {
  periodo: { inicio: string; fim: string };
  vendas: { quantidade: number; faturamento: number; taxas_canal: number; liquido: number; cmv: number; lucro_bruto: number; ticket_medio: number };
  despesas_operacionais: number; despesas_operacionais_pagas: number; compras_estoque: number; outras_receitas: number;
  resultado: number; caixa_empresa: number; contas: { nome: string; tipo: string; saldo: number }[];
  a_pagar_30d: number; vencidas: number; investimento_total: number; aportado_do_bolso: number;
  resultado_acumulado: number; retorno_percentual: number | null;
  estoque_baixo: { nome: string; unidade: string; estoque: number; minimo: number }[];
  mais_vendidos: { produto: string; quantidade: number; faturamento: number }[];
  por_canal: { canal: string; vendas: number; faturamento: number; taxas: number }[];
}

// ---------- Helpers ----------
function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export type Tabela = 'categorias' | 'contas' | 'canais' | 'insumos' | 'produtos' | 'ficha_tecnica' | 'lancamentos';

export async function listar<T>(tabela: Tabela | 'v_produtos_custo' | 'v_saldos_contas', ordem = 'nome'): Promise<T[]> {
  return ok(await supabase.from(tabela).select('*').order(ordem)) as T[];
}

/** Insere (sem id) ou atualiza (com id). Envia só os campos informados. */
export async function salvar(tabela: Tabela, linha: { id?: string } & Record<string, unknown>): Promise<string> {
  const { id, ...campos } = linha;
  if (id) {
    ok(await supabase.from(tabela).update(campos).eq('id', id));
    return id;
  }
  const r = ok(await supabase.from(tabela).insert(campos).select('id').single()) as { id: string };
  return r.id;
}

export async function excluir(tabela: Tabela, id: string) {
  ok(await supabase.from(tabela).delete().eq('id', id));
}

// ---------- Leituras específicas ----------
export const painel = async (inicio: string, fim: string) =>
  ok(await supabase.rpc('painel', { p_inicio: inicio, p_fim: fim })) as Painel;

export async function vendasPeriodo(inicioISO: string, fimISO: string): Promise<Venda[]> {
  return ok(await supabase.from('vendas')
    .select('*, canais(nome), venda_itens(*, produtos(nome))')
    .gte('data', inicioISO).lte('data', fimISO)
    .order('data', { ascending: false })) as Venda[];
}

export async function compras(limite = 200): Promise<Compra[]> {
  return ok(await supabase.from('compras').select('*, compra_itens(*)')
    .order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(limite)) as Compra[];
}

export async function lancamentos(filtro: { de?: string; ate?: string; abertos?: boolean; pagosDe?: string; pagosAte?: string } = {}): Promise<Lancamento[]> {
  let q = supabase.from('lancamentos').select('*, categorias(nome, tipo), contas(nome)');
  if (filtro.de) q = q.gte('vencimento', filtro.de);
  if (filtro.ate) q = q.lte('vencimento', filtro.ate);
  if (filtro.abertos) q = q.is('pago_em', null);
  if (filtro.pagosDe) q = q.gte('pago_em', filtro.pagosDe);
  if (filtro.pagosAte) q = q.lte('pago_em', filtro.pagosAte);
  const ordem = filtro.pagosDe ? 'pago_em' : 'vencimento';
  return ok(await q.order(ordem, { ascending: !filtro.pagosDe }).order('criado_em')) as Lancamento[];
}

/** Insere vários lançamentos manuais de uma vez (ex.: repetir mensalmente) */
export async function inserirLancamentos(linhas: Omit<Lancamento, 'id' | 'origem' | 'compra_id' | 'venda_id' | 'categorias' | 'contas'>[]) {
  ok(await supabase.from('lancamentos').insert(linhas));
}

export async function movimentosInsumo(insumoId: string): Promise<Movimento[]> {
  return ok(await supabase.from('movimentos').select('*').eq('insumo_id', insumoId)
    .order('data', { ascending: false }).limit(100)) as Movimento[];
}

export async function fichaDoProduto(produtoId: string): Promise<FichaItem[]> {
  return ok(await supabase.from('ficha_tecnica').select('*').eq('produto_id', produtoId)) as FichaItem[];
}

export async function fichaCompleta(): Promise<FichaItem[]> {
  return ok(await supabase.from('ficha_tecnica').select('*')) as FichaItem[];
}

// ---------- Operações (RPC: o banco garante estoque e financeiro) ----------
export interface NovaVenda {
  canal_id: string; conta_id?: string | null; cliente?: string; desconto?: number; taxa_entrega?: number;
  data?: string; obs?: string; itens: { produto_id: string; quantidade: number; preco_unitario?: number }[];
}
export const registrarVenda = async (v: NovaVenda) => ok(await supabase.rpc('registrar_venda', { p: v })) as string;
export const cancelarVenda = async (id: string) => { ok(await supabase.rpc('cancelar_venda', { p_id: id })); };

export interface NovaCompra {
  id?: string; data: string; fornecedor?: string; conta_id?: string | null; frete?: number; desconto?: number;
  parcelas?: number; primeiro_vencimento?: string | null; pago?: boolean; obs?: string;
  itens: { insumo_id?: string | null; categoria_id?: string | null; descricao: string; quantidade: number; valor_total: number }[];
}
export const registrarCompra = async (c: NovaCompra) => ok(await supabase.rpc('registrar_compra', { p: c })) as string;
export const excluirCompra = async (id: string) => { ok(await supabase.rpc('excluir_compra', { p_id: id })); };

export const ajustarEstoque = async (insumo: string, tipo: 'entrada' | 'saida', quantidade: number,
  motivo: 'ajuste' | 'perda' | 'inicial', custo?: number | null, obs?: string) => {
  ok(await supabase.rpc('ajustar_estoque', {
    p_insumo: insumo, p_tipo: tipo, p_quantidade: quantidade, p_motivo: motivo,
    p_custo_unitario: custo ?? null, p_obs: obs ?? null,
  }));
};
export const contarEstoque = async (insumo: string, quantidade: number) =>
  ok(await supabase.rpc('contar_estoque', { p_insumo: insumo, p_quantidade_contada: quantidade })) as number;
export const excluirMovimento = async (id: string) => { ok(await supabase.rpc('excluir_movimento', { p_id: id })); };

export const pagarLancamento = async (id: string, pagoEm: string | null, contaId: string | null) => {
  ok(await supabase.from('lancamentos').update({ pago_em: pagoEm, conta_id: contaId }).eq('id', id));
};

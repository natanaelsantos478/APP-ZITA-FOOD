import { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Share2, ChefHat } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  listar, salvar, compras as listarCompras, registrarCompra, excluirCompra, movimentosInsumo, ajustarEstoque, contarEstoque,
  excluirMovimento, receitaDoPreparo, produzirPreparo, listaCompras,
  type Insumo, type Compra, type Categoria, type Conta, type Movimento, type NovaCompra, type SugestaoCompra,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { reais, num, lerNumero, hojeISO, dataBR, dataHoraBR, chave } from '../lib/formato';
import { Botao, Cabecalho, Campo, CampoNumero, Carregando, Erro, Folha, Segmento, Vazio, avisar, dadosMudaram, useDados } from '../ui/base';

let kRec = 0;
export const UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'fatia', 'pct', 'cx', 'lata', 'garrafa'];
export const GRUPOS_INSUMO = ['Ingrediente', 'Embalagem', 'Bebida', 'Limpeza', 'Outro'];

export default function Estoque() {
  const [aba, setAba] = useState<'insumos' | 'lista' | 'compras'>('insumos');
  return (
    <>
      <Cabecalho titulo="Estoque" />
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Segmento rotulo="Ver" valor={aba} onChange={setAba} opcoes={[
          { valor: 'insumos', texto: 'O que tenho' }, { valor: 'lista', texto: 'Lista de compras' }, { valor: 'compras', texto: 'Compras' },
        ]} />
        {aba === 'insumos' && <ListaInsumos />}
        {aba === 'lista' && <ListaDeCompras irParaCompras={() => setAba('compras')} />}
        {aba === 'compras' && <ListaCompras />}
      </main>
    </>
  );
}

// =============================================================================
// Insumos
// =============================================================================
function ListaInsumos() {
  const { dados, erro, recarregar } = useDados(() => listar<Insumo>('insumos'));
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<Insumo | 'novo' | null>(null);
  const [verInativos, setVerInativos] = useState(false);

  const grupos = useMemo(() => {
    const g = new Map<string, Insumo[]>();
    (dados ?? []).filter(i => (verInativos || i.ativo) && chave(i.nome).includes(chave(busca)))
      .forEach(i => g.set(i.grupo, [...(g.get(i.grupo) ?? []), i]));
    return [...g.entries()];
  }, [dados, busca, verInativos]);
  const valorEstoque = (dados ?? []).reduce((s, i) => s + Math.max(0, Number(i.estoque_atual)) * Number(i.custo_medio), 0);

  if (erro) return <Erro texto={erro} tentar={recarregar} />;
  if (!dados) return <Carregando />;
  return (
    <>
      <div className="flex gap-2 mt-4">
        <label className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-chapa-3" />
          <input className="campo pl-10" placeholder="Buscar insumo" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar insumo" />
        </label>
        <Botao onClick={() => setAberto('novo')} rotulo="Novo insumo"><Plus size={20} />Novo</Botao>
      </div>
      {dados.length > 0 && <p className="text-sm text-chapa-3 mt-2">Valor parado no estoque: <span className="valor font-semibold text-chapa">{reais(valorEstoque)}</span></p>}
      {dados.length === 0 && <Vazio texto="Cadastre o que você compra: carne, pão, queijo, embalagens. O saldo sobe nas compras e desce sozinho nas vendas." />}
      {grupos.map(([grupo, lista]) => (
        <section key={grupo} className="mt-4">
          <h2 className="text-chapa-2 font-semibold mb-2">{grupo}</h2>
          <ul className="rounded-2xl bg-white border border-linha divide-y divide-linha">
            {lista.map(i => {
              const baixo = Number(i.estoque_atual) <= Number(i.estoque_minimo) && (Number(i.estoque_minimo) > 0 || Number(i.estoque_atual) < 0);
              return (
                <li key={i.id}>
                  <button onClick={() => setAberto(i)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-fundo">
                    <span className="min-w-0">
                      <span className={`block font-medium truncate ${i.ativo ? '' : 'line-through text-chapa-3'}`}>{i.nome}{i.preparado && <span className="ml-2 text-xs font-semibold text-chapa-2 bg-kraft rounded-full px-2 py-0.5 align-middle">preparo</span>}</span>
                      <span className="block text-sm text-chapa-3">{reais(i.custo_medio)} / {i.unidade}</span>
                    </span>
                    <span className={`valor text-lg font-bold shrink-0 ${baixo ? 'text-ketchup' : ''}`}>
                      {num(i.estoque_atual)} <span className="text-sm font-medium text-chapa-3">{i.unidade}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {dados.some(i => !i.ativo) && (
        <Botao tipo="texto" onClick={() => setVerInativos(v => !v)} className="mt-2">{verInativos ? 'Esconder desativados' : 'Mostrar desativados'}</Botao>
      )}
      <FolhaInsumo insumo={aberto} onFechar={() => setAberto(null)} />
    </>
  );
}

function FolhaInsumo({ insumo, onFechar }: { insumo: Insumo | 'novo' | null; onFechar: () => void }) {
  const novo = insumo === 'novo';
  const atual = insumo && insumo !== 'novo' ? insumo : null;
  const [form, setForm] = useState({ nome: '', unidade: 'un', grupo: 'Ingrediente', minimo: '', ativo: true, preparado: false, rendimento: '1' });
  const [chaveForm, setChaveForm] = useState<string | null>(null);
  const [acao, setAcao] = useState<'contar' | 'perda' | 'entrada' | 'produzir' | null>(null);
  const [receita, setReceita] = useState<{ k: number; insumo_id: string; quantidade: string }[]>([]);
  const { dados: todos } = useDados(() => listar<Insumo>('insumos'));
  const [qtd, setQtd] = useState(''); const [custo, setCusto] = useState(''); const [obs, setObs] = useState('');
  const [movs, setMovs] = useState<Movimento[] | null>(null);

  const id = novo ? 'novo' : atual?.id ?? null;
  if (id !== chaveForm) {
    setChaveForm(id);
    setForm(atual ? { nome: atual.nome, unidade: atual.unidade, grupo: atual.grupo, minimo: String(atual.estoque_minimo).replace('.', ','), ativo: atual.ativo,
                      preparado: atual.preparado, rendimento: String(atual.rendimento).replace('.', ',') }
                  : { nome: '', unidade: 'un', grupo: 'Ingrediente', minimo: '', ativo: true, preparado: false, rendimento: '1' });
    setAcao(null); setQtd(''); setCusto(''); setObs(''); setMovs(null); setReceita([]);
    if (atual) movimentosInsumo(atual.id).then(setMovs).catch(() => setMovs([]));
    if (atual?.preparado) receitaDoPreparo(atual.id).then(l => setReceita(l.map(x => ({ k: ++kRec, insumo_id: x.insumo_id, quantidade: String(x.quantidade).replace('.', ',') })))).catch(() => setReceita([]));
  }

  async function gravar() {
    if (!form.nome.trim()) throw new Error('Dê um nome ao insumo');
    const rend = lerNumero(form.rendimento);
    const linhas = receita.filter(l => l.insumo_id || l.quantidade);
    if (form.preparado) {
      if (!rend || rend <= 0) throw new Error('Informe quantas unidades a receita rende');
      const vistos = new Set<string>();
      for (const [n, l] of linhas.entries()) {
        if (!l.insumo_id) throw new Error(`Receita, linha ${n + 1}: escolha o insumo`);
        if (vistos.has(l.insumo_id)) throw new Error('Um insumo aparece duas vezes na receita');
        vistos.add(l.insumo_id);
        const q = lerNumero(l.quantidade); if (!q || q <= 0) throw new Error(`Receita, linha ${n + 1}: quantidade inválida`);
      }
    }
    const idIns = await salvar('insumos', { id: atual?.id, nome: form.nome.trim(), unidade: form.unidade.trim() || 'un', grupo: form.grupo,
      estoque_minimo: lerNumero(form.minimo) ?? 0, ativo: form.ativo, preparado: form.preparado, rendimento: form.preparado ? rend! : 1 });
    if (form.preparado || atual?.preparado) {
      const d = await supabase.from('receita_preparo').delete().eq('preparado_id', idIns);
      if (d.error) throw new Error(d.error.message);
      if (form.preparado && linhas.length) {
        const r = await supabase.from('receita_preparo').insert(linhas.map(l => ({ preparado_id: idIns, insumo_id: l.insumo_id, quantidade: lerNumero(l.quantidade) })));
        if (r.error) throw new Error(r.error.message);
      }
    }
    avisar(novo ? 'Insumo cadastrado' : 'Insumo salvo');
    dadosMudaram(); onFechar();
  }

  async function executar() {
    const q = lerNumero(qtd);
    if (q === null || q < 0 || (acao !== 'contar' && q === 0)) throw new Error('Informe uma quantidade válida');
    if (acao === 'contar') {
      const dif = await contarEstoque(atual!.id, q);
      avisar(dif === 0 ? 'Estoque conferido: está certo' : `Ajustado: ${dif > 0 ? '+' : ''}${num(dif)} ${atual!.unidade}`);
    } else if (acao === 'produzir') {
      await produzirPreparo(atual!.id, q, obs || undefined);
      avisar(`Produzido: ${num(q)} ${atual!.unidade}`);
    } else if (acao === 'perda') {
      await ajustarEstoque(atual!.id, 'saida', q, 'perda', null, obs || undefined);
      avisar('Perda registrada');
    } else {
      await ajustarEstoque(atual!.id, 'entrada', q, 'inicial', lerNumero(custo), obs || undefined);
      avisar('Entrada registrada');
    }
    dadosMudaram(); onFechar();
  }

  const nomeOrigem: Record<string, string> = { compra: 'Compra', venda: 'Venda', ajuste: 'Ajuste', perda: 'Perda', contagem: 'Contagem', inicial: 'Entrada manual', producao: 'Preparo' };
  const mapa = new Map((todos ?? []).map(i => [i.id, i]));
  const rendN = lerNumero(form.rendimento) ?? 0;
  const custoLote = receita.reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0) * Number(mapa.get(l.insumo_id)?.custo_medio ?? 0), 0);

  return (
    <Folha aberta={!!insumo} titulo={novo ? 'Novo insumo' : atual?.nome ?? ''} onFechar={onFechar}
      rodape={acao
        ? <div className="flex gap-2"><Botao tipo="secundario" largo onClick={() => setAcao(null)}>Voltar</Botao><Botao largo onClick={executar}>Confirmar</Botao></div>
        : <Botao largo onClick={gravar}>{novo ? 'Cadastrar insumo' : 'Salvar alterações'}</Botao>}>
      {atual && !acao && (
        <div className="rounded-2xl bg-kraft p-4 mb-4">
          <div className="flex justify-between items-baseline">
            <span className="text-chapa-2">Tenho agora</span>
            <span className="valor text-2xl font-extrabold">{num(atual.estoque_atual)} {atual.unidade}</span>
          </div>
          <div className="flex justify-between text-sm text-chapa-2 mt-1"><span>Custo médio</span><span className="valor">{reais(atual.custo_medio)} / {atual.unidade}</span></div>
          {atual.preparado && <Botao largo onClick={() => setAcao('produzir')} className="mt-3"><ChefHat size={18} />Produzi</Botao>}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <Botao tipo="secundario" onClick={() => setAcao('contar')} className="text-[14px] px-2">Contei</Botao>
            <Botao tipo="secundario" onClick={() => setAcao('perda')} className="text-[14px] px-2">Perdi</Botao>
            <Botao tipo="secundario" onClick={() => setAcao('entrada')} className="text-[14px] px-2">Entrada</Botao>
          </div>
        </div>
      )}

      {acao && atual && (
        <div>
          {acao === 'contar' && <Campo rotulo={`Quanto tem de verdade (${atual.unidade})?`} dica={`O app diz ${num(atual.estoque_atual)}. A diferença é lançada sozinha.`}>
            <CampoNumero valor={qtd} onChange={setQtd} autoFocus /></Campo>}
          {acao === 'produzir' && <>
            <Campo rotulo={`Quanto produziu (${atual.unidade})?`} dica={`A receita rende ${num(atual.rendimento)} ${atual.unidade}. Os ingredientes saem do estoque na proporção.`}>
              <CampoNumero valor={qtd} onChange={setQtd} autoFocus /></Campo>
            {(lerNumero(qtd) ?? 0) > 0 && receita.length > 0 && (
              <ul className="text-sm text-chapa-2 space-y-1 mb-2">
                {receita.map(l => { const ins = mapa.get(l.insumo_id); const usa = (lerNumero(l.quantidade) ?? 0) * (lerNumero(qtd) ?? 0) / Number(atual.rendimento);
                  return <li key={l.k}>Usa {num(usa)} {ins?.unidade} de {ins?.nome} (tem {num(ins?.estoque_atual)})</li>; })}
              </ul>
            )}
          </>}
          {acao === 'perda' && <>
            <Campo rotulo={`Quanto perdeu (${atual.unidade})?`} dica="Estragou, caiu, consumo próprio…"><CampoNumero valor={qtd} onChange={setQtd} autoFocus /></Campo>
            <Campo rotulo="Motivo (opcional)"><input className="campo" value={obs} onChange={e => setObs(e.target.value)} /></Campo>
          </>}
          {acao === 'entrada' && <>
            <p className="text-sm text-chapa-2 mb-3">Use para o que você já tinha antes de usar o app. Compras novas: registre em Compras, para lançar o dinheiro também.</p>
            <Campo rotulo={`Quantidade (${atual.unidade})`}><CampoNumero valor={qtd} onChange={setQtd} autoFocus /></Campo>
            <Campo rotulo={`Custo por ${atual.unidade} (R$)`} dica="Vazio = custo médio atual"><CampoNumero valor={custo} onChange={setCusto} /></Campo>
          </>}
        </div>
      )}

      {!acao && (
        <>
          <Campo rotulo="Nome"><input className="campo" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Unidade">
              <input className="campo" list="unidades" value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })} />
              <datalist id="unidades">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>
            </Campo>
            <Campo rotulo="Grupo">
              <select className="campo" value={form.grupo} onChange={e => setForm({ ...form, grupo: e.target.value })}>
                {[...new Set([...GRUPOS_INSUMO, form.grupo])].map(g => <option key={g}>{g}</option>)}
              </select>
            </Campo>
          </div>
          <Campo rotulo="Avisar quando ficar abaixo de" dica="Deixe 0 para não avisar"><CampoNumero valor={form.minimo} onChange={v => setForm({ ...form, minimo: v })} placeholder="0" /></Campo>
          <label className="flex items-center gap-3 py-2">
            <input type="checkbox" className="w-5 h-5 accent-chapa" checked={form.preparado} onChange={e => setForm({ ...form, preparado: e.target.checked })} />
            É um pré-preparo (eu produzo: blend, molho da casa…)
          </label>
          {form.preparado && (
            <section className="rounded-2xl border border-linha bg-white p-3 mb-3">
              <Campo rotulo={`A receita abaixo rende quantos ${form.unidade || 'un'}?`}><CampoNumero valor={form.rendimento} onChange={v => setForm({ ...form, rendimento: v })} /></Campo>
              <p className="text-sm text-chapa-2 mb-2">Ingredientes de um lote (ex.: 1 kg de carne + 10 g de sal rendem 6 blends).</p>
              <ul className="space-y-2">
                {receita.map((l, n) => (
                  <li key={l.k} className="flex gap-2">
                    <select className="campo flex-1 min-w-0" aria-label={`Ingrediente ${n + 1} da receita`} value={l.insumo_id}
                      onChange={e => setReceita(r => r.map(x => x.k === l.k ? { ...x, insumo_id: e.target.value } : x))}>
                      <option value="">Ingrediente…</option>
                      {(todos ?? []).filter(i => i.id !== atual?.id && !i.preparado && (i.ativo || i.id === l.insumo_id)).map(i => <option key={i.id} value={i.id}>{i.nome} ({i.unidade})</option>)}
                    </select>
                    <div className="w-24 shrink-0"><CampoNumero rotulo={`Quantidade do ingrediente ${n + 1}`} valor={l.quantidade} placeholder={mapa.get(l.insumo_id)?.unidade ?? 'qtd'}
                      onChange={v => setReceita(r => r.map(x => x.k === l.k ? { ...x, quantidade: v } : x))} /></div>
                    <button aria-label={`Remover ingrediente ${n + 1}`} className="p-2 text-chapa-3" onClick={() => setReceita(r => r.filter(x => x.k !== l.k))}><Trash2 size={18} /></button>
                  </li>
                ))}
              </ul>
              <Botao tipo="secundario" largo className="mt-2" onClick={() => setReceita(r => [...r, { k: ++kRec, insumo_id: '', quantidade: '' }])}><Plus size={18} />Adicionar ingrediente</Botao>
              {receita.length > 0 && rendN > 0 && (
                <p className="mt-2 text-[15px]">Custo do lote <span className="valor font-semibold">{reais(custoLote)}</span> · por {form.unidade || 'un'} <span className="valor font-bold">{reais(custoLote / rendN)}</span></p>
              )}
            </section>
          )}
          {atual && (
            <label className="flex items-center gap-3 py-2">
              <input type="checkbox" className="w-5 h-5 accent-chapa" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
              Em uso (desmarque para esconder sem apagar)
            </label>
          )}
          {atual && (
            <section className="mt-4">
              <h3 className="font-semibold mb-2">Últimas movimentações</h3>
              {!movs && <Carregando />}
              {movs?.length === 0 && <p className="text-chapa-3">Nenhuma ainda.</p>}
              <ul className="divide-y divide-linha">
                {movs?.map(m => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-[15px]">
                    <span className="min-w-0">
                      <span className="block">{nomeOrigem[m.origem] ?? m.origem}{m.obs ? ` · ${m.obs}` : ''}</span>
                      <span className="block text-xs text-chapa-3">{dataHoraBR(m.data)}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className={`valor font-semibold ${m.tipo === 'saida' ? 'text-ketchup' : 'text-picles'}`}>{m.tipo === 'saida' ? '−' : '+'}{num(m.quantidade)}</span>
                      {['ajuste', 'perda', 'contagem', 'inicial', 'producao'].includes(m.origem) && (
                        <button aria-label={m.origem === 'producao' ? 'Desfazer este preparo inteiro' : 'Desfazer este ajuste'} className="p-2 text-chapa-3"
                          onClick={async () => { await excluirMovimento(m.id); avisar(m.origem === 'producao' ? 'Preparo desfeito' : 'Ajuste desfeito'); dadosMudaram(); onFechar(); }}><Trash2 size={16} /></button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Folha>
  );
}

// =============================================================================
// Compras
// =============================================================================
function ListaCompras() {
  const { dados, erro, recarregar } = useDados(() => listarCompras());
  const [aberta, setAberta] = useState<Compra | 'nova' | null>(null);
  if (erro) return <Erro texto={erro} tentar={recarregar} />;
  if (!dados) return <Carregando />;
  return (
    <>
      <Botao largo onClick={() => setAberta('nova')} className="mt-4"><Plus size={20} />Registrar compra</Botao>
      {dados.length === 0 && <Vazio texto="Registre aqui tudo o que comprar: mercado, Mercado Livre, equipamentos. O estoque e as contas a pagar se atualizam sozinhos." />}
      <ul className="mt-4 rounded-2xl bg-white border border-linha divide-y divide-linha empty:hidden">
        {dados.map(c => (
          <li key={c.id}>
            <button onClick={() => setAberta(c)} className="w-full flex justify-between gap-3 px-4 py-3 text-left active:bg-fundo">
              <span className="min-w-0">
                <span className="block font-medium truncate">{c.fornecedor || 'Compra'}</span>
                <span className="block text-sm text-chapa-3">
                  {dataBR(c.data)} · {c.compra_itens.length} {c.compra_itens.length === 1 ? 'item' : 'itens'}{c.parcelas > 1 ? ` · ${c.parcelas}x` : ''}
                </span>
              </span>
              <span className="valor font-bold shrink-0">{reais(c.total)}</span>
            </button>
          </li>
        ))}
      </ul>
      <FolhaCompra compra={aberta} onFechar={() => setAberta(null)} />
    </>
  );
}

interface ItemForm { k: number; tipo: 'estoque' | 'outro'; insumo_id: string; categoria_id: string; descricao: string; quantidade: string; valor: string }
let kSeq = 0;
const itemVazio = (): ItemForm => ({ k: ++kSeq, tipo: 'estoque', insumo_id: '', categoria_id: '', descricao: '', quantidade: '1', valor: '' });
const br = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

export function FolhaCompra({ compra, onFechar, preenchimento }: {
  compra: Compra | 'nova' | null; onFechar: () => void;
  preenchimento?: { insumo_id: string; quantidade: number; valor: number | null }[];
}) {
  const { dados: cad } = useDados(async () => {
    const [insumos, categorias, contas] = await Promise.all([listar<Insumo>('insumos'), listar<Categoria>('categorias'), listar<Conta>('contas')]);
    return { insumos: insumos.filter(i => i.ativo && !i.preparado), categorias: categorias.filter(c => c.ativo && c.tipo !== 'receita' && c.tipo !== 'estoque'), contas: contas.filter(c => c.ativo) };
  });
  const atual = compra && compra !== 'nova' ? compra : null;
  const [chaveForm, setChaveForm] = useState<string | null>(null);
  const [f, setF] = useState({ data: hojeISO(), fornecedor: '', conta_id: '', parcelas: '1', primeiro: '', frete: '', desconto: '', pago: true });
  const [itens, setItens] = useState<ItemForm[]>([itemVazio()]);
  const [novoInsumo, setNovoInsumo] = useState<{ k: number; nome: string; unidade: string; grupo: string } | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const id = compra === 'nova' ? 'nova' : atual?.id ?? null;
  if (id !== chaveForm) {
    setChaveForm(id);
    setConfirmarExclusao(false);
    if (atual) {
      setF({ data: atual.data, fornecedor: atual.fornecedor ?? '', conta_id: atual.conta_id ?? '', parcelas: String(atual.parcelas),
             primeiro: atual.parcelas > 1 ? atual.primeiro_vencimento ?? '' : '', frete: br(atual.frete || null), desconto: br(atual.desconto || null), pago: true });
      setItens(atual.compra_itens.map(i => ({ k: ++kSeq, tipo: i.insumo_id ? 'estoque' : 'outro', insumo_id: i.insumo_id ?? '',
        categoria_id: i.categoria_id ?? '', descricao: i.descricao, quantidade: br(i.quantidade), valor: br(i.valor_total) })));
    } else {
      setF({ data: hojeISO(), fornecedor: '', conta_id: '', parcelas: '1', primeiro: '', frete: '', desconto: '', pago: true });
      setItens(preenchimento?.length
        ? preenchimento.map(p => ({ ...itemVazio(), insumo_id: p.insumo_id, quantidade: br(p.quantidade), valor: p.valor ? br(Math.round(p.valor * 100) / 100) : '' }))
        : [itemVazio()]);
    }
  }
  if (cad && !f.conta_id && cad.contas[0]) setF(x => ({ ...x, conta_id: cad.contas.find(c => c.tipo === 'empresa')?.id ?? cad.contas[0].id }));

  const somaItens = itens.reduce((s, i) => s + (lerNumero(i.valor) ?? 0), 0);
  const total = somaItens + (lerNumero(f.frete) ?? 0) - (lerNumero(f.desconto) ?? 0);
  const parcelas = Math.max(1, Math.min(36, Math.trunc(lerNumero(f.parcelas) ?? 1)));
  const mudarItem = (k: number, campos: Partial<ItemForm>) => setItens(l => l.map(i => i.k === k ? { ...i, ...campos } : i));

  async function criarInsumo() {
    if (!novoInsumo?.nome.trim()) throw new Error('Dê um nome ao insumo');
    const idNovo = await salvar('insumos', { nome: novoInsumo.nome.trim(), unidade: novoInsumo.unidade || 'un', grupo: novoInsumo.grupo });
    cad!.insumos.push({ id: idNovo, nome: novoInsumo.nome.trim(), unidade: novoInsumo.unidade || 'un', grupo: novoInsumo.grupo,
      estoque_minimo: 0, estoque_atual: 0, custo_medio: 0, ativo: true, preparado: false, rendimento: 1 });
    mudarItem(novoInsumo.k, { insumo_id: idNovo });
    setNovoInsumo(null);
    dadosMudaram();
  }

  async function gravar() {
    const lista: NovaCompra['itens'] = [];
    for (const [n, i] of itens.entries()) {
      const q = lerNumero(i.quantidade); const v = lerNumero(i.valor);
      if (!i.insumo_id && !i.categoria_id && !i.descricao.trim() && !i.valor) continue; // linha vazia
      if (i.tipo === 'estoque' && !i.insumo_id) throw new Error(`Item ${n + 1}: escolha o insumo`);
      if (i.tipo === 'outro' && !i.categoria_id) throw new Error(`Item ${n + 1}: escolha a categoria`);
      if (i.tipo === 'outro' && !i.descricao.trim()) throw new Error(`Item ${n + 1}: descreva o que foi comprado`);
      if (!q || q <= 0) throw new Error(`Item ${n + 1}: quantidade inválida`);
      if (v === null || v < 0) throw new Error(`Item ${n + 1}: valor inválido`);
      lista.push({ insumo_id: i.tipo === 'estoque' ? i.insumo_id : null, categoria_id: i.tipo === 'outro' ? i.categoria_id : null,
        descricao: i.descricao.trim(), quantidade: q, valor_total: v });
    }
    if (!lista.length) throw new Error('Adicione pelo menos um item');
    if (total < 0) throw new Error('O desconto é maior que a compra');
    await registrarCompra({ id: atual?.id, data: f.data, fornecedor: f.fornecedor.trim() || undefined, conta_id: f.conta_id || null,
      frete: lerNumero(f.frete) ?? 0, desconto: lerNumero(f.desconto) ?? 0, parcelas, pago: parcelas === 1 ? f.pago : false,
      primeiro_vencimento: parcelas > 1 && f.primeiro ? f.primeiro : null, itens: lista });
    avisar(atual ? 'Compra atualizada' : `Compra registrada: ${reais(total)}`);
    dadosMudaram(); onFechar();
  }

  return (
    <Folha aberta={!!compra} titulo={atual ? 'Compra' : 'Registrar compra'} onFechar={onFechar}
      rodape={<div>
        <div className="flex justify-between items-baseline mb-2"><span className="text-chapa-2">Total pago</span><span className="valor text-2xl font-extrabold">{reais(total)}</span></div>
        <Botao largo onClick={gravar}>{atual ? 'Salvar compra' : 'Registrar compra'}</Botao>
      </div>}>
      {!cad && <Carregando />}
      {cad && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Data"><input type="date" className="campo" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
            <Campo rotulo="Onde comprou"><input className="campo" placeholder="Atacadão, ML…" value={f.fornecedor} onChange={e => setF({ ...f, fornecedor: e.target.value })} /></Campo>
          </div>

          <h3 className="font-semibold mt-2 mb-2">Itens</h3>
          <ul className="space-y-3">
            {itens.map((i, n) => {
              const ins = cad.insumos.find(x => x.id === i.insumo_id);
              const q = lerNumero(i.quantidade); const v = lerNumero(i.valor);
              return (
                <li key={i.k} className="rounded-2xl border border-linha bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <Segmento rotulo={`Tipo do item ${n + 1}`} valor={i.tipo} onChange={t => mudarItem(i.k, { tipo: t })} opcoes={[
                      { valor: 'estoque', texto: 'Vai pro estoque' }, { valor: 'outro', texto: 'Outra coisa' },
                    ]} />
                    {itens.length > 1 && <button aria-label={`Remover item ${n + 1}`} className="p-2 text-chapa-3" onClick={() => setItens(l => l.filter(x => x.k !== i.k))}><Trash2 size={18} /></button>}
                  </div>
                  {i.tipo === 'estoque' ? (
                    <Campo rotulo="Insumo">
                      <select className="campo" value={i.insumo_id} onChange={e => e.target.value === '+'
                        ? setNovoInsumo({ k: i.k, nome: '', unidade: 'un', grupo: 'Ingrediente' }) : mudarItem(i.k, { insumo_id: e.target.value })}>
                        <option value="">Escolha…</option>
                        {cad.insumos.map(x => <option key={x.id} value={x.id}>{x.nome} ({x.unidade})</option>)}
                        <option value="+">+ Cadastrar novo insumo</option>
                      </select>
                    </Campo>
                  ) : (
                    <>
                      <Campo rotulo="O que é"><input className="campo" placeholder="Fritador, DAS, conserto…" value={i.descricao} onChange={e => mudarItem(i.k, { descricao: e.target.value })} /></Campo>
                      <Campo rotulo="Categoria">
                        <select className="campo" value={i.categoria_id} onChange={e => mudarItem(i.k, { categoria_id: e.target.value })}>
                          <option value="">Escolha…</option>
                          {cad.categorias.map(c => <option key={c.id} value={c.id}>{c.nome}{c.tipo === 'investimento' ? ' (investimento)' : ''}</option>)}
                        </select>
                      </Campo>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Campo rotulo={`Quantidade${ins ? ` (${ins.unidade})` : ''}`}><CampoNumero valor={i.quantidade} onChange={x => mudarItem(i.k, { quantidade: x })} /></Campo>
                    <Campo rotulo="Valor pago (R$)"><CampoNumero valor={i.valor} onChange={x => mudarItem(i.k, { valor: x })} placeholder="0,00" /></Campo>
                  </div>
                  {ins && q && v ? <p className="text-sm text-chapa-3 -mt-1">{reais(v / q)} por {ins.unidade}</p> : null}
                </li>
              );
            })}
          </ul>
          <Botao tipo="secundario" largo className="mt-3" onClick={() => setItens(l => [...l, itemVazio()])}><Plus size={18} />Adicionar item</Botao>

          <h3 className="font-semibold mt-5 mb-2">Pagamento</h3>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Frete (R$)"><CampoNumero valor={f.frete} onChange={v => setF({ ...f, frete: v })} placeholder="0,00" /></Campo>
            <Campo rotulo="Desconto (R$)"><CampoNumero valor={f.desconto} onChange={v => setF({ ...f, desconto: v })} placeholder="0,00" /></Campo>
          </div>
          <Campo rotulo="Pago com" dica={cad.contas.find(c => c.id === f.conta_id)?.tipo === 'dono' ? 'Conta como dinheiro que você colocou no negócio.' : undefined}>
            <select className="campo" value={f.conta_id} onChange={e => setF({ ...f, conta_id: e.target.value })}>
              {cad.contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Parcelas"><CampoNumero valor={f.parcelas} onChange={v => setF({ ...f, parcelas: v })} decimal={false} /></Campo>
            {parcelas > 1
              ? <Campo rotulo="1ª parcela vence"><input type="date" className="campo" value={f.primeiro} onChange={e => setF({ ...f, primeiro: e.target.value })} /></Campo>
              : <label className="flex items-center gap-2 mt-6"><input type="checkbox" className="w-5 h-5 accent-chapa" checked={f.pago} onChange={e => setF({ ...f, pago: e.target.checked })} />Já paguei</label>}
          </div>
          {parcelas > 1 && <p className="text-sm text-chapa-3 -mt-1">{parcelas}x de cerca de {reais(total / parcelas)}. As parcelas aparecem em Dinheiro → A pagar{f.primeiro ? '' : ' (1ª vence daqui a 1 mês)'}.</p>}

          {atual && (
            <div className="mt-6">
              {!confirmarExclusao
                ? <Botao tipo="perigo" largo onClick={() => setConfirmarExclusao(true)}><Trash2 size={18} />Excluir compra</Botao>
                : <div className="rounded-2xl border border-ketchup/30 p-3">
                    <p className="mb-2">Excluir esta compra tira os itens do estoque e apaga as contas a pagar dela.</p>
                    <div className="flex gap-2"><Botao tipo="secundario" largo onClick={() => setConfirmarExclusao(false)}>Manter</Botao>
                      <Botao tipo="perigo" largo onClick={async () => { await excluirCompra(atual.id); avisar('Compra excluída'); dadosMudaram(); onFechar(); }}>Excluir</Botao></div>
                  </div>}
            </div>
          )}

          <Folha aberta={!!novoInsumo} titulo="Novo insumo" onFechar={() => setNovoInsumo(null)}
            rodape={<Botao largo onClick={criarInsumo}>Cadastrar e usar</Botao>}>
            {novoInsumo && <>
              <Campo rotulo="Nome"><input className="campo" value={novoInsumo.nome} onChange={e => setNovoInsumo({ ...novoInsumo, nome: e.target.value })} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Unidade">
                  <input className="campo" list="unidades-n" value={novoInsumo.unidade} onChange={e => setNovoInsumo({ ...novoInsumo, unidade: e.target.value })} />
                  <datalist id="unidades-n">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>
                </Campo>
                <Campo rotulo="Grupo">
                  <select className="campo" value={novoInsumo.grupo} onChange={e => setNovoInsumo({ ...novoInsumo, grupo: e.target.value })}>
                    {GRUPOS_INSUMO.map(g => <option key={g}>{g}</option>)}
                  </select>
                </Campo>
              </div>
            </>}
          </Folha>
        </>
      )}
    </Folha>
  );
}

// =============================================================================
// Lista de compras sugerida
// =============================================================================
function ListaDeCompras({ irParaCompras }: { irParaCompras: () => void }) {
  const [dias, setDias] = useState('7');
  const nDias = Math.max(1, Math.min(60, Math.trunc(lerNumero(dias) ?? 7)));
  const { dados, erro, recarregar } = useDados(() => listaCompras(nDias), [nDias]);
  const [marcados, setMarcados] = useState<Record<string, string>>({});
  const [comprar, setComprar] = useState(false);

  const qtd = (s: SugestaoCompra) => marcados[s.insumo_id] ?? String(s.sugerido).replace('.', ',');
  const total = (dados ?? []).reduce((t, s) => t + (lerNumero(qtd(s)) ?? 0) * (Number(s.custo_estimado) / Math.max(Number(s.sugerido), 1e-9)), 0);

  async function compartilhar() {
    if (!dados?.length) return;
    const texto = 'Lista de compras — hamburgueria\n\n' + dados
      .filter(s => (lerNumero(qtd(s)) ?? 0) > 0)
      .map(s => `• ${s.nome}: ${qtd(s)} ${s.unidade}`).join('\n') + `\n\nEstimado: ${reais(total)}`;
    if (Capacitor.isNativePlatform()) await Share.share({ title: 'Lista de compras', text: texto, dialogTitle: 'Enviar lista' });
    else if (navigator.share) await navigator.share({ title: 'Lista de compras', text: texto }).catch(() => undefined);
    else { await navigator.clipboard.writeText(texto); avisar('Lista copiada'); }
  }

  if (erro) return <Erro texto={erro} tentar={recarregar} />;
  return (
    <>
      <label className="flex items-center gap-2 mt-4 text-[15px]">
        Comprar para
        <input className="campo valor w-16 py-2 text-center" inputMode="numeric" value={dias} onChange={e => setDias(e.target.value.replace(/\D/g, ''))} aria-label="Dias de cobertura" />
        dias de venda
      </label>
      <p className="text-sm text-chapa-3 mt-1">Pelo consumo dos últimos 14 dias (vendas, preparos e perdas) e pelo estoque mínimo de cada insumo.</p>
      {!dados && <Carregando />}
      {dados?.length === 0 && <Vazio texto="Nada para comprar agora. Defina o estoque mínimo dos insumos para o app avisar antes de acabar." />}
      {dados && dados.length > 0 && (
        <>
          <ul className="mt-3 rounded-2xl bg-white border border-linha divide-y divide-linha">
            {dados.map(s => (
              <li key={s.insumo_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{s.nome}</span>
                  <span className="block text-sm text-chapa-3">tem {num(s.estoque)} {s.unidade} · {s.motivo}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <input className="campo valor w-20 py-2 text-right" inputMode="decimal" aria-label={`Quantidade de ${s.nome}`}
                    value={qtd(s)} onChange={e => setMarcados(m => ({ ...m, [s.insumo_id]: e.target.value }))} />
                  <span className="text-sm text-chapa-2 w-10">{s.unidade}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-chapa-2">Estimado pelo último custo: <span className="valor font-bold text-chapa">{reais(total)}</span></p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Botao tipo="secundario" onClick={compartilhar}><Share2 size={18} />Enviar lista</Botao>
            <Botao onClick={() => setComprar(true)}>Registrar compra</Botao>
          </div>
        </>
      )}
      <FolhaCompra compra={comprar ? 'nova' : null} onFechar={() => { setComprar(false); recarregar(); }}
        preenchimento={(dados ?? []).filter(s => (lerNumero(qtd(s)) ?? 0) > 0).map(s => ({
          insumo_id: s.insumo_id, quantidade: lerNumero(qtd(s))!, valor: null }))} />
      <Botao tipo="texto" onClick={irParaCompras} className="mt-2">Ver compras anteriores</Botao>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import {
  listar, salvar, compras as listarCompras, registrarCompra, excluirCompra, movimentosInsumo, ajustarEstoque, contarEstoque,
  excluirMovimento, type Insumo, type Compra, type Categoria, type Conta, type Movimento, type NovaCompra,
} from '../lib/api';
import { reais, num, lerNumero, hojeISO, dataBR, dataHoraBR, chave } from '../lib/formato';
import { Botao, Cabecalho, Campo, CampoNumero, Carregando, Erro, Folha, Segmento, Vazio, avisar, dadosMudaram, useDados } from '../ui/base';

export const UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'fatia', 'pct', 'cx', 'lata', 'garrafa'];
export const GRUPOS_INSUMO = ['Ingrediente', 'Embalagem', 'Bebida', 'Limpeza', 'Outro'];

export default function Estoque() {
  const [aba, setAba] = useState<'insumos' | 'compras'>('insumos');
  return (
    <>
      <Cabecalho titulo="Estoque" />
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Segmento rotulo="Ver" valor={aba} onChange={setAba} opcoes={[
          { valor: 'insumos', texto: 'O que tenho' }, { valor: 'compras', texto: 'Compras' },
        ]} />
        {aba === 'insumos' ? <ListaInsumos /> : <ListaCompras />}
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
                      <span className={`block font-medium truncate ${i.ativo ? '' : 'line-through text-chapa-3'}`}>{i.nome}</span>
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
  const [form, setForm] = useState({ nome: '', unidade: 'un', grupo: 'Ingrediente', minimo: '', ativo: true });
  const [chaveForm, setChaveForm] = useState<string | null>(null);
  const [acao, setAcao] = useState<'contar' | 'perda' | 'entrada' | null>(null);
  const [qtd, setQtd] = useState(''); const [custo, setCusto] = useState(''); const [obs, setObs] = useState('');
  const [movs, setMovs] = useState<Movimento[] | null>(null);

  const id = novo ? 'novo' : atual?.id ?? null;
  if (id !== chaveForm) {
    setChaveForm(id);
    setForm(atual ? { nome: atual.nome, unidade: atual.unidade, grupo: atual.grupo, minimo: String(atual.estoque_minimo).replace('.', ','), ativo: atual.ativo }
                  : { nome: '', unidade: 'un', grupo: 'Ingrediente', minimo: '', ativo: true });
    setAcao(null); setQtd(''); setCusto(''); setObs(''); setMovs(null);
    if (atual) movimentosInsumo(atual.id).then(setMovs).catch(() => setMovs([]));
  }

  async function gravar() {
    if (!form.nome.trim()) throw new Error('Dê um nome ao insumo');
    await salvar('insumos', { id: atual?.id, nome: form.nome.trim(), unidade: form.unidade.trim() || 'un', grupo: form.grupo,
      estoque_minimo: lerNumero(form.minimo) ?? 0, ativo: form.ativo });
    avisar(novo ? 'Insumo cadastrado' : 'Insumo salvo');
    dadosMudaram(); onFechar();
  }

  async function executar() {
    const q = lerNumero(qtd);
    if (q === null || q < 0 || (acao !== 'contar' && q === 0)) throw new Error('Informe uma quantidade válida');
    if (acao === 'contar') {
      const dif = await contarEstoque(atual!.id, q);
      avisar(dif === 0 ? 'Estoque conferido: está certo' : `Ajustado: ${dif > 0 ? '+' : ''}${num(dif)} ${atual!.unidade}`);
    } else if (acao === 'perda') {
      await ajustarEstoque(atual!.id, 'saida', q, 'perda', null, obs || undefined);
      avisar('Perda registrada');
    } else {
      await ajustarEstoque(atual!.id, 'entrada', q, 'inicial', lerNumero(custo), obs || undefined);
      avisar('Entrada registrada');
    }
    dadosMudaram(); onFechar();
  }

  const nomeOrigem: Record<string, string> = { compra: 'Compra', venda: 'Venda', ajuste: 'Ajuste', perda: 'Perda', contagem: 'Contagem', inicial: 'Entrada manual' };

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
                      {['ajuste', 'perda', 'contagem', 'inicial'].includes(m.origem) && (
                        <button aria-label="Desfazer este ajuste" className="p-2 text-chapa-3"
                          onClick={async () => { await excluirMovimento(m.id); avisar('Ajuste desfeito'); dadosMudaram(); onFechar(); }}><Trash2 size={16} /></button>
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

export function FolhaCompra({ compra, onFechar }: { compra: Compra | 'nova' | null; onFechar: () => void }) {
  const { dados: cad } = useDados(async () => {
    const [insumos, categorias, contas] = await Promise.all([listar<Insumo>('insumos'), listar<Categoria>('categorias'), listar<Conta>('contas')]);
    return { insumos: insumos.filter(i => i.ativo), categorias: categorias.filter(c => c.ativo && c.tipo !== 'receita' && c.tipo !== 'estoque'), contas: contas.filter(c => c.ativo) };
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
      setItens([itemVazio()]);
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
      estoque_minimo: 0, estoque_atual: 0, custo_medio: 0, ativo: true });
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

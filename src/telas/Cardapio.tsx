import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { listar, salvar, excluir, fichaDoProduto, type Canal, type Insumo, type ProdutoCusto } from '../lib/api';
import { reais, lerNumero, pct } from '../lib/formato';
import { Botao, Cabecalho, Campo, CampoNumero, Carregando, Erro, Folha, Vazio, avisar, dadosMudaram, useDados } from '../ui/base';

const GRUPOS = ['Lanches', 'Combos', 'Porções', 'Bebidas', 'Sobremesas', 'Adicionais'];

export default function Cardapio() {
  const { dados, erro, recarregar } = useDados(async () => {
    const [produtos, canais] = await Promise.all([listar<ProdutoCusto>('v_produtos_custo'), listar<Canal>('canais')]);
    return { produtos, canais: canais.filter(c => c.ativo) };
  });
  const [aberto, setAberto] = useState<ProdutoCusto | 'novo' | null>(null);
  const grupos = useMemo(() => {
    const g = new Map<string, ProdutoCusto[]>();
    dados?.produtos.forEach(p => g.set(p.grupo, [...(g.get(p.grupo) ?? []), p]));
    return [...g.entries()];
  }, [dados]);
  const maiorTaxa = dados?.canais.reduce((m, c) => (c.taxa_percentual > (m?.taxa_percentual ?? -1) ? c : m), undefined as Canal | undefined);

  return (
    <>
      <Cabecalho titulo="Cardápio" acao={<Botao onClick={() => setAberto('novo')}><Plus size={20} />Novo</Botao>} />
      <main className="max-w-lg mx-auto px-4 pt-2">
        {erro && <Erro texto={erro} tentar={recarregar} />}
        {!dados && !erro && <Carregando />}
        {dados?.produtos.length === 0 && <Vazio texto="Cadastre seus lanches e monte a ficha técnica de cada um: o app calcula o custo, quanto sobra e o preço sugerido." />}
        {grupos.map(([grupo, lista]) => (
          <section key={grupo} className="mt-4">
            <h2 className="text-chapa-2 font-semibold mb-2">{grupo}</h2>
            <ul className="rounded-2xl bg-white border border-linha divide-y divide-linha">
              {lista.map(p => {
                const margem = p.preco_venda > 0 ? (p.margem_bruta / p.preco_venda) * 100 : 0;
                const sobraApp = maiorTaxa && maiorTaxa.taxa_percentual > 0
                  ? p.preco_venda * (1 - maiorTaxa.taxa_percentual / 100) - Number(maiorTaxa.taxa_fixa) - p.custo : null;
                return (
                  <li key={p.id}>
                    <button onClick={() => setAberto(p)} className={`w-full flex justify-between gap-3 px-4 py-3 text-left active:bg-fundo ${p.ativo ? '' : 'opacity-50'}`}>
                      <span className="min-w-0">
                        <span className="block font-medium">{p.nome}</span>
                        <span className="block text-sm text-chapa-3">
                          {p.itens_ficha === 0 ? <span className="text-ketchup">Sem ficha técnica: custo desconhecido</span>
                            : <>custo {reais(p.custo)} · margem {pct(margem, 0)}{sobraApp !== null && <> · no {maiorTaxa!.nome} sobra <span className={sobraApp < 0 ? 'text-ketchup font-semibold' : ''}>{reais(sobraApp)}</span></>}</>}
                        </span>
                      </span>
                      <span className="valor text-lg font-bold shrink-0">{reais(p.preco_venda)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
      {dados && <FolhaProduto produto={aberto} canais={dados.canais} onFechar={() => setAberto(null)} />}
    </>
  );
}

interface LinhaFicha { k: number; insumo_id: string; quantidade: string }
let kSeq = 0;

function FolhaProduto({ produto, canais, onFechar }: { produto: ProdutoCusto | 'novo' | null; canais: Canal[]; onFechar: () => void }) {
  const { dados: insumos } = useDados(() => listar<Insumo>('insumos'));
  const atual = produto && produto !== 'novo' ? produto : null;
  const [chaveForm, setChaveForm] = useState<string | null>(null);
  const [f, setF] = useState({ nome: '', grupo: 'Lanches', preco: '', ativo: true });
  const [ficha, setFicha] = useState<LinhaFicha[] | null>(null);
  const [alvo, setAlvo] = useState('30');
  const [confirmar, setConfirmar] = useState(false);

  const id = produto === 'novo' ? 'novo' : atual?.id ?? null;
  if (id !== chaveForm) {
    setChaveForm(id); setConfirmar(false);
    setF(atual ? { nome: atual.nome, grupo: atual.grupo, preco: String(atual.preco_venda).replace('.', ','), ativo: atual.ativo }
               : { nome: '', grupo: 'Lanches', preco: '', ativo: true });
    if (atual) {
      setFicha(null);
      fichaDoProduto(atual.id).then(l => setFicha(l.map(x => ({ k: ++kSeq, insumo_id: x.insumo_id, quantidade: String(x.quantidade).replace('.', ',') }))));
    } else setFicha([{ k: ++kSeq, insumo_id: '', quantidade: '' }]);
  }

  const mapa = new Map((insumos ?? []).map(i => [i.id, i]));
  const custo = (ficha ?? []).reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0) * Number(mapa.get(l.insumo_id)?.custo_medio ?? 0), 0);
  const preco = lerNumero(f.preco) ?? 0;
  const alvoPct = Math.min(90, Math.max(0, lerNumero(alvo) ?? 0));

  async function gravar() {
    if (!f.nome.trim()) throw new Error('Dê um nome ao produto');
    if (lerNumero(f.preco) === null || preco < 0) throw new Error('Informe o preço de venda');
    const linhas = (ficha ?? []).filter(l => l.insumo_id || l.quantidade);
    const vistos = new Set<string>();
    for (const [n, l] of linhas.entries()) {
      if (!l.insumo_id) throw new Error(`Ficha, linha ${n + 1}: escolha o insumo`);
      if (vistos.has(l.insumo_id)) throw new Error(`O insumo ${mapa.get(l.insumo_id)?.nome} aparece duas vezes na ficha`);
      vistos.add(l.insumo_id);
      const q = lerNumero(l.quantidade);
      if (!q || q <= 0) throw new Error(`Ficha, linha ${n + 1}: quantidade inválida`);
    }
    const pid = await salvar('produtos', { id: atual?.id, nome: f.nome.trim(), grupo: f.grupo.trim() || 'Lanches', preco_venda: preco, ativo: f.ativo });
    // ficha: substitui a lista inteira
    const del = await supabase.from('ficha_tecnica').delete().eq('produto_id', pid);
    if (del.error) throw new Error(del.error.message);
    if (linhas.length) {
      const ins = await supabase.from('ficha_tecnica').insert(linhas.map(l => ({ produto_id: pid, insumo_id: l.insumo_id, quantidade: lerNumero(l.quantidade) })));
      if (ins.error) throw new Error(ins.error.message);
    }
    avisar(atual ? 'Produto salvo' : 'Produto cadastrado');
    dadosMudaram(); onFechar();
  }

  return (
    <Folha aberta={!!produto} titulo={atual ? atual.nome : 'Novo produto'} onFechar={onFechar}
      rodape={<Botao largo onClick={gravar}>{atual ? 'Salvar' : 'Cadastrar produto'}</Botao>}>
      <Campo rotulo="Nome"><input className="campo" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Burger Goiabacon" /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Grupo">
          <input className="campo" list="grupos-prod" value={f.grupo} onChange={e => setF({ ...f, grupo: e.target.value })} />
          <datalist id="grupos-prod">{GRUPOS.map(g => <option key={g} value={g} />)}</datalist>
        </Campo>
        <Campo rotulo="Preço de venda (R$)"><CampoNumero valor={f.preco} onChange={v => setF({ ...f, preco: v })} placeholder="0,00" /></Campo>
      </div>

      <h3 className="font-semibold mt-3 mb-1">Ficha técnica</h3>
      <p className="text-sm text-chapa-3 mb-3">O que vai em uma unidade, na unidade do insumo. Ex.: carne 0,15 kg, pão 1 un, saco 1 un.</p>
      {(!ficha || !insumos) && <Carregando />}
      {ficha && insumos && (
        <>
          {insumos.length === 0 && <p className="text-ketchup mb-2">Cadastre os insumos em Estoque antes de montar a ficha.</p>}
          <ul className="space-y-2">
            {ficha.map((l, n) => {
              const ins = mapa.get(l.insumo_id);
              const c = (lerNumero(l.quantidade) ?? 0) * Number(ins?.custo_medio ?? 0);
              return (
                <li key={l.k} className="rounded-xl border border-linha bg-white p-2.5">
                  <div className="flex gap-2">
                    <select className="campo flex-1 min-w-0" aria-label={`Insumo da linha ${n + 1}`} value={l.insumo_id}
                      onChange={e => setFicha(x => x!.map(y => y.k === l.k ? { ...y, insumo_id: e.target.value } : y))}>
                      <option value="">Insumo…</option>
                      {insumos.filter(i => i.ativo || i.id === l.insumo_id).map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
                    </select>
                    <div className="w-28 shrink-0">
                      <CampoNumero rotulo={`Quantidade da linha ${n + 1}`} valor={l.quantidade} placeholder={ins?.unidade ?? 'qtd'}
                        onChange={v => setFicha(x => x!.map(y => y.k === l.k ? { ...y, quantidade: v } : y))} />
                    </div>
                    <button aria-label={`Remover linha ${n + 1}`} className="p-2 text-chapa-3" onClick={() => setFicha(x => x!.filter(y => y.k !== l.k))}><Trash2 size={18} /></button>
                  </div>
                  {ins && <p className="text-xs text-chapa-3 mt-1 px-1">{ins.unidade} · {reais(ins.custo_medio)}/{ins.unidade} · nesta receita {reais(c)}
                    {Number(ins.custo_medio) === 0 && <span className="text-ketchup"> (sem custo: registre uma compra)</span>}</p>}
                </li>
              );
            })}
          </ul>
          <Botao tipo="secundario" largo className="mt-2" onClick={() => setFicha(x => [...(x ?? []), { k: ++kSeq, insumo_id: '', quantidade: '' }])}><Plus size={18} />Adicionar insumo</Botao>

          {/* Conta do lanche por canal */}
          <section className="mt-5 rounded-2xl bg-kraft p-4">
            <div className="flex justify-between items-baseline"><span className="font-semibold">Custo de uma unidade</span><span className="valor text-xl font-extrabold">{reais(custo)}</span></div>
            {preco > 0 && (
              <table className="w-full mt-3 text-[15px]">
                <caption className="sr-only">Quanto sobra por canal</caption>
                <thead><tr className="text-left text-chapa-2 text-sm"><th className="font-medium">Canal</th><th className="font-medium text-right">Taxa</th><th className="font-medium text-right">Sobra</th></tr></thead>
                <tbody>
                  {canais.map(c => {
                    const taxa = preco * c.taxa_percentual / 100 + Number(c.taxa_fixa);
                    const sobra = preco - taxa - custo;
                    return (
                      <tr key={c.id} className="border-t border-kraft-escuro/60">
                        <td className="py-1.5">{c.nome}</td>
                        <td className="valor text-right">{reais(taxa)}</td>
                        <td className={`valor text-right font-bold ${sobra < 0 ? 'text-ketchup' : ''}`}>{reais(sobra)} <span className="text-xs font-medium text-chapa-2">({pct(preco ? sobra / preco * 100 : 0, 0)})</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="mt-4 border-t border-kraft-escuro/60 pt-3">
              <label className="flex items-center gap-2 text-[15px]">
                Quero que sobre
                <input className="campo valor w-16 py-1.5 text-center" inputMode="decimal" value={alvo} onChange={e => setAlvo(e.target.value)} aria-label="Margem desejada em porcentagem" />
                % do preço
              </label>
              <p className="text-xs text-chapa-2 mt-1">O que sobra ainda paga gás, DAS, entrega e o seu salário.</p>
              <ul className="mt-2 space-y-1">
                {canais.map(c => {
                  const div = 1 - c.taxa_percentual / 100 - alvoPct / 100;
                  const sugerido = div > 0 ? (custo + Number(c.taxa_fixa)) / div : null;
                  return (
                    <li key={c.id} className="flex justify-between">
                      <span>Preço sugerido {c.nome}</span>
                      <span className="valor font-bold">{sugerido === null ? 'impossível' : reais(Math.ceil(sugerido * 2) / 2)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </>
      )}

      {atual && (
        <>
          <label className="flex items-center gap-3 py-3 mt-2">
            <input type="checkbox" className="w-5 h-5 accent-chapa" checked={f.ativo} onChange={e => setF({ ...f, ativo: e.target.checked })} />
            À venda (desmarque para tirar do cardápio sem apagar)
          </label>
          {!confirmar ? <Botao tipo="perigo" largo onClick={() => setConfirmar(true)}><Trash2 size={18} />Excluir produto</Botao> : (
            <div className="rounded-2xl border border-ketchup/30 p-3">
              <p className="mb-2">Só dá para excluir produto que nunca foi vendido. Se já vendeu, desmarque "À venda".</p>
              <div className="flex gap-2"><Botao tipo="secundario" largo onClick={() => setConfirmar(false)}>Manter</Botao>
                <Botao tipo="perigo" largo onClick={async () => { await excluir('produtos', atual.id); avisar('Produto excluído'); dadosMudaram(); onFechar(); }}>Excluir</Botao></div>
            </div>
          )}
        </>
      )}
    </Folha>
  );
}

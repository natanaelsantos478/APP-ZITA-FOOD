import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, History, ChevronUp, ChevronDown } from 'lucide-react';
import { listar, registrarVenda, vendasPeriodo, cancelarVenda, fechamentoDia, inserirLancamentos, type Canal, type Categoria, type Conta, type FormaPagamento, type ProdutoCusto, type Venda, type Fechamento } from '../lib/api';
import { reais, num, lerNumero, hojeISO, dataHoraBR } from '../lib/formato';
import { Botao, Cabecalho, Campo, CampoNumero, Carregando, Erro, Folha, Segmento, Vazio, avisar, dadosMudaram, useDados } from '../ui/base';

interface Linha { produto: ProdutoCusto; quantidade: number; preco: string }

export default function Vender() {
  const { dados, erro, recarregar } = useDados(async () => {
    const [produtos, canais, formas] = await Promise.all([
      listar<ProdutoCusto>('v_produtos_custo'), listar<Canal>('canais'), listar<FormaPagamento>('formas_pagamento'),
    ]);
    return { produtos: produtos.filter(p => p.ativo), canais: canais.filter(c => c.ativo), formas: formas.filter(f => f.ativo) };
  });
  const [canalId, setCanalId] = useState('');
  const [itens, setItens] = useState<Linha[]>([]);
  const [aberta, setAberta] = useState(false);
  const [desconto, setDesconto] = useState('');
  const [entrega, setEntrega] = useState('');
  const [cliente, setCliente] = useState('');
  const [formaId, setFormaId] = useState('');
  const [entregador, setEntregador] = useState('');
  const [historico, setHistorico] = useState(false);

  useEffect(() => {
    if (dados && !canalId && dados.canais[0]) setCanalId(dados.canais[0].id);
  }, [dados, canalId]);

  const canal = dados?.canais.find(c => c.id === canalId);
  // ao trocar de canal, a forma volta para a padrão dele (ex.: iFood → pago no app)
  useEffect(() => {
    if (!dados || !canal) return;
    // sem padrão no canal: a forma sem taxa e sem prazo (dinheiro/Pix), nunca uma com taxa por acaso
    const semCusto = dados.formas.find(f => Number(f.taxa_percentual) === 0 && Number(f.taxa_fixa) === 0 && f.dias_recebimento === 0);
    setFormaId(canal.forma_padrao_id && dados.formas.some(f => f.id === canal.forma_padrao_id) ? canal.forma_padrao_id : semCusto?.id ?? dados.formas[0]?.id ?? '');
  }, [dados, canal]);
  const forma = dados?.formas.find(f => f.id === formaId);
  const grupos = useMemo(() => {
    const g = new Map<string, ProdutoCusto[]>();
    dados?.produtos.forEach(p => g.set(p.grupo, [...(g.get(p.grupo) ?? []), p]));
    return [...g.entries()];
  }, [dados]);

  const subtotal = itens.reduce((s, l) => s + l.quantidade * (lerNumero(l.preco) ?? 0), 0);
  const desc = lerNumero(desconto) ?? 0;
  const taxaEntrega = lerNumero(entrega) ?? 0;
  const taxaCanal = canal ? Math.round(((subtotal - desc) * canal.taxa_percentual / 100 + Number(canal.taxa_fixa)) * 100) / 100 : 0;
  const total = subtotal - desc + taxaEntrega;
  const taxaForma = forma ? Math.round((total * forma.taxa_percentual / 100 + Number(forma.taxa_fixa)) * 100) / 100 : 0;
  const custoEntrega = lerNumero(entregador) ?? 0;
  const custo = itens.reduce((s, l) => s + l.quantidade * Number(l.produto.custo), 0);
  const sobra = total - taxaCanal - taxaForma - custo - custoEntrega;
  const qtdItens = itens.reduce((s, l) => s + l.quantidade, 0);

  function adicionar(p: ProdutoCusto) {
    setItens(atual => {
      const i = atual.findIndex(l => l.produto.id === p.id);
      if (i < 0) return [...atual, { produto: p, quantidade: 1, preco: String(p.preco_venda).replace('.', ',') }];
      const n = [...atual]; n[i] = { ...n[i], quantidade: n[i].quantidade + 1 }; return n;
    });
  }
  function mudarQtd(id: string, delta: number) {
    setItens(atual => atual.flatMap(l => l.produto.id !== id ? [l] : l.quantidade + delta <= 0 ? [] : [{ ...l, quantidade: l.quantidade + delta }]));
  }
  function limpar() { setItens([]); setDesconto(''); setEntrega(''); setCliente(''); setEntregador(''); setAberta(false); }

  async function registrar() {
    if (!canal) throw new Error('Escolha o canal da venda');
    if (desc > subtotal) throw new Error('O desconto é maior que o valor dos itens');
    for (const l of itens) if (lerNumero(l.preco) === null) throw new Error(`Preço inválido em ${l.produto.nome}`);
    if (custoEntrega < 0) throw new Error('Valor do entregador inválido');
    await registrarVenda({
      canal_id: canal.id, forma_pagamento_id: formaId || null, cliente: cliente.trim() || undefined,
      desconto: desc, taxa_entrega: taxaEntrega, custo_entrega: custoEntrega,
      itens: itens.map(l => ({ produto_id: l.produto.id, quantidade: l.quantidade, preco_unitario: lerNumero(l.preco)! })),
    });
    avisar(`Venda registrada: ${reais(total)}`);
    limpar();
    dadosMudaram();
  }

  return (
    <>
      <Cabecalho titulo="Vender" acao={
        <Botao tipo="secundario" onClick={() => setHistorico(true)} className="min-h-10 text-[15px]"><History size={18} />Vendas</Botao>
      } />
      <main className="max-w-lg mx-auto px-4 pt-4" style={{ paddingBottom: itens.length ? 120 : 16 }}>
        {erro && <Erro texto={erro} tentar={recarregar} />}
        {!dados && !erro && <Carregando />}
        {dados && dados.produtos.length === 0 && (
          <Vazio texto="Seu cardápio está vazio. Cadastre os lanches na aba Cardápio para vender com um toque." />
        )}
        {dados && dados.produtos.length > 0 && (
          <>
            <Segmento rotulo="Canal da venda" valor={canalId} onChange={setCanalId}
              opcoes={dados.canais.map(c => ({ valor: c.id, texto: c.nome }))} />
            {canal && canal.taxa_percentual > 0 && (
              <p className="text-sm text-chapa-3 mt-1">{canal.nome} fica com {num(canal.taxa_percentual, 2)}% de cada venda.</p>
            )}
            {grupos.map(([grupo, produtos]) => (
              <section key={grupo} className="mt-5">
                <h2 className="text-chapa-2 font-semibold mb-2">{grupo}</h2>
                <div className="grid grid-cols-2 gap-2.5">
                  {produtos.map(p => {
                    const q = itens.find(l => l.produto.id === p.id)?.quantidade ?? 0;
                    return (
                      <button key={p.id} onClick={() => adicionar(p)} aria-label={`Adicionar ${p.nome}`}
                        className={`relative min-h-24 rounded-2xl p-3 text-left flex flex-col justify-between border-[1.5px] active:scale-[0.98] transition-transform ${q ? 'bg-kraft border-kraft-escuro' : 'bg-white border-linha'}`}>
                        <span className="font-semibold leading-snug pr-6">{p.nome}</span>
                        <span className="valor text-lg font-bold">{reais(p.preco_venda)}</span>
                        {q > 0 && <span className="absolute top-2 right-2 min-w-7 h-7 px-1.5 rounded-full bg-chapa text-white text-sm font-bold flex items-center justify-center">{num(q)}</span>}
                        {p.itens_ficha === 0 && <span className="text-xs text-ketchup">sem ficha técnica</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {/* A comanda */}
      {itens.length > 0 && (
        <div className="fixed inset-x-0 z-40 flex justify-center" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 64px)' }}>
          <div className="w-full max-w-lg comanda pt-3 shadow-[0_-8px_24px_rgba(43,33,24,0.18)]">
            <div className="comanda-corpo px-4 pb-3">
              <button onClick={() => setAberta(a => !a)} className="w-full flex items-center justify-between py-1" aria-expanded={aberta}>
                <span className="font-semibold flex items-center gap-1">
                  {aberta ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                  {num(qtdItens)} {qtdItens === 1 ? 'item' : 'itens'}
                </span>
                <span className="valor text-2xl font-extrabold">{reais(total)}</span>
              </button>

              {aberta && (
                <div className="max-h-[48vh] overflow-y-auto border-t border-dashed border-kraft-escuro mt-2 pt-2">
                  {itens.map(l => (
                    <div key={l.produto.id} className="flex items-center gap-2 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{l.produto.nome}</div>
                        <input className="valor bg-transparent border-b border-kraft-escuro w-24 text-sm py-0.5" inputMode="decimal"
                          aria-label={`Preço de ${l.produto.nome}`} value={l.preco}
                          onChange={e => setItens(a => a.map(x => x.produto.id === l.produto.id ? { ...x, preco: e.target.value } : x))} />
                      </div>
                      <button onClick={() => mudarQtd(l.produto.id, -1)} aria-label={`Tirar um ${l.produto.nome}`} className="w-11 h-11 rounded-full bg-white/70 flex items-center justify-center"><Minus size={18} /></button>
                      <span className="valor w-8 text-center font-bold">{num(l.quantidade)}</span>
                      <button onClick={() => mudarQtd(l.produto.id, 1)} aria-label={`Mais um ${l.produto.nome}`} className="w-11 h-11 rounded-full bg-white/70 flex items-center justify-center"><Plus size={18} /></button>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-x-3 mt-2">
                    <Campo rotulo="Desconto (R$)"><CampoNumero valor={desconto} onChange={setDesconto} placeholder="0,00" /></Campo>
                    <Campo rotulo="Taxa de entrega (R$)"><CampoNumero valor={entrega} onChange={setEntrega} placeholder="0,00" /></Campo>
                  </div>
                  <Campo rotulo="Cliente (opcional)"><input className="campo" value={cliente} onChange={e => setCliente(e.target.value)} /></Campo>
                  <Campo rotulo="Paguei ao entregador (R$)" dica="Se você mesmo pagou a entrega. Vira despesa de entrega.">
                    <CampoNumero valor={entregador} onChange={setEntregador} placeholder="0,00" />
                  </Campo>
                  <dl className="text-[15px] space-y-1 border-t border-dashed border-kraft-escuro pt-2">
                    {taxaCanal > 0 && <div className="flex justify-between"><dt>Taxa {canal?.nome}</dt><dd className="valor">− {reais(taxaCanal)}</dd></div>}
                    {taxaForma > 0 && <div className="flex justify-between"><dt>Taxa {forma?.nome}</dt><dd className="valor">− {reais(taxaForma)}</dd></div>}
                    {custoEntrega > 0 && <div className="flex justify-between"><dt>Entregador</dt><dd className="valor">− {reais(custoEntrega)}</dd></div>}
                    <div className="flex justify-between"><dt>Custo dos ingredientes</dt><dd className="valor">− {reais(custo)}</dd></div>
                    <div className="flex justify-between font-bold"><dt>Sobra desta venda</dt><dd className={`valor ${sobra < 0 ? 'text-ketchup' : 'text-picles'}`}>{reais(sobra)}</dd></div>
                  </dl>
                  <Botao tipo="texto" onClick={limpar} className="mt-1 px-0">Limpar comanda</Botao>
                </div>
              )}
              {dados && dados.formas.length > 0 && (
                <div className="mt-2">
                  <Segmento rotulo="Forma de pagamento" valor={formaId} onChange={setFormaId}
                    opcoes={dados.formas.map(f => ({ valor: f.id, texto: f.nome }))} />
                  {forma && forma.dias_recebimento > 0 && <p className="text-xs text-chapa-2 mt-0.5">Cai na conta em {forma.dias_recebimento} {forma.dias_recebimento === 1 ? 'dia' : 'dias'}: fica em "A receber".</p>}
                </div>
              )}
              <Botao largo onClick={registrar} className="mt-2 text-lg">Registrar venda</Botao>
            </div>
          </div>
        </div>
      )}

      <Historico aberta={historico} onFechar={() => setHistorico(false)} />
    </>
  );
}

function Historico({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const [dia, setDia] = useState(hojeISO());
  const [lista, setLista] = useState<Venda[] | null>(null);
  const [fech, setFech] = useState<Fechamento | null>(null);
  const [cancelar, setCancelar] = useState<Venda | null>(null);
  const [contei, setContei] = useState('');
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!aberta) return;
    setLista(null); setFech(null);
    const ini = new Date(dia + 'T00:00:00'); const fim = new Date(dia + 'T23:59:59.999');
    vendasPeriodo(ini.toISOString(), fim.toISOString()).then(setLista).catch(() => setLista([]));
    fechamentoDia(dia).then(setFech).catch(() => setFech(null));
  }, [aberta, dia, versao]);

  const contado = lerNumero(contei);
  const diferenca = fech && contado !== null ? Math.round((contado - Number(fech.dinheiro_esperado)) * 100) / 100 : null;

  async function lancarDiferenca() {
    if (!fech || diferenca === null || diferenca === 0) return;
    const [cats, contas] = await Promise.all([listar<Categoria>('categorias'), listar<Conta>('contas')]);
    const gaveta = contas.find(c => c.nome === 'Dinheiro (gaveta)');
    const cat = cats.find(c => c.nome === (diferenca > 0 ? 'Outras receitas' : 'Outras despesas'));
    if (!gaveta || !cat) throw new Error('Conta "Dinheiro (gaveta)" ou categoria de ajuste não encontrada');
    await inserirLancamentos([{ tipo: diferenca > 0 ? 'receita' : 'despesa', categoria_id: cat.id,
      descricao: `Conferência da gaveta ${dia.split('-').reverse().join('/')} (${diferenca > 0 ? 'sobra' : 'falta'})`,
      valor: Math.abs(diferenca), vencimento: dia, pago_em: dia, conta_id: gaveta.id, parcela: null }]);
    avisar('Diferença da gaveta lançada'); setContei(''); setVersao(v => v + 1); dadosMudaram();
  }

  const concluidas = lista?.filter(v => v.status === 'concluida') ?? [];
  return (
    <Folha aberta={aberta} titulo="Vendas do dia" onFechar={onFechar}>
      <Campo rotulo="Dia"><input type="date" className="campo" value={dia} onChange={e => setDia(e.target.value)} /></Campo>
      {!lista && <Carregando />}
      {lista && (
        <>
          <p className="text-chapa-2 mb-3">
            {concluidas.length} {concluidas.length === 1 ? 'venda' : 'vendas'} · <span className="valor font-semibold text-chapa">{reais(concluidas.reduce((s, v) => s + Number(v.total), 0))}</span>
            {' '}· líquido {reais(concluidas.reduce((s, v) => s + Number(v.liquido), 0))}
          </p>

          {fech && fech.vendas > 0 && (
            <section aria-labelledby="fech" className="rounded-2xl bg-kraft p-4 mb-4">
              <h3 id="fech" className="font-bold mb-2">Fechamento do dia</h3>
              <ul className="space-y-1.5 text-[15px]">
                {fech.por_forma.map(f => (
                  <li key={f.forma} className="flex justify-between gap-2">
                    <span>{f.forma} <span className="text-chapa-2 text-sm">({f.vendas}){f.dias_recebimento > 0 ? ` · recebe em ${f.dias_recebimento}d` : ''}</span></span>
                    <span className="valor font-semibold">{reais(f.liquido)}</span>
                  </li>
                ))}
              </ul>
              {Number(fech.entregadores) > 0 && <p className="text-sm text-chapa-2 mt-2">Pago a entregadores: {reais(fech.entregadores)}</p>}
              <div className="border-t border-kraft-escuro/60 mt-3 pt-3">
                <div className="flex justify-between"><span>Dinheiro que deve ter na gaveta</span><span className="valor font-bold">{reais(fech.dinheiro_esperado)}</span></div>
                <p className="text-xs text-chapa-2">Movimento do dia na conta "Dinheiro (gaveta)", sem o troco inicial.</p>
                <label className="flex items-center gap-2 mt-2 text-[15px]">
                  Contei
                  <input className="campo valor py-2" inputMode="decimal" placeholder="0,00" value={contei} onChange={e => setContei(e.target.value)} aria-label="Valor contado na gaveta" />
                </label>
                {diferenca !== null && (
                  diferenca === 0
                    ? <p className="text-picles font-semibold mt-2">Gaveta certinha.</p>
                    : <div className="mt-2">
                        <p className={`font-semibold ${diferenca < 0 ? 'text-ketchup' : 'text-picles'}`}>{diferenca < 0 ? `Faltam ${reais(-diferenca)}` : `Sobram ${reais(diferenca)}`}</p>
                        <Botao tipo="secundario" className="mt-2" onClick={lancarDiferenca}>Lançar a diferença no caixa</Botao>
                      </div>
                )}
              </div>
            </section>
          )}

          {lista.length === 0 && <Vazio texto="Nenhuma venda neste dia." />}
          <ul className="space-y-2">
            {lista.map(v => (
              <li key={v.id} className={`rounded-xl border border-linha bg-white p-3 ${v.status === 'cancelada' ? 'opacity-60' : ''}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">#{v.numero} · {v.canais?.nome}{v.cliente ? ` · ${v.cliente}` : ''}</span>
                  <span className={`valor font-bold ${v.status === 'cancelada' ? 'line-through' : ''}`}>{reais(v.total)}</span>
                </div>
                <div className="text-sm text-chapa-3">
                  {dataHoraBR(v.data)}{v.formas_pagamento ? ` · ${v.formas_pagamento.nome}` : ''} · {v.venda_itens.map(i => `${num(i.quantidade)}× ${i.produtos?.nome}`).join(', ')}
                </div>
                {v.status === 'cancelada'
                  ? <div className="text-sm text-ketchup mt-1">Cancelada</div>
                  : <button className="text-sm text-ketchup font-medium mt-1 py-1" onClick={() => setCancelar(v)}>Cancelar venda</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      <Folha aberta={!!cancelar} titulo={`Cancelar a venda #${cancelar?.numero}?`} onFechar={() => setCancelar(null)}
        rodape={<div className="flex gap-2">
          <Botao tipo="secundario" largo onClick={() => setCancelar(null)}>Manter</Botao>
          <Botao tipo="perigo" largo onClick={async () => { await cancelarVenda(cancelar!.id); avisar('Venda cancelada'); setCancelar(null); setVersao(v => v + 1); dadosMudaram(); }}>Cancelar venda</Botao>
        </div>}>
        <p className="text-chapa-2">Os ingredientes voltam para o estoque e o valor sai do caixa (e o entregador, se houver).</p>
      </Folha>
    </Folha>
  );
}

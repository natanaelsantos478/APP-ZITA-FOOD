import { useState } from 'react';
import { Settings, AlertTriangle, ShoppingCart, Receipt } from 'lucide-react';
import type { Aba } from '../App';
import { painel } from '../lib/api';
import { reais, num, hojeISO, inicioFimMes, nomeMes, dataBR } from '../lib/formato';
import { Cabecalho, Carregando, Erro, Segmento, useDados } from '../ui/base';

type Periodo = 'hoje' | 'mes' | 'anterior';

function intervalo(p: Periodo): [string, string] {
  const hoje = new Date();
  if (p === 'hoje') return [hojeISO(hoje), hojeISO(hoje)];
  if (p === 'mes') return inicioFimMes(hoje);
  return inicioFimMes(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1));
}

export default function Inicio({ irPara }: { irPara: (a: Aba) => void }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [ini, fim] = intervalo(periodo);
  const { dados: p, erro, recarregar } = useDados(() => painel(ini, fim), [ini, fim]);

  const rotuloPeriodo = periodo === 'hoje' ? `Hoje, ${dataBR(ini).slice(0, 5)}` : nomeMes(ini);

  return (
    <>
      <Cabecalho titulo="Início" acao={
        <button onClick={() => irPara('ajustes')} aria-label="Ajustes, planilhas e backup"
                className="p-2.5 -mr-2 rounded-full active:bg-linha"><Settings size={24} /></button>
      } />
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Segmento rotulo="Período" valor={periodo} onChange={setPeriodo} opcoes={[
          { valor: 'hoje', texto: 'Hoje' }, { valor: 'mes', texto: 'Este mês' }, { valor: 'anterior', texto: 'Mês passado' },
        ]} />

        {erro && <Erro texto={erro} tentar={recarregar} />}
        {!p && !erro && <Carregando />}
        {p && (
          <>
            {/* Resultado: a conta do período, como numa nota */}
            <section aria-labelledby="res" className="mt-5">
              <h2 id="res" className="text-chapa-2 font-medium first-letter:uppercase">{rotuloPeriodo}</h2>
              <p className={`valor text-[44px] leading-none font-extrabold mt-1 ${p.resultado < 0 ? 'text-ketchup' : 'text-picles'}`}>
                {reais(p.resultado)}
              </p>
              <p className="text-chapa-2 mt-1">
                {p.resultado < 0 ? 'de prejuízo no período' : p.resultado > 0 ? 'de lucro no período' : 'sem resultado ainda'}
                {p.vendas.quantidade > 0 && ` · ${p.vendas.quantidade} ${p.vendas.quantidade === 1 ? 'venda' : 'vendas'}`}
              </p>

              <dl className="mt-4 rounded-2xl bg-white border border-linha divide-y divide-linha text-[15px]">
                <Linha nome="Vendido" valor={p.vendas.faturamento} />
                <Linha nome="Taxas dos apps" valor={-p.vendas.taxas_canal} />
                <Linha nome="Custo dos ingredientes" valor={-p.vendas.cmv} dica="o que saiu do estoque nas vendas" />
                <Linha nome="Despesas do período" valor={-p.despesas_operacionais} dica="DAS, gás, juros, entrega…" />
                {p.outras_receitas > 0 && <Linha nome="Outras receitas" valor={p.outras_receitas} />}
                <Linha nome="Resultado" valor={p.resultado} forte />
              </dl>
              {p.vendas.quantidade > 0 && (
                <p className="text-sm text-chapa-3 mt-2">Ticket médio {reais(p.vendas.ticket_medio)}. Lucro sobre ingredientes {reais(p.vendas.lucro_bruto)}.</p>
              )}
            </section>

            {/* Alertas */}
            {(p.vencidas > 0 || p.estoque_baixo.length > 0) && (
              <section aria-label="Atenção" className="mt-6 space-y-2">
                {p.vencidas > 0 && (
                  <button onClick={() => irPara('dinheiro')} className="w-full text-left rounded-2xl bg-ketchup/10 border border-ketchup/30 p-4 flex gap-3">
                    <AlertTriangle className="text-ketchup shrink-0" />
                    <span><strong className="text-ketchup">{reais(p.vencidas)} em contas vencidas.</strong> Toque para ver e pagar.</span>
                  </button>
                )}
                {p.estoque_baixo.length > 0 && (
                  <button onClick={() => irPara('estoque')} className="w-full text-left rounded-2xl bg-mostarda/15 border border-mostarda-escura/30 p-4 flex gap-3">
                    <AlertTriangle className="text-mostarda-escura shrink-0" />
                    <span>
                      <strong>Acabando: </strong>
                      {p.estoque_baixo.map(e => `${e.nome} (${num(e.estoque)} ${e.unidade})`).join(', ')}
                    </span>
                  </button>
                )}
              </section>
            )}

            {/* Investimento × retorno */}
            <section aria-labelledby="inv" className="mt-6 rounded-2xl bg-chapa text-white p-5">
              <h2 id="inv" className="font-semibold text-white/80">Investimento na abertura</h2>
              <p className="valor text-3xl font-bold mt-1">{reais(p.investimento_total)}</p>
              <div className="mt-4 h-3 rounded-full bg-white/15 overflow-hidden" role="progressbar"
                   aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, p.retorno_percentual ?? 0)}
                   aria-label="Quanto o negócio já devolveu do investimento">
                <div className="h-full bg-mostarda rounded-full" style={{ width: `${Math.min(100, Math.max(0, p.retorno_percentual ?? 0))}%` }} />
              </div>
              <p className="mt-2 text-white/85 text-[15px]">
                {p.investimento_total === 0
                  ? 'Lance equipamentos e gastos de abertura com uma categoria de investimento para acompanhar quando eles se pagam.'
                  : p.resultado_acumulado > 0
                  ? `O negócio já devolveu ${reais(p.resultado_acumulado)} (${num(p.retorno_percentual ?? 0, 1)}%).`
                  : `Ainda não houve lucro acumulado para pagar o investimento${p.resultado_acumulado < 0 ? ` (acumulado: ${reais(p.resultado_acumulado)})` : ''}.`}
              </p>
              {p.aportado_do_bolso > 0 && (
                <p className="mt-1 text-white/70 text-sm">Do seu bolso já saíram {reais(p.aportado_do_bolso)}.</p>
              )}
            </section>

            {/* Caixa e contas a pagar */}
            <section aria-labelledby="cx" className="mt-6">
              <h2 id="cx" className="titulo text-lg font-bold mb-2">Dinheiro</h2>
              <div className="rounded-2xl bg-white border border-linha divide-y divide-linha">
                {p.contas.filter(c => c.tipo === 'empresa').map(c => (
                  <div key={c.nome} className="flex justify-between px-4 py-3">
                    <span>{c.nome}</span>
                    <span className={`valor font-semibold ${c.saldo < 0 ? 'text-ketchup' : ''}`}>{reais(c.saldo)}</span>
                  </div>
                ))}
                <button onClick={() => irPara('dinheiro')} className="w-full flex justify-between px-4 py-3 text-left">
                  <span>A pagar nos próximos 30 dias</span>
                  <span className="valor font-semibold">{reais(p.a_pagar_30d)}</span>
                </button>
              </div>
            </section>

            {p.mais_vendidos.length > 0 && (
              <section aria-labelledby="mv" className="mt-6">
                <h2 id="mv" className="titulo text-lg font-bold mb-2">Mais vendidos</h2>
                <ol className="rounded-2xl bg-white border border-linha divide-y divide-linha">
                  {p.mais_vendidos.map(m => (
                    <li key={m.produto} className="flex justify-between px-4 py-3 gap-3">
                      <span>{m.produto}</span>
                      <span className="text-chapa-2 shrink-0"><span className="valor font-semibold text-chapa">{num(m.quantidade)}</span> · {reais(m.faturamento)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {p.por_canal.length > 0 && (
              <section aria-labelledby="pc" className="mt-6">
                <h2 id="pc" className="titulo text-lg font-bold mb-2">Por canal</h2>
                <ul className="rounded-2xl bg-white border border-linha divide-y divide-linha">
                  {p.por_canal.map(c => (
                    <li key={c.canal} className="px-4 py-3">
                      <div className="flex justify-between"><span className="font-medium">{c.canal}</span><span className="valor font-semibold">{reais(c.faturamento)}</span></div>
                      <div className="text-sm text-chapa-3">{c.vendas} {c.vendas === 1 ? 'venda' : 'vendas'}{c.taxas > 0 ? ` · taxas ${reais(c.taxas)}` : ''}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid grid-cols-2 gap-3 mt-6 mb-6">
              <button onClick={() => irPara('estoque')} className="rounded-2xl border-[1.5px] border-linha bg-white p-4 text-left active:bg-linha">
                <ShoppingCart className="mb-2" /><span className="font-semibold">Registrar compra</span>
              </button>
              <button onClick={() => irPara('dinheiro')} className="rounded-2xl border-[1.5px] border-linha bg-white p-4 text-left active:bg-linha">
                <Receipt className="mb-2" /><span className="font-semibold">Lançar despesa</span>
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Linha({ nome, valor: bruto, dica, forte }: { nome: string; valor: number; dica?: string; forte?: boolean }) {
  const valor = Number(bruto) || 0; // evita "−R$ 0,00"
  return (
    <div className={`flex justify-between items-baseline gap-3 px-4 py-3 ${forte ? 'bg-fundo rounded-b-2xl' : ''}`}>
      <dt>
        <span className={forte ? 'font-bold' : ''}>{nome}</span>
        {dica && <span className="block text-xs text-chapa-3">{dica}</span>}
      </dt>
      <dd className={`valor shrink-0 ${forte ? 'font-extrabold text-lg' : 'font-semibold'} ${valor < 0 ? 'text-ketchup' : ''}`}>
        {valor < 0 ? `− ${reais(-valor)}` : reais(valor)}
      </dd>
    </div>
  );
}

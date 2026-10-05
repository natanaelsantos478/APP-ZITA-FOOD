import { useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import {
  listar, lancamentos, pagarLancamento, inserirLancamentos, salvar, excluir,
  type Categoria, type Conta, type ContaSaldo, type Lancamento,
} from '../lib/api';
import { reais, lerNumero, hojeISO, dataBR, inicioFimMes, nomeMes } from '../lib/formato';
import { Botao, Cabecalho, Campo, CampoNumero, Carregando, Erro, Folha, Segmento, Vazio, avisar, dadosMudaram, useDados } from '../ui/base';

export default function Dinheiro() {
  const [aba, setAba] = useState<'pagar' | 'receber' | 'extrato' | 'contas'>('pagar');
  const [novo, setNovo] = useState(false);
  return (
    <>
      <Cabecalho titulo="Dinheiro" acao={<Botao onClick={() => setNovo(true)}><Plus size={20} />Lançar</Botao>} />
      <main className="max-w-lg mx-auto px-4 pt-4">
        <Segmento rotulo="Ver" valor={aba} onChange={setAba} opcoes={[
          { valor: 'pagar', texto: 'A pagar' }, { valor: 'receber', texto: 'A receber' }, { valor: 'extrato', texto: 'Extrato' }, { valor: 'contas', texto: 'Saldos' },
        ]} />
        {aba === 'pagar' && <APagar tipo="despesa" />}
        {aba === 'receber' && <APagar tipo="receita" />}
        {aba === 'extrato' && <Extrato />}
        {aba === 'contas' && <Saldos />}
      </main>
      <FolhaLancamento aberta={novo ? 'novo' : null} onFechar={() => setNovo(false)} />
    </>
  );
}

function APagar({ tipo }: { tipo: 'despesa' | 'receita' }) {
  const { dados: todos, erro, recarregar } = useDados(() => lancamentos({ abertos: true }));
  const dados = todos?.filter(l => l.tipo === tipo) ?? null;
  const [aberto, setAberto] = useState<Lancamento | null>(null);
  if (erro) return <Erro texto={erro} tentar={recarregar} />;
  if (!dados) return <Carregando />;
  const hoje = hojeISO();
  const em30 = hojeISO(new Date(Date.now() + 30 * 86400000));
  const blocos = [
    { titulo: tipo === 'despesa' ? 'Vencidas' : 'Já deveria ter caído', lista: dados.filter(l => l.vencimento < hoje), cor: 'text-ketchup' },
    { titulo: 'Próximos 30 dias', lista: dados.filter(l => l.vencimento >= hoje && l.vencimento <= em30), cor: '' },
    { titulo: 'Depois', lista: dados.filter(l => l.vencimento > em30), cor: '' },
  ].filter(b => b.lista.length);
  return (
    <>
      {dados.length === 0 && <Vazio texto={tipo === 'despesa'
        ? 'Nada em aberto. Parcelas de compras e contas lançadas sem pagamento aparecem aqui.'
        : 'Nada a receber. Vendas pagas no app ou no cartão de crédito aparecem aqui até o dinheiro cair na conta.'} />}
      {blocos.map(b => (
        <section key={b.titulo} className="mt-4">
          <div className="flex justify-between mb-2">
            <h2 className={`font-semibold ${b.cor || 'text-chapa-2'}`}>{b.titulo}</h2>
            <span className={`valor font-semibold ${b.cor}`}>{reais(b.lista.reduce((s, l) => s + Number(l.valor), 0))}</span>
          </div>
          <ListaLanc lista={b.lista} onAbrir={setAberto} />
        </section>
      ))}
      <FolhaLancamento aberta={aberto} onFechar={() => setAberto(null)} />
    </>
  );
}

function Extrato() {
  const [ref, setRef] = useState(() => new Date());
  const [ini, fim] = inicioFimMes(ref);
  const { dados, erro, recarregar } = useDados(() => lancamentos({ pagosDe: ini, pagosAte: fim }), [ini, fim]);
  const [aberto, setAberto] = useState<Lancamento | null>(null);
  const mover = (d: number) => setRef(new Date(ref.getFullYear(), ref.getMonth() + d, 1));
  const entrou = dados?.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0) ?? 0;
  const saiu = dados?.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0) ?? 0;
  return (
    <>
      <div className="flex items-center justify-between mt-4">
        <button aria-label="Mês anterior" onClick={() => mover(-1)} className="p-3 rounded-full active:bg-linha"><ChevronLeft /></button>
        <span className="font-semibold first-letter:uppercase">{nomeMes(ini)}</span>
        <button aria-label="Próximo mês" onClick={() => mover(1)} className="p-3 rounded-full active:bg-linha"><ChevronRight /></button>
      </div>
      {erro && <Erro texto={erro} tentar={recarregar} />}
      {!dados && !erro && <Carregando />}
      {dados && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center my-3">
            <div className="rounded-xl bg-white border border-linha p-2"><dt className="text-xs text-chapa-3">Entrou</dt><dd className="valor font-bold text-picles">{reais(entrou)}</dd></div>
            <div className="rounded-xl bg-white border border-linha p-2"><dt className="text-xs text-chapa-3">Saiu</dt><dd className="valor font-bold text-ketchup">{reais(saiu)}</dd></div>
            <div className="rounded-xl bg-white border border-linha p-2"><dt className="text-xs text-chapa-3">Diferença</dt><dd className="valor font-bold">{reais(entrou - saiu)}</dd></div>
          </dl>
          {dados.length === 0 && <Vazio texto="Nenhum pagamento ou recebimento neste mês." />}
          <ListaLanc lista={dados} onAbrir={setAberto} data="pago" />
        </>
      )}
      <FolhaLancamento aberta={aberto} onFechar={() => setAberto(null)} />
    </>
  );
}

function ListaLanc({ lista, onAbrir, data = 'vencimento' }: { lista: Lancamento[]; onAbrir: (l: Lancamento) => void; data?: 'vencimento' | 'pago' }) {
  return (
    <ul className="rounded-2xl bg-white border border-linha divide-y divide-linha empty:hidden">
      {lista.map(l => (
        <li key={l.id}>
          <button onClick={() => onAbrir(l)} className="w-full flex justify-between gap-3 px-4 py-3 text-left active:bg-fundo">
            <span className="min-w-0">
              <span className="block font-medium truncate">{l.descricao}{l.parcela ? ` (${l.parcela})` : ''}</span>
              <span className="block text-sm text-chapa-3">{dataBR(data === 'pago' ? l.pago_em : l.vencimento)} · {l.categorias?.nome}{l.contas && data === 'pago' ? ` · ${l.contas.nome}` : ''}</span>
            </span>
            <span className={`valor font-bold shrink-0 ${l.tipo === 'receita' ? 'text-picles' : ''}`}>{l.tipo === 'receita' ? '+' : '−'} {reais(l.valor)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Saldos() {
  const { dados, erro, recarregar } = useDados(() => listar<ContaSaldo>('v_saldos_contas'));
  if (erro) return <Erro texto={erro} tentar={recarregar} />;
  if (!dados) return <Carregando />;
  const empresa = dados.filter(c => c.ativo && c.tipo === 'empresa');
  const bolso = dados.filter(c => c.ativo && c.tipo === 'dono');
  return (
    <>
      <ul className="mt-4 rounded-2xl bg-white border border-linha divide-y divide-linha">
        {empresa.map(c => (
          <li key={c.id} className="flex justify-between px-4 py-3"><span>{c.nome}</span>
            <span className={`valor font-bold ${c.saldo < 0 ? 'text-ketchup' : ''}`}>{reais(c.saldo)}</span></li>
        ))}
        <li className="flex justify-between px-4 py-3 bg-fundo rounded-b-2xl"><span className="font-semibold">Caixa da empresa</span>
          <span className="valor font-extrabold">{reais(empresa.reduce((s, c) => s + Number(c.saldo), 0))}</span></li>
      </ul>
      {bolso.map(c => (
        <div key={c.id} className="mt-4 rounded-2xl bg-kraft p-4">
          <div className="flex justify-between"><span className="font-semibold">{c.nome}</span>
            <span className="valor font-extrabold">{reais(Math.max(0, -c.saldo))}</span></div>
          <p className="text-sm text-chapa-2 mt-1">Quanto você já tirou do próprio bolso para o negócio.</p>
        </div>
      ))}
      <p className="text-sm text-chapa-3 mt-3">Saldo inicial e nomes das contas: Início → Ajustes.</p>
    </>
  );
}

// =============================================================================
// Novo lançamento / pagar / editar
// =============================================================================
function FolhaLancamento({ aberta, onFechar }: { aberta: Lancamento | 'novo' | null; onFechar: () => void }) {
  const { dados: cad } = useDados(async () => {
    const [categorias, contas] = await Promise.all([listar<Categoria>('categorias'), listar<Conta>('contas')]);
    return { categorias: categorias.filter(c => c.ativo), contas: contas.filter(c => c.ativo) };
  });
  const atual = aberta && aberta !== 'novo' ? aberta : null;
  const [chaveForm, setChaveForm] = useState<string | null>(null);
  const [f, setF] = useState({ tipo: 'despesa' as 'despesa' | 'receita', descricao: '', categoria_id: '', valor: '', vencimento: hojeISO(),
    pago: true, pago_em: hojeISO(), conta_id: '', repetir: '1' });
  const [confirmar, setConfirmar] = useState(false);

  const id = aberta === 'novo' ? 'novo' : atual?.id ?? null;
  if (id !== chaveForm) {
    setChaveForm(id); setConfirmar(false);
    setF(atual
      ? { tipo: atual.tipo, descricao: atual.descricao, categoria_id: atual.categoria_id, valor: String(atual.valor).replace('.', ','),
          vencimento: atual.vencimento, pago: !!atual.pago_em, pago_em: atual.pago_em ?? hojeISO(), conta_id: atual.conta_id ?? '', repetir: '1' }
      : { tipo: 'despesa', descricao: '', categoria_id: '', valor: '', vencimento: hojeISO(), pago: true, pago_em: hojeISO(), conta_id: '', repetir: '1' });
  }
  const contaPadrao = cad?.contas.find(c => c.tipo === 'empresa')?.id ?? cad?.contas[0]?.id ?? '';
  const contaId = f.conta_id || contaPadrao;
  const manual = !atual || atual.origem === 'manual';
  const cats = cad?.categorias.filter(c => (f.tipo === 'receita' ? c.tipo === 'receita' : c.tipo === 'despesa' || c.tipo === 'investimento')) ?? [];
  const repetir = Math.max(1, Math.min(36, Math.trunc(lerNumero(f.repetir) ?? 1)));

  async function gravar() {
    if (!manual) {
      await pagarLancamento(atual!.id, f.pago ? f.pago_em : null, f.pago ? contaId : atual!.conta_id);
      avisar(f.pago ? (atual!.tipo === 'receita' ? 'Recebimento registrado' : 'Pagamento registrado') : 'Marcado como em aberto');
      dadosMudaram(); onFechar(); return;
    }
    const valor = lerNumero(f.valor);
    if (!f.descricao.trim()) throw new Error('Descreva o lançamento');
    if (!f.categoria_id) throw new Error('Escolha a categoria');
    if (!valor || valor <= 0) throw new Error('Informe o valor');
    if (f.pago && !contaId) throw new Error('Escolha a conta');
    const base = { tipo: f.tipo, descricao: f.descricao.trim(), categoria_id: f.categoria_id, valor };
    if (atual) {
      await salvar('lancamentos', { id: atual.id, ...base, vencimento: f.vencimento, pago_em: f.pago ? f.pago_em : null, conta_id: f.pago ? contaId : null });
    } else {
      const [a, m, d] = f.vencimento.split('-').map(Number);
      await inserirLancamentos(Array.from({ length: repetir }, (_, i) => {
        const ultimoDia = new Date(a, m - 1 + i + 1, 0).getDate();
        const venc = hojeISO(new Date(a, m - 1 + i, Math.min(d, ultimoDia)));
        const pagoAgora = f.pago && i === 0;
        return { ...base, vencimento: venc, pago_em: pagoAgora ? f.pago_em : null, conta_id: pagoAgora ? contaId : null,
                 parcela: repetir > 1 ? `${i + 1}/${repetir}` : null };
      }));
    }
    avisar(atual ? 'Lançamento salvo' : repetir > 1 ? `${repetir} lançamentos criados` : 'Lançado');
    dadosMudaram(); onFechar();
  }

  return (
    <Folha aberta={!!aberta} titulo={atual ? (manual ? 'Lançamento' : 'Pagamento') : 'Novo lançamento'} onFechar={onFechar}
      rodape={<Botao largo onClick={gravar}>{atual ? 'Salvar' : 'Lançar'}</Botao>}>
      {!cad && <Carregando />}
      {cad && (
        <>
          {!manual && (
            <div className="rounded-2xl bg-kraft p-4 mb-4">
              <p className="font-semibold">{atual!.descricao}{atual!.parcela ? ` (${atual!.parcela})` : ''}</p>
              <p className="valor text-2xl font-extrabold mt-1">{reais(atual!.valor)}</p>
              <p className="text-sm text-chapa-2 mt-1">Vence {dataBR(atual!.vencimento)} · {atual!.categorias?.nome}. Veio de uma {atual!.origem}; para mudar o valor, edite a {atual!.origem}.</p>
            </div>
          )}
          {manual && (
            <>
              {!atual && <div className="mb-3"><Segmento rotulo="Tipo" valor={f.tipo} onChange={t => setF({ ...f, tipo: t, categoria_id: '' })} opcoes={[
                { valor: 'despesa', texto: 'Saída (despesa)' }, { valor: 'receita', texto: 'Entrada (receita)' },
              ]} /></div>}
              <Campo rotulo="Descrição"><input className="campo" value={f.descricao} placeholder={f.tipo === 'despesa' ? 'DAS, gás, entregador…' : 'Ex.: evento, aporte…'} onChange={e => setF({ ...f, descricao: e.target.value })} /></Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Valor (R$)"><CampoNumero valor={f.valor} onChange={v => setF({ ...f, valor: v })} placeholder="0,00" /></Campo>
                <Campo rotulo="Vencimento"><input type="date" className="campo" value={f.vencimento} onChange={e => setF({ ...f, vencimento: e.target.value })} /></Campo>
              </div>
              <Campo rotulo="Categoria">
                <select className="campo" value={f.categoria_id} onChange={e => setF({ ...f, categoria_id: e.target.value })}>
                  <option value="">Escolha…</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.nome}{c.tipo === 'investimento' ? ' (investimento)' : ''}</option>)}
                </select>
              </Campo>
              {!atual && (
                <Campo rotulo="Repetir todo mês" dica="Ex.: DAS = 12. Só o 1º fica pago; os outros entram em A pagar.">
                  <CampoNumero valor={f.repetir} onChange={v => setF({ ...f, repetir: v })} decimal={false} />
                </Campo>
              )}
            </>
          )}
          <label className="flex items-center gap-3 py-2">
            <input type="checkbox" className="w-5 h-5 accent-chapa" checked={f.pago} onChange={e => setF({ ...f, pago: e.target.checked })} />
            {f.tipo === 'receita' ? 'Já recebi' : 'Já paguei'}
          </label>
          {f.pago && (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Data"><input type="date" className="campo" value={f.pago_em} onChange={e => setF({ ...f, pago_em: e.target.value })} /></Campo>
              <Campo rotulo="Conta">
                <select className="campo" value={contaId} onChange={e => setF({ ...f, conta_id: e.target.value })}>
                  {cad.contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
            </div>
          )}
          {atual && manual && (
            !confirmar ? <Botao tipo="perigo" largo className="mt-4" onClick={() => setConfirmar(true)}><Trash2 size={18} />Excluir lançamento</Botao> : (
              <div className="rounded-2xl border border-ketchup/30 p-3 mt-4">
                <p className="mb-2">Excluir este lançamento?</p>
                <div className="flex gap-2"><Botao tipo="secundario" largo onClick={() => setConfirmar(false)}>Manter</Botao>
                  <Botao tipo="perigo" largo onClick={async () => { await excluir('lancamentos', atual.id); avisar('Lançamento excluído'); dadosMudaram(); onFechar(); }}>Excluir</Botao></div>
              </div>
            )
          )}
        </>
      )}
    </Folha>
  );
}

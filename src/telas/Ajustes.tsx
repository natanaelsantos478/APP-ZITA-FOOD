import { useRef, useState } from 'react';
import { ArrowLeft, Download, Upload, FileSpreadsheet, Plus, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VERSAO } from '../lib/versao';
import { listar, salvar, excluir, type Canal, type Categoria, type Conta, type FormaPagamento, type Insumo, type Produto } from '../lib/api';
import { MODELOS, interpretar, resumo, type TipoImport, type Resultado, type ErroLinha } from '../lib/planilhas';
import { lerPlanilha, baixarModelo, exportarTudo, executarImportacao } from '../lib/arquivo';
import { reais, num, lerNumero, chave } from '../lib/formato';
import { Botao, Campo, CampoNumero, Carregando, Folha, Segmento, avisar, avisarErro, dadosMudaram, useDados } from '../ui/base';

export default function Ajustes({ voltar }: { voltar: () => void }) {
  return (
    <>
      <header className="sticky top-0 z-30 bg-fundo/95 backdrop-blur border-b border-linha px-2 flex items-center gap-1"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}>
        <button onClick={voltar} aria-label="Voltar ao Início" className="p-2.5 rounded-full active:bg-linha"><ArrowLeft /></button>
        <h1 className="titulo text-2xl font-extrabold">Ajustes</h1>
      </header>
      <main className="max-w-lg mx-auto px-4 pt-4 pb-8 space-y-8">
        <Planilhas />
        <Formas />
        <Canais />
        <Categorias />
        <Contas />
        <MinhaConta />
      </main>
    </>
  );
}

// =============================================================================
// Planilhas
// =============================================================================
function Planilhas() {
  const [tipo, setTipo] = useState<TipoImport>('insumos');
  const [analise, setAnalise] = useState<{ arquivo: string; resultado: Resultado | null; erros: ErroLinha[] } | null>(null);
  const [progresso, setProgresso] = useState<[number, number] | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function escolher(arquivo: File) {
    try {
      const plan = await lerPlanilha(arquivo);
      const aba = plan.abas.find(a => chave(a) === chave(MODELOS[tipo].aba)) ?? plan.abas[0];
      const [insumos, produtos, categorias, contas, canais, formas] = await Promise.all([
        listar<Insumo>('insumos'), listar<Produto>('produtos'), listar<Categoria>('categorias'), listar<Conta>('contas'), listar<Canal>('canais'),
        listar<FormaPagamento>('formas_pagamento'),
      ]);
      const r = interpretar(tipo, plan.linhas(aba), { insumos, produtos, categorias, contas, canais, formas });
      setAnalise({ arquivo: `${arquivo.name} (aba "${aba}")`, ...r });
    } catch (e) { avisarErro(e); }
  }

  async function importar() {
    if (!analise?.resultado) return;
    setProgresso([0, 1]);
    let feito = 0;
    try {
      const msg = await executarImportacao(analise.resultado, (f, t) => { feito = f; setProgresso([f, t]); });
      avisar(msg); setAnalise(null); dadosMudaram();
    } catch (e) {
      avisarErro(new Error(`Parou depois de ${feito} ${feito === 1 ? 'registro gravado' : 'registros gravados'}: ${(e as Error).message}`));
      dadosMudaram();
    } finally { setProgresso(null); }
  }

  const repete = tipo === 'compras' || tipo === 'vendas' || tipo === 'lancamentos';
  return (
    <section aria-labelledby="pl">
      <h2 id="pl" className="titulo text-xl font-bold mb-1">Planilhas</h2>
      <p className="text-chapa-2 mb-3">A exportação usa as mesmas colunas da importação: exporte, ajuste no Excel ou Google Planilhas e importe de volta.</p>
      <Botao largo onClick={async () => { const r = await exportarTudo(); avisar(`Exportado — ${r}`); }}><Download size={20} />Exportar tudo (.xlsx)</Botao>

      <div className="mt-4 rounded-2xl bg-white border border-linha p-4">
        <h3 className="font-semibold mb-2">Importar</h3>
        <Campo rotulo="O que vai importar">
          <select className="campo" value={tipo} onChange={e => { setTipo(e.target.value as TipoImport); setAnalise(null); }}>
            {(Object.keys(MODELOS) as TipoImport[]).map(t => <option key={t} value={t}>{MODELOS[t].titulo}</option>)}
          </select>
        </Campo>
        <p className="text-sm text-chapa-2 mb-3">{MODELOS[tipo].descricao}{repete && ' Cada importação cria registros novos: não importe o mesmo arquivo duas vezes.'}</p>
        <div className="grid grid-cols-2 gap-2">
          <Botao tipo="secundario" onClick={() => baixarModelo(tipo)}><FileSpreadsheet size={18} />Modelo</Botao>
          <Botao tipo="secundario" onClick={() => entrada.current?.click()}><Upload size={18} />Escolher arquivo</Botao>
        </div>
        <input ref={entrada} type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden" aria-label="Arquivo da planilha"
               onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) escolher(f); }} />
      </div>

      <Folha aberta={!!analise} titulo="Conferir importação" onFechar={() => !progresso && setAnalise(null)}
        rodape={analise?.resultado && analise.erros.length === 0
          ? <Botao largo onClick={importar} disabled={!!progresso}>{progresso ? `Importando ${progresso[0]} de ${progresso[1]}…` : 'Importar agora'}</Botao>
          : <Botao tipo="secundario" largo onClick={() => setAnalise(null)}>Corrigir a planilha e escolher de novo</Botao>}>
        {analise && (
          <>
            <p className="text-sm text-chapa-3 mb-3 break-all">{analise.arquivo}</p>
            {analise.resultado && <p className="rounded-xl bg-kraft p-3 mb-3 font-medium">{resumo(analise.resultado)}</p>}
            {analise.erros.length > 0 && (
              <>
                <p className="text-ketchup font-semibold mb-2">{analise.erros.length} {analise.erros.length === 1 ? 'problema' : 'problemas'}. Nada foi gravado. Corrija e escolha o arquivo de novo:</p>
                <ul className="divide-y divide-linha rounded-xl border border-linha bg-white">
                  {analise.erros.slice(0, 100).map((e, i) => (
                    <li key={i} className="px-3 py-2 text-[15px]"><span className="font-semibold">Linha {e.linha}:</span> {e.mensagem}</li>
                  ))}
                </ul>
              </>
            )}
            {analise.resultado?.tipo === 'compras' && analise.erros.length === 0 && (
              <ul className="text-sm text-chapa-2 space-y-1">
                {analise.resultado.itens.slice(0, 50).map((c, i) => (
                  <li key={i}>{c.data.split('-').reverse().join('/')} · {c.fornecedor ?? 'sem fornecedor'} · {c.itens.length} itens · {reais(c.itens.reduce((s, x) => s + x.valor_total, 0) + c.frete - c.desconto)}{c.parcelas > 1 ? ` · ${c.parcelas}x` : ''}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </Folha>
    </section>
  );
}

// =============================================================================
// Cadastros simples (canais, categorias, contas)
// =============================================================================
function ListaSimples<T extends { id: string; nome: string; ativo: boolean }>({ titulo, explicacao, itens, detalhe, onAbrir, onNovo }: {
  titulo: string; explicacao: string; itens: T[] | null; detalhe: (x: T) => string; onAbrir: (x: T) => void; onNovo: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="titulo text-xl font-bold">{titulo}</h2>
        <Botao tipo="secundario" onClick={onNovo} className="min-h-10"><Plus size={18} />Novo</Botao>
      </div>
      <p className="text-chapa-2 mb-3">{explicacao}</p>
      {!itens ? <Carregando /> : (
        <ul className="rounded-2xl bg-white border border-linha divide-y divide-linha">
          {itens.map(x => (
            <li key={x.id}>
              <button onClick={() => onAbrir(x)} className={`w-full flex justify-between gap-3 px-4 py-3 text-left active:bg-fundo ${x.ativo ? '' : 'opacity-50'}`}>
                <span className="font-medium">{x.nome}</span><span className="text-chapa-2 text-right">{detalhe(x)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Canais() {
  const { dados } = useDados(() => listar<Canal>('canais'));
  const { dados: formas } = useDados(() => listar<FormaPagamento>('formas_pagamento'));
  const [ed, setEd] = useState<Partial<Canal> & { pct?: string; fixa?: string } | null>(null);
  return (
    <>
      <ListaSimples titulo="Canais de venda" explicacao="Onde você vende e quanto cada um cobra de comissão. O iFood (plano Entrega) cobra 23% de comissão mais 3,2% de pagamento online."
        itens={dados} detalhe={c => `${num(c.taxa_percentual, 2)}%${Number(c.taxa_fixa) ? ` + ${reais(c.taxa_fixa)}` : ''}`}
        onAbrir={c => setEd({ ...c, pct: String(c.taxa_percentual).replace('.', ','), fixa: String(c.taxa_fixa).replace('.', ',') })}
        onNovo={() => setEd({ nome: '', pct: '0', fixa: '0', ativo: true })} />
      <Folha aberta={!!ed} titulo={ed?.id ? 'Canal' : 'Novo canal'} onFechar={() => setEd(null)}
        rodape={<Botao largo onClick={async () => {
          const pct = lerNumero(ed!.pct); const fixa = lerNumero(ed!.fixa);
          if (!ed!.nome?.trim()) throw new Error('Dê um nome ao canal');
          if (pct === null || pct < 0 || pct > 100) throw new Error('Taxa % entre 0 e 100');
          if (fixa === null || fixa < 0) throw new Error('Taxa fixa inválida');
          await salvar('canais', { id: ed!.id, nome: ed!.nome.trim(), taxa_percentual: pct, taxa_fixa: fixa, ativo: ed!.ativo ?? true,
            forma_padrao_id: ed!.forma_padrao_id || null });
          avisar('Canal salvo'); setEd(null); dadosMudaram();
        }}>Salvar</Botao>}>
        {ed && <>
          <Campo rotulo="Nome"><input className="campo" value={ed.nome ?? ''} onChange={e => setEd({ ...ed, nome: e.target.value })} placeholder="Ex.: Rappi, 99Food, Balcão cartão" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Taxa (%)" dica="Comissão + pagamento"><CampoNumero valor={ed.pct ?? ''} onChange={v => setEd({ ...ed, pct: v })} /></Campo>
            <Campo rotulo="Taxa fixa por pedido (R$)"><CampoNumero valor={ed.fixa ?? ''} onChange={v => setEd({ ...ed, fixa: v })} /></Campo>
          </div>
          <Campo rotulo="Forma de pagamento padrão" dica='Já vem marcada na comanda. Ex.: iFood → "Pago no app".'>
            <select className="campo" value={ed.forma_padrao_id ?? ''} onChange={e => setEd({ ...ed, forma_padrao_id: e.target.value || null })}>
              <option value="">Nenhuma (escolho na hora)</option>
              {(formas ?? []).filter(f => f.ativo || f.id === ed.forma_padrao_id).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <Ativo valor={ed.ativo ?? true} onChange={v => setEd({ ...ed, ativo: v })} texto="Em uso" />
          {ed.id && <Excluir onExcluir={async () => { await excluir('canais', ed.id!); avisar('Canal excluído'); setEd(null); dadosMudaram(); }} />}
        </>}
      </Folha>
    </>
  );
}

function Formas() {
  const { dados } = useDados(() => listar<FormaPagamento>('formas_pagamento'));
  const { dados: contas } = useDados(() => listar<Conta>('contas'));
  const [ed, setEd] = useState<Partial<FormaPagamento> & { pct?: string; fixa?: string; dias?: string } | null>(null);
  return (
    <>
      <ListaSimples titulo="Formas de pagamento" explicacao="Quanto a maquininha ou o app cobra e em quantos dias o dinheiro cai. Com prazo, a venda fica em Dinheiro → A receber."
        itens={dados} detalhe={f => `${num(f.taxa_percentual, 2)}%${Number(f.taxa_fixa) ? ` + ${reais(f.taxa_fixa)}` : ''} · ${f.dias_recebimento === 0 ? 'na hora' : `${f.dias_recebimento}d`}`}
        onAbrir={f => setEd({ ...f, pct: String(f.taxa_percentual).replace('.', ','), fixa: String(f.taxa_fixa).replace('.', ','), dias: String(f.dias_recebimento) })}
        onNovo={() => setEd({ nome: '', pct: '0', fixa: '0', dias: '0', ativo: true, conta_id: contas?.find(c => c.tipo === 'empresa')?.id ?? null })} />
      <Folha aberta={!!ed} titulo={ed?.id ? 'Forma de pagamento' : 'Nova forma de pagamento'} onFechar={() => setEd(null)}
        rodape={<Botao largo onClick={async () => {
          const pct = lerNumero(ed!.pct); const fixa = lerNumero(ed!.fixa); const dias = lerNumero(ed!.dias);
          if (!ed!.nome?.trim()) throw new Error('Dê um nome à forma de pagamento');
          if (pct === null || pct < 0 || pct > 100) throw new Error('Taxa % entre 0 e 100');
          if (fixa === null || fixa < 0) throw new Error('Taxa fixa inválida');
          if (dias === null || dias < 0 || dias > 120 || !Number.isInteger(dias)) throw new Error('Dias para receber: número inteiro de 0 a 120');
          if (!ed!.conta_id) throw new Error('Escolha em qual conta o dinheiro cai');
          await salvar('formas_pagamento', { id: ed!.id, nome: ed!.nome.trim(), taxa_percentual: pct, taxa_fixa: fixa, dias_recebimento: dias,
            conta_id: ed!.conta_id, ativo: ed!.ativo ?? true });
          avisar('Forma de pagamento salva'); setEd(null); dadosMudaram();
        }}>Salvar</Botao>}>
        {ed && <>
          <Campo rotulo="Nome"><input className="campo" value={ed.nome ?? ''} onChange={e => setEd({ ...ed, nome: e.target.value })} placeholder="Ex.: Crédito maquininha Stone" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Taxa (%)"><CampoNumero valor={ed.pct ?? ''} onChange={v => setEd({ ...ed, pct: v })} /></Campo>
            <Campo rotulo="Taxa fixa (R$)"><CampoNumero valor={ed.fixa ?? ''} onChange={v => setEd({ ...ed, fixa: v })} /></Campo>
          </div>
          <Campo rotulo="Dias para o dinheiro cair" dica="0 = na hora (dinheiro, Pix). Crédito costuma ser 30; iFood depende do seu plano de repasse.">
            <CampoNumero valor={ed.dias ?? ''} onChange={v => setEd({ ...ed, dias: v })} decimal={false} />
          </Campo>
          <Campo rotulo="Cai na conta">
            <select className="campo" value={ed.conta_id ?? ''} onChange={e => setEd({ ...ed, conta_id: e.target.value || null })}>
              <option value="">Escolha…</option>
              {(contas ?? []).filter(c => c.tipo === 'empresa' && (c.ativo || c.id === ed.conta_id)).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Ativo valor={ed.ativo ?? true} onChange={v => setEd({ ...ed, ativo: v })} texto="Em uso" />
          {ed.id && <Excluir onExcluir={async () => { await excluir('formas_pagamento', ed.id!); avisar('Forma excluída'); setEd(null); dadosMudaram(); }} />}
        </>}
      </Folha>
    </>
  );
}

const TIPOS_CAT: { valor: Categoria['tipo']; texto: string; dica: string }[] = [
  { valor: 'despesa', texto: 'Despesa', dica: 'Gasto do dia a dia: entra no resultado do mês (DAS, gás, juros).' },
  { valor: 'investimento', texto: 'Investimento', dica: 'Gasto de abertura/equipamento: fica no "investimento" e não pesa no lucro do mês.' },
  { valor: 'receita', texto: 'Receita', dica: 'Dinheiro que entra além das vendas.' },
  { valor: 'estoque', texto: 'Estoque', dica: 'Compra de insumo: vira custo só quando o insumo é vendido.' },
];

function Categorias() {
  const { dados } = useDados(() => listar<Categoria>('categorias'));
  const [ed, setEd] = useState<Partial<Categoria> | null>(null);
  const tipo = TIPOS_CAT.find(t => t.valor === ed?.tipo);
  return (
    <>
      <ListaSimples titulo="Categorias" explicacao="Para separar despesas de investimentos e saber para onde vai o dinheiro."
        itens={dados} detalhe={c => TIPOS_CAT.find(t => t.valor === c.tipo)?.texto ?? c.tipo}
        onAbrir={c => setEd(c)} onNovo={() => setEd({ nome: '', tipo: 'despesa', ativo: true })} />
      <Folha aberta={!!ed} titulo={ed?.id ? 'Categoria' : 'Nova categoria'} onFechar={() => setEd(null)}
        rodape={<Botao largo onClick={async () => {
          if (!ed!.nome?.trim()) throw new Error('Dê um nome à categoria');
          await salvar('categorias', { id: ed!.id, nome: ed!.nome.trim(), tipo: ed!.tipo, ativo: ed!.ativo ?? true });
          avisar('Categoria salva'); setEd(null); dadosMudaram();
        }}>Salvar</Botao>}>
        {ed && <>
          <Campo rotulo="Nome"><input className="campo" value={ed.nome ?? ''} onChange={e => setEd({ ...ed, nome: e.target.value })} /></Campo>
          <Campo rotulo="Tipo" dica={tipo?.dica}>
            <select className="campo" value={ed.tipo} onChange={e => setEd({ ...ed, tipo: e.target.value as Categoria['tipo'] })}>
              {TIPOS_CAT.map(t => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
            </select>
          </Campo>
          <Ativo valor={ed.ativo ?? true} onChange={v => setEd({ ...ed, ativo: v })} texto="Em uso" />
          {ed.id && <Excluir onExcluir={async () => { await excluir('categorias', ed.id!); avisar('Categoria excluída'); setEd(null); dadosMudaram(); }} />}
        </>}
      </Folha>
    </>
  );
}

function Contas() {
  const { dados } = useDados(() => listar<Conta>('contas'));
  const [ed, setEd] = useState<Partial<Conta> & { inicial?: string } | null>(null);
  return (
    <>
      <ListaSimples titulo="Contas" explicacao='Onde o dinheiro fica. "Do meu bolso" registra o que você tira do próprio bolso para o negócio.'
        itens={dados} detalhe={c => (c.tipo === 'dono' ? 'seu bolso' : `início ${reais(c.saldo_inicial)}`)}
        onAbrir={c => setEd({ ...c, inicial: String(c.saldo_inicial).replace('.', ',') })}
        onNovo={() => setEd({ nome: '', tipo: 'empresa', inicial: '0', ativo: true })} />
      <Folha aberta={!!ed} titulo={ed?.id ? 'Conta' : 'Nova conta'} onFechar={() => setEd(null)}
        rodape={<Botao largo onClick={async () => {
          const ini = lerNumero(ed!.inicial);
          if (!ed!.nome?.trim()) throw new Error('Dê um nome à conta');
          if (ini === null) throw new Error('Saldo inicial inválido');
          await salvar('contas', { id: ed!.id, nome: ed!.nome.trim(), tipo: ed!.tipo, saldo_inicial: ini, ativo: ed!.ativo ?? true });
          avisar('Conta salva'); setEd(null); dadosMudaram();
        }}>Salvar</Botao>}>
        {ed && <>
          <Campo rotulo="Nome"><input className="campo" value={ed.nome ?? ''} onChange={e => setEd({ ...ed, nome: e.target.value })} placeholder="Ex.: Mercado Pago, Nubank PJ" /></Campo>
          <div className="mb-3"><Segmento rotulo="De quem é o dinheiro" valor={ed.tipo ?? 'empresa'} onChange={v => setEd({ ...ed, tipo: v })}
            opcoes={[{ valor: 'empresa', texto: 'Da empresa' }, { valor: 'dono', texto: 'Meu bolso' }]} /></div>
          <Campo rotulo="Saldo no dia em que começou a usar o app (R$)"><CampoNumero valor={ed.inicial ?? ''} onChange={v => setEd({ ...ed, inicial: v })} /></Campo>
          <Ativo valor={ed.ativo ?? true} onChange={v => setEd({ ...ed, ativo: v })} texto="Em uso" />
          {ed.id && <Excluir onExcluir={async () => { await excluir('contas', ed.id!); avisar('Conta excluída'); setEd(null); dadosMudaram(); }} />}
        </>}
      </Folha>
    </>
  );
}

function Ativo({ valor, onChange, texto }: { valor: boolean; onChange: (v: boolean) => void; texto: string }) {
  return (
    <label className="flex items-center gap-3 py-2">
      <input type="checkbox" className="w-5 h-5 accent-chapa" checked={valor} onChange={e => onChange(e.target.checked)} />{texto}
    </label>
  );
}

function Excluir({ onExcluir }: { onExcluir: () => Promise<void> }) {
  const [c, setC] = useState(false);
  return !c ? <Botao tipo="perigo" largo className="mt-3" onClick={() => setC(true)}>Excluir</Botao> : (
    <div className="rounded-2xl border border-ketchup/30 p-3 mt-3">
      <p className="mb-2">Só dá para excluir o que nunca foi usado. Se já foi usado, desmarque "Em uso".</p>
      <div className="flex gap-2"><Botao tipo="secundario" largo onClick={() => setC(false)}>Manter</Botao><Botao tipo="perigo" largo onClick={onExcluir}>Excluir</Botao></div>
    </div>
  );
}

// =============================================================================
// Minha conta
// =============================================================================
function MinhaConta() {
  const { dados: email } = useDados(async () => (await supabase.auth.getUser()).data.user?.email ?? '');
  const [senha, setSenha] = useState<string | null>(null);
  return (
    <section>
      <h2 className="titulo text-xl font-bold mb-1">Sua conta</h2>
      <p className="text-chapa-2 mb-3">Entrou como {email} · versão {VERSAO}</p>
      <div className="grid grid-cols-2 gap-2">
        <Botao tipo="secundario" onClick={() => setSenha('')}>Trocar senha</Botao>
        <Botao tipo="secundario" onClick={async () => { await supabase.auth.signOut(); }}><LogOut size={18} />Sair</Botao>
      </div>
      <Folha aberta={senha !== null} titulo="Trocar senha" onFechar={() => setSenha(null)}
        rodape={<Botao largo onClick={async () => {
          if ((senha ?? '').length < 8) throw new Error('Use pelo menos 8 caracteres');
          const { error } = await supabase.auth.updateUser({ password: senha! });
          if (error) throw error;
          avisar('Senha trocada'); setSenha(null);
        }}>Salvar nova senha</Botao>}>
        <Campo rotulo="Nova senha" dica="Pelo menos 8 caracteres">
          <input className="campo" type="password" autoComplete="new-password" value={senha ?? ''} onChange={e => setSenha(e.target.value)} />
        </Campo>
      </Folha>
    </section>
  );
}

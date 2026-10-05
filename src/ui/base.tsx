import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { mensagemErro } from '../lib/formato';

// ---------- Aviso (toast) ----------
type Aviso = { id: number; texto: string; erro?: boolean };
let ouvinte: ((a: Aviso) => void) | null = null;
let seq = 0;
export const avisar = (texto: string) => ouvinte?.({ id: ++seq, texto });
export const avisarErro = (e: unknown) => ouvinte?.({ id: ++seq, texto: mensagemErro(e), erro: true });

export function Avisos() {
  const [lista, setLista] = useState<Aviso[]>([]);
  useEffect(() => {
    ouvinte = a => {
      setLista(l => [...l, a]);
      setTimeout(() => setLista(l => l.filter(x => x.id !== a.id)), a.erro ? 6000 : 2800);
    };
    return () => { ouvinte = null; };
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pointer-events-none"
         style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }} aria-live="polite">
      {lista.map(a => (
        <div key={a.id} role={a.erro ? 'alert' : 'status'}
             className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-[15px] font-medium shadow-lg ${a.erro ? 'bg-ketchup text-white' : 'bg-chapa text-white'}`}>
          {a.texto}
        </div>
      ))}
    </div>
  );
}

// ---------- Botões ----------
interface BotaoProps {
  children: ReactNode; onClick?: () => void | Promise<void>; tipo?: 'principal' | 'secundario' | 'perigo' | 'texto';
  type?: 'button' | 'submit'; disabled?: boolean; largo?: boolean; className?: string; rotulo?: string;
}
export function Botao({ children, onClick, tipo = 'principal', type = 'button', disabled, largo, className = '', rotulo }: BotaoProps) {
  const [ocupado, setOcupado] = useState(false);
  const estilos = {
    principal: 'bg-mostarda text-chapa active:bg-mostarda-escura font-semibold',
    secundario: 'bg-white border-[1.5px] border-linha text-chapa active:bg-linha font-medium',
    perigo: 'bg-white border-[1.5px] border-ketchup/40 text-ketchup active:bg-ketchup/10 font-medium',
    texto: 'text-chapa-2 underline-offset-4 active:underline font-medium',
  }[tipo];
  return (
    <button type={type} aria-label={rotulo} disabled={disabled || ocupado}
      onClick={onClick ? async () => {
        setOcupado(true);
        try { await onClick(); } catch (e) { avisarErro(e); } finally { setOcupado(false); }
      } : undefined}
      className={`min-h-12 rounded-xl px-4 inline-flex items-center justify-center gap-2 disabled:opacity-50 ${estilos} ${largo ? 'w-full' : ''} ${className}`}>
      {ocupado && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------- Folha (painel que sobe de baixo) ----------
export function Folha({ aberta, titulo, onFechar, children, rodape }: {
  aberta: boolean; titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberta) return;
    // só a folha de cima fecha (folhas podem abrir dentro de folhas)
    const doTopo = () => { const t = document.querySelectorAll('[role="dialog"]'); return t[t.length - 1] === ref.current; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && doTopo()) onFechar(); };
    const voltar = () => { if (doTopo()) onFechar(); };
    window.addEventListener('keydown', esc);
    window.addEventListener('app:voltar', voltar);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('app:voltar', voltar); };
  }, [aberta, onFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-chapa/50" onClick={onFechar}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo}
           className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl bg-fundo shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="titulo text-xl font-bold">{titulo}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="-mr-2 p-2 rounded-full active:bg-linha"><X size={24} /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-4 flex-1">{children}</div>
        {rodape && <div className="border-t border-linha px-5 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>{rodape}</div>}
      </div>
    </div>
  );
}

// ---------- Formulário ----------
export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-chapa-2 mb-1">{rotulo}</span>
      {children}
      {dica && <span className="block text-xs text-chapa-3 mt-1">{dica}</span>}
    </label>
  );
}

/** Campo numérico que aceita vírgula ("1,5") */
export function CampoNumero({ valor, onChange, placeholder, rotulo, decimal = true, autoFocus }: {
  valor: string; onChange: (v: string) => void; placeholder?: string; rotulo?: string; decimal?: boolean; autoFocus?: boolean;
}) {
  return (
    <input className="campo valor" inputMode={decimal ? 'decimal' : 'numeric'} value={valor} placeholder={placeholder}
      aria-label={rotulo} autoFocus={autoFocus}
      onChange={e => onChange(e.target.value.replace(/[^\d.,-]/g, ''))} />
  );
}

export function Segmento<T extends string>({ opcoes, valor, onChange, rotulo }: {
  opcoes: { valor: T; texto: string }[]; valor: T; onChange: (v: T) => void; rotulo: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex gap-2 overflow-x-auto pb-1">
      {opcoes.map(o => (
        <button key={o.valor} role="radio" aria-checked={valor === o.valor} onClick={() => onChange(o.valor)}
          className={`shrink-0 min-h-11 rounded-full px-4 text-[15px] font-medium border-[1.5px] ${valor === o.valor ? 'bg-chapa text-white border-chapa' : 'bg-white border-linha text-chapa-2'}`}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

// ---------- Estados ----------
export function Carregando() {
  return <div className="flex justify-center py-16 text-chapa-3"><Loader2 className="animate-spin" size={28} aria-label="Carregando" /></div>;
}

export function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div className="py-12 text-center">
      <p className="text-chapa-2 mb-4 max-w-xs mx-auto">{texto}</p>
      {acao}
    </div>
  );
}

export function Cabecalho({ titulo, acao, logo }: { titulo: string; acao?: ReactNode; logo?: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-fundo/95 backdrop-blur border-b border-linha px-4 flex items-center justify-between gap-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingBottom: 10 }}>
      <div className="flex items-center gap-2.5 min-w-0">
        {logo && <img src="./kbritos-logo.webp" alt="K'Britos" className="h-10 w-auto shrink-0" />}
        <h1 className="titulo text-2xl font-extrabold">{titulo}</h1>
      </div>
      {acao}
    </header>
  );
}

// ---------- Dados ----------
export function useDados<T>(carregar: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const versao = useRef(0);
  const recarregar = useCallback(async () => {
    const v = ++versao.current;
    try {
      const d = await carregar();
      if (v === versao.current) { setDados(d); setErro(null); }
    } catch (e) {
      if (v === versao.current) setErro(mensagemErro(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => {
    const f = () => recarregar();
    window.addEventListener('app:dados-mudaram', f);
    return () => window.removeEventListener('app:dados-mudaram', f);
  }, [recarregar]);
  return { dados, erro, recarregar };
}

/** Avisa todas as telas que algo mudou no banco */
export const dadosMudaram = () => window.dispatchEvent(new Event('app:dados-mudaram'));

export function Erro({ texto, tentar }: { texto: string; tentar: () => void }) {
  return (
    <div className="m-4 rounded-xl border-[1.5px] border-ketchup/30 bg-white p-4">
      <p className="text-ketchup font-medium mb-3">{texto}</p>
      <Botao tipo="secundario" onClick={tentar}>Tentar de novo</Botao>
    </div>
  );
}

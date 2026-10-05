// Formatação e leitura de números/datas no padrão brasileiro. Funções puras (testadas em tests/).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (v: number | string | null | undefined) => brl.format(Number(v ?? 0));

export const num = (v: number | string | null | undefined, casas = 3) =>
  Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

export const pct = (v: number | null | undefined, casas = 1) =>
  `${Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;

/** Lê número digitado ou de planilha: "1.234,56", "1234,56", "1234.56", "R$ 12,90", 12.9 */
export function lerNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (s === '') return null;
  const neg = s.startsWith('-');
  s = s.replace(/^-/, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.234 (milhar sem decimais)
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Data local AAAA-MM-DD (fuso do aparelho) */
export function hojeISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lê data: "05/10/2026", "5/10/26", "2026-10-05", número serial do Excel, objeto Date */
export function lerData(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return hojeISO(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // serial do Excel (1900): dia 25569 = 1970-01-01
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valida(ano, +m[2], +m[1]);
  }
  return null;
}

function valida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${a}-${pad(m)}-${pad(d)}`;
}

export const dataBR = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const dataHoraBR = (ts: string) =>
  new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function inicioFimMes(ref = new Date()): [string, string] {
  const ini = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return [hojeISO(ini), hojeISO(fim)];
}

export const nomeMes = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

/** Normaliza texto para comparar nomes vindos de planilha */
export const chave = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Mensagem de erro amigável a partir do erro do banco */
export function mensagemErro(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/duplicate key|unique/i.test(m)) return 'Já existe um cadastro com esse nome.';
  if (/foreign key|violates foreign key|still referenced/i.test(m))
    return 'Esse item está em uso (em compras, vendas ou fichas). Desative em vez de excluir.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem internet. Confira a conexão e tente de novo.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/JWT|not authenticated/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  return m;
}

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Botao, Campo, avisarErro } from '../ui/base';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setOcupado(false);
    if (error) avisarErro(error);
  }

  return (
    <main className="min-h-full bg-[#5B0318] flex flex-col items-center justify-center px-6 py-10"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
      <img src="./kbritos-logo.webp" alt="K'Britos" className="w-64 max-w-[75vw] h-auto mb-8 drop-shadow-xl" />
      <form onSubmit={entrar} className="w-full max-w-sm rounded-3xl bg-[#FBF1DC] p-6 shadow-2xl">
        <h1 className="titulo text-2xl font-extrabold mb-1">Entrar</h1>
        <p className="text-chapa-2 mb-5">Vendas, estoque e dinheiro da K'Britos.</p>
        <Campo rotulo="E-mail">
          <input className="campo" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </Campo>
        <Campo rotulo="Senha">
          <input className="campo" type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
        </Campo>
        <Botao type="submit" largo disabled={ocupado} className="mt-3 text-lg">{ocupado ? 'Entrando…' : 'Entrar'}</Botao>
      </form>
    </main>
  );
}

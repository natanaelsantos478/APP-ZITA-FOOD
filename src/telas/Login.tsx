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
    <main className="min-h-full flex flex-col justify-center px-6 py-10 max-w-sm mx-auto">
      <div className="mb-10">
        <div className="w-14 h-14 rounded-2xl bg-mostarda mb-5 flex items-end justify-center overflow-hidden" aria-hidden>
          <div className="w-10 h-3 rounded-t-full bg-chapa mb-2" />
        </div>
        <h1 className="titulo text-3xl font-extrabold leading-tight">Controle da hamburgueria</h1>
        <p className="text-chapa-2 mt-2">Vendas, estoque e dinheiro no mesmo lugar.</p>
      </div>
      <form onSubmit={entrar}>
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

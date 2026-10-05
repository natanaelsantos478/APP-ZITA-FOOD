import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { App as AppNativo } from '@capacitor/app';
import { Home, ShoppingBag, Package, BookOpen, Wallet } from 'lucide-react';
import { supabase } from './lib/supabase';
import { Avisos, Carregando } from './ui/base';
import Login from './telas/Login';
import Inicio from './telas/Inicio';
import Vender from './telas/Vender';
import Estoque from './telas/Estoque';
import Cardapio from './telas/Cardapio';
import Dinheiro from './telas/Dinheiro';
import Ajustes from './telas/Ajustes';

export type Aba = 'inicio' | 'vender' | 'estoque' | 'cardapio' | 'dinheiro' | 'ajustes';

const ABAS: { id: Exclude<Aba, 'ajustes'>; texto: string; Icone: typeof Home }[] = [
  { id: 'inicio', texto: 'Início', Icone: Home },
  { id: 'vender', texto: 'Vender', Icone: ShoppingBag },
  { id: 'estoque', texto: 'Estoque', Icone: Package },
  { id: 'cardapio', texto: 'Cardápio', Icone: BookOpen },
  { id: 'dinheiro', texto: 'Dinheiro', Icone: Wallet },
];

export default function App() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);
  const [aba, setAba] = useState<Aba>('inicio');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Botão "voltar" do Android: fecha a folha aberta → volta ao Início → sai do app
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = AppNativo.addListener('backButton', () => {
      if (document.querySelector('[role="dialog"]')) window.dispatchEvent(new Event('app:voltar'));
      else if (aba !== 'inicio') setAba('inicio');
      else AppNativo.exitApp();
    });
    return () => { h.then(x => x.remove()); };
  }, [aba]);

  useEffect(() => { window.scrollTo(0, 0); }, [aba]);

  if (sessao === undefined) return <Carregando />;
  if (!sessao) return (<><Avisos /><Login /></>);

  return (
    <div className="min-h-full pb-seguro">
      <Avisos />
      {aba === 'inicio' && <Inicio irPara={setAba} />}
      {aba === 'vender' && <Vender />}
      {aba === 'estoque' && <Estoque />}
      {aba === 'cardapio' && <Cardapio />}
      {aba === 'dinheiro' && <Dinheiro />}
      {aba === 'ajustes' && <Ajustes voltar={() => setAba('inicio')} />}

      <nav aria-label="Telas" className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-linha"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="max-w-lg mx-auto grid grid-cols-5">
          {ABAS.map(({ id, texto, Icone }) => {
            const ativo = aba === id;
            return (
              <li key={id}>
                <button onClick={() => setAba(id)} aria-current={ativo ? 'page' : undefined}
                  className={`w-full h-16 flex flex-col items-center justify-center gap-0.5 text-[12px] ${ativo ? 'text-chapa font-bold' : 'text-chapa-3 font-medium'}`}>
                  <span className={`flex items-center justify-center w-14 h-8 rounded-full ${ativo ? (id === 'vender' ? 'bg-mostarda' : 'bg-kraft') : ''}`}>
                    <Icone size={22} strokeWidth={ativo ? 2.4 : 2} />
                  </span>
                  {texto}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

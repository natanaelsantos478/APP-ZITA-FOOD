import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_KEY as string;

if (!url || !key) throw new Error('Configuração do servidor ausente (VITE_SUPABASE_URL / VITE_SUPABASE_KEY)');

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

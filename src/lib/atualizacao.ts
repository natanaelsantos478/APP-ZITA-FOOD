// Atualização automática: o app confere em public.app_versoes se há pacote (telas/lógica) mais novo
// e instala sozinho; se há APK mais novo, avisa para baixar.
import { Capacitor } from '@capacitor/core';
import { App as AppNativo } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { supabase } from './supabase';
import { VERSAO_CODIGO } from './versao';

export interface ApkNovo { versao: string; url: string; notas: string | null }

/** Chamar logo que o app abre: confirma que o pacote atual funciona (senão o plugin volta ao anterior). */
export async function confirmarPacoteOk() {
  if (!Capacitor.isNativePlatform()) return;
  try { await CapacitorUpdater.notifyAppReady(); } catch { /* sem pacote baixado */ }
}

/** Confere e aplica atualização. Devolve APK novo, se houver, para a tela avisar. */
export async function verificarAtualizacao(aoAtualizar: (msg: string) => void): Promise<ApkNovo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const { data, error } = await supabase.from('app_versoes').select('tipo, versao, codigo, url, checksum, notas')
    .order('codigo', { ascending: false }).limit(20);
  if (error || !data) return null;

  const info = await AppNativo.getInfo();
  const apk = data.find(v => v.tipo === 'apk');
  if (apk && apk.codigo > Number(info.build)) return { versao: apk.versao, url: apk.url, notas: apk.notas };

  const pacote = data.find(v => v.tipo === 'pacote');
  if (pacote && pacote.codigo > VERSAO_CODIGO) {
    aoAtualizar(`Atualizando para a versão ${pacote.versao}…`);
    const bundle = await CapacitorUpdater.download({ url: pacote.url, version: pacote.versao, ...(pacote.checksum ? { checksum: pacote.checksum } : {}) });
    await CapacitorUpdater.set({ id: bundle.id });   // recarrega já na versão nova
  }
  return null;
}

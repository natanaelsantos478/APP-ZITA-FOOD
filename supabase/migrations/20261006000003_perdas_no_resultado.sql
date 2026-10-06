-- =============================================================================
-- v1.2.2 — perdas de estoque entram no resultado (antes sumiam: compra de insumo é "estoque",
--          só vira custo na venda; perda/quebra de contagem nunca virava custo)
-- =============================================================================
create or replace function public.painel(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  r jsonb;
  v_vendas record;
  v_desp numeric; v_desp_pagas numeric; v_estoque_compras numeric;
  v_invest_total numeric; v_aporte numeric; v_result_total numeric; v_perdas numeric;
begin
  perform public.exigir_membro();

  select count(*) as qtd, coalesce(sum(total),0) as faturamento, coalesce(sum(taxa_canal + taxa_pagamento),0) as taxas,
         coalesce(sum(liquido),0) as liquido, coalesce(sum(custo_total),0) as cmv
    into v_vendas
    from public.vendas
   where status = 'concluida' and (data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;

  select coalesce(sum(l.valor),0), coalesce(sum(l.valor) filter (where l.pago_em is not null),0)
    into v_desp, v_desp_pagas
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'despesa' and l.vencimento between p_inicio and p_fim;

  select coalesce(sum(l.valor),0) into v_estoque_compras
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'estoque' and l.vencimento between p_inicio and p_fim;

  -- perdas de estoque no período: perda + contagem que achou menos (sobra na contagem reduz)
  select coalesce(sum(case when m.tipo = 'saida' then 1 else -1 end * m.quantidade * m.custo_unitario), 0) into v_perdas
    from public.movimentos m
   where (m.origem = 'perda' or m.origem = 'contagem')
     and (m.data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;

  select coalesce(sum(l.valor),0) into v_invest_total
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'investimento';

  select coalesce(sum(l.valor),0) into v_aporte
    from public.lancamentos l join public.contas ct on ct.id = l.conta_id
   where l.tipo = 'despesa' and l.pago_em is not null and ct.tipo = 'dono';

  -- acumulado até hoje (vendas pela data da venda; despesas/receitas avulsas pelo vencimento ≤ hoje)
  select coalesce((select sum(liquido - custo_total) from public.vendas
                    where status = 'concluida' and (data at time zone 'America/Sao_Paulo')::date <= current_date),0)
       - coalesce((select sum(l.valor) from public.lancamentos l join public.categorias c on c.id = l.categoria_id
                    where l.tipo = 'despesa' and c.tipo = 'despesa' and l.vencimento <= current_date),0)
       + coalesce((select sum(l.valor) from public.lancamentos l
                    where l.tipo = 'receita' and l.origem = 'manual' and l.vencimento <= current_date),0)
       - coalesce((select sum(case when m.tipo = 'saida' then 1 else -1 end * m.quantidade * m.custo_unitario)
                     from public.movimentos m
                    where (m.origem = 'perda' or m.origem = 'contagem')
                      and (m.data at time zone 'America/Sao_Paulo')::date <= current_date),0)
    into v_result_total;

  r := jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'vendas', jsonb_build_object(
      'quantidade', v_vendas.qtd, 'faturamento', v_vendas.faturamento, 'taxas_canal', v_vendas.taxas,
      'liquido', v_vendas.liquido, 'cmv', v_vendas.cmv, 'lucro_bruto', v_vendas.liquido - v_vendas.cmv,
      'ticket_medio', case when v_vendas.qtd > 0 then round(v_vendas.faturamento / v_vendas.qtd, 2) else 0 end),
    'despesas_operacionais', v_desp,
    'perdas_estoque', round(v_perdas, 2),
    'despesas_operacionais_pagas', v_desp_pagas,
    'compras_estoque', v_estoque_compras,
    'outras_receitas', (select coalesce(sum(l.valor),0) from public.lancamentos l
                         where l.tipo = 'receita' and l.origem = 'manual' and l.vencimento between p_inicio and p_fim),
    'resultado', v_vendas.liquido - v_vendas.cmv - v_desp - round(v_perdas, 2)
                 + (select coalesce(sum(l.valor),0) from public.lancamentos l
                     where l.tipo = 'receita' and l.origem = 'manual' and l.vencimento between p_inicio and p_fim),
    'caixa_empresa', (select coalesce(sum(saldo),0) from public.v_saldos_contas where tipo = 'empresa' and ativo),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo, 'saldo', saldo) order by nome), '[]')
                 from public.v_saldos_contas where ativo),
    'a_pagar_30d', (select coalesce(sum(valor),0) from public.lancamentos
                     where tipo = 'despesa' and pago_em is null and vencimento <= current_date + 30),
    'vencidas', (select coalesce(sum(valor),0) from public.lancamentos
                  where tipo = 'despesa' and pago_em is null and vencimento < current_date),
    'a_receber', (select coalesce(sum(valor),0) from public.lancamentos where tipo = 'receita' and pago_em is null),
    'investimento_total', v_invest_total,
    'aportado_do_bolso', v_aporte,
    'resultado_acumulado', v_result_total,
    'retorno_percentual', case when v_invest_total > 0 then round(100 * greatest(v_result_total,0) / v_invest_total, 1) else null end,
    'estoque_baixo', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'unidade', unidade,
                              'estoque', estoque_atual, 'minimo', estoque_minimo) order by nome), '[]')
                        from public.insumos where ativo and estoque_atual <= estoque_minimo and (estoque_minimo > 0 or estoque_atual < 0)),
    'mais_vendidos', (select coalesce(jsonb_agg(x order by (x->>'quantidade')::numeric desc), '[]') from (
                        select jsonb_build_object('produto', p.nome, 'quantidade', sum(vi.quantidade),
                                                  'faturamento', sum(vi.quantidade * vi.preco_unitario)) x
                          from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                          join public.produtos p on p.id = vi.produto_id
                         where v.status = 'concluida' and (v.data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
                         group by p.nome order by sum(vi.quantidade) desc limit 5) t),
    'por_canal', (select coalesce(jsonb_agg(jsonb_build_object('canal', c.nome, 'vendas', t.qtd, 'faturamento', t.fat, 'taxas', t.tx)), '[]')
                    from (select canal_id, count(*) qtd, sum(total) fat, sum(taxa_canal + taxa_pagamento) tx from public.vendas
                           where status = 'concluida' and (data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
                           group by canal_id) t join public.canais c on c.id = t.canal_id)
  );
  return r;
end $$;


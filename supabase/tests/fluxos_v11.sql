-- Testes da v1.1: formas de pagamento, entregador, pré-preparo, lista de compras, fechamento do dia, admin_exec.
-- Termina com RAISE EXCEPTION 'TESTES_V11_OK' (rollback).
do $$
declare
  v_dono uuid := (select id from auth.users where email = 'dono@teste.local');
  c_bolso uuid; c_gaveta uuid; c_empresa uuid; ch_balcao uuid; ch_ifood uuid;
  f_dinheiro uuid; f_credito uuid; f_app uuid;
  i_carne uuid; i_sal uuid; i_blend uuid; i_pao uuid;
  p_burger uuid; v1 uuid; v2 uuid; v3 uuid; v_prod uuid;
  v_n numeric; v_n2 numeric; v_n3 numeric; r jsonb; v_cnt int; v_txt text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select id into c_bolso from public.contas where nome = 'Do meu bolso';
  select id into c_gaveta from public.contas where nome = 'Dinheiro (gaveta)';
  select id into c_empresa from public.contas where nome = 'Conta da empresa';
  select id into ch_balcao from public.canais where nome = 'Balcão';
  select id into ch_ifood from public.canais where nome = 'iFood';
  select id into f_dinheiro from public.formas_pagamento where nome = 'Dinheiro';
  select id into f_app from public.formas_pagamento where nome = 'Pago no app (iFood)';
  select id into f_credito from public.formas_pagamento where nome = 'Cartão de crédito';
  if f_dinheiro is null or f_app is null or (select forma_padrao_id from public.canais where id = ch_ifood) is distinct from f_app then
    raise exception 'FALHA: formas iniciais ou forma padrão do iFood ausentes';
  end if;
  update public.formas_pagamento set taxa_percentual = 3.1 where id = f_credito;

  insert into public.insumos(nome, unidade) values ('Carne', 'kg') returning id into i_carne;
  insert into public.insumos(nome, unidade) values ('Sal', 'kg') returning id into i_sal;
  insert into public.insumos(nome, unidade) values ('Pão', 'un') returning id into i_pao;
  perform public.registrar_compra(jsonb_build_object('data', current_date - 3, 'fornecedor', 'Mercado', 'conta_id', c_bolso,
    'itens', jsonb_build_array(
      jsonb_build_object('insumo_id', i_carne, 'quantidade', 2, 'valor_total', 70),
      jsonb_build_object('insumo_id', i_sal, 'quantidade', 1, 'valor_total', 3),
      jsonb_build_object('insumo_id', i_pao, 'quantidade', 12, 'valor_total', 36))));

  -- ---------- pré-preparo: 1 kg carne + 0,012 kg sal rende 6 blends ----------
  insert into public.insumos(nome, unidade, preparado, rendimento) values ('Blend 160g', 'un', true, 6) returning id into i_blend;
  begin
    perform public.produzir_preparo(i_blend, 6);
    raise exception 'FALHA: produziu sem receita';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; end;
  insert into public.receita_preparo(preparado_id, insumo_id, quantidade) values (i_blend, i_carne, 1), (i_blend, i_sal, 0.012);
  begin
    perform public.produzir_preparo(i_carne, 1);
    raise exception 'FALHA: produziu insumo que não é preparo';
  exception when raise_exception then if sqlerrm like 'FALHA%' then raise; end if; end;

  v_prod := public.produzir_preparo(i_blend, 12);    -- 2 lotes
  select estoque_atual into v_n from public.insumos where id = i_carne;
  if v_n <> 0 then raise exception 'FALHA preparo: carne ficou %', v_n; end if;
  select estoque_atual, custo_medio into v_n, v_n2 from public.insumos where id = i_blend;
  -- lote: 1 kg × 35 + 0,012 kg × 3 = 35,036 → 5,8393 por blend
  if v_n <> 12 or v_n2 <> 5.8393 then raise exception 'FALHA preparo: blend % a %', v_n, v_n2; end if;
  perform public.excluir_producao(v_prod);
  if (select estoque_atual from public.insumos where id = i_carne) <> 2 or (select estoque_atual from public.insumos where id = i_blend) <> 0 then
    raise exception 'FALHA: excluir produção não devolveu o estoque';
  end if;
  v_prod := public.produzir_preparo(i_blend, 6);
  -- excluir_movimento de um movimento da produção desfaz a produção inteira
  -- (testado indiretamente: produção ativa tem 3 movimentos)
  if (select count(*) from public.movimentos where producao_id = v_prod) <> 3 then raise exception 'FALHA: movimentos da produção'; end if;

  -- cardápio com o blend + código único
  insert into public.produtos(nome, preco_venda, codigo) values ('Burger', 40, 'BRG-01') returning id into p_burger;
  insert into public.ficha_tecnica(produto_id, insumo_id, quantidade) values (p_burger, i_blend, 1), (p_burger, i_pao, 1);
  begin
    insert into public.produtos(nome, preco_venda, codigo) values ('Outro', 10, 'BRG-01');
    raise exception 'FALHA: código de produto duplicado aceito';
  exception when unique_violation then null; end;

  -- ---------- venda em dinheiro com entregador: recebe na hora na gaveta ----------
  v1 := public.registrar_venda(jsonb_build_object('canal_id', ch_balcao, 'forma_pagamento_id', f_dinheiro, 'taxa_entrega', 5,
          'custo_entrega', 8, 'itens', jsonb_build_array(jsonb_build_object('produto_id', p_burger, 'quantidade', 2))));
  select total, liquido, taxa_pagamento into v_n, v_n2, v_n3 from public.vendas where id = v1;
  if v_n <> 85 or v_n2 <> 85 or v_n3 <> 0 then raise exception 'FALHA venda dinheiro: total % liquido % taxa %', v_n, v_n2, v_n3; end if;
  if (select conta_id from public.lancamentos where venda_id = v1 and tipo = 'receita') <> c_gaveta
     or (select pago_em from public.lancamentos where venda_id = v1 and tipo = 'receita') is null then
    raise exception 'FALHA: dinheiro não caiu na gaveta na hora';
  end if;
  select valor, (select tipo from public.categorias c where c.id = l.categoria_id) into v_n, v_txt
    from public.lancamentos l where venda_id = v1 and tipo = 'despesa';
  if v_n <> 8 or v_txt <> 'despesa' then raise exception 'FALHA entregador: % %', v_n, v_txt; end if;
  -- custo da venda usa o blend (5,8393) + pão (3)
  if (select custo_total from public.vendas where id = v1) <> 17.68 then
    raise exception 'FALHA custo com blend: %', (select custo_total from public.vendas where id = v1);
  end if;

  -- ---------- venda no crédito: taxa 3,1% e recebe em 30 dias ----------
  v2 := public.registrar_venda(jsonb_build_object('canal_id', ch_balcao, 'forma_pagamento_id', f_credito,
          'itens', jsonb_build_array(jsonb_build_object('produto_id', p_burger, 'quantidade', 1))));
  select taxa_pagamento, liquido into v_n, v_n2 from public.vendas where id = v2;
  if v_n <> 1.24 or v_n2 <> 38.76 then raise exception 'FALHA crédito: taxa % liquido %', v_n, v_n2; end if;
  if (select pago_em from public.lancamentos where venda_id = v2) is not null
     or (select vencimento from public.lancamentos where venda_id = v2) <> current_date + 30 then
    raise exception 'FALHA crédito: deveria ficar a receber em 30 dias';
  end if;

  -- ---------- iFood sem forma informada usa a padrão (app, 30 dias) ----------
  v3 := public.registrar_venda(jsonb_build_object('canal_id', ch_ifood,
          'itens', jsonb_build_array(jsonb_build_object('produto_id', p_burger, 'quantidade', 1))));
  if (select forma_pagamento_id from public.vendas where id = v3) <> f_app then raise exception 'FALHA: iFood não usou forma padrão'; end if;
  if (select liquido from public.vendas where id = v3) <> 29.52 then   -- 40 − 26,2%
    raise exception 'FALHA iFood liquido %', (select liquido from public.vendas where id = v3);
  end if;

  -- ---------- painel: taxas somam canal + pagamento; a receber ----------
  r := public.painel(current_date - 30, current_date + 1);
  if (r->'vendas'->>'taxas_canal')::numeric <> 1.24 + 10.48 then raise exception 'FALHA painel taxas: %', r->'vendas'; end if;
  if (r->>'a_receber')::numeric <> 38.76 + 29.52 then raise exception 'FALHA painel a_receber: %', r->>'a_receber'; end if;
  if (r->'vendas'->>'liquido')::numeric - (r->'vendas'->>'cmv')::numeric - (r->>'despesas_operacionais')::numeric
     <> (r->>'resultado')::numeric then raise exception 'FALHA painel: resultado não fecha'; end if;

  -- ---------- fechamento do dia ----------
  r := public.fechamento_dia((now() at time zone 'America/Sao_Paulo')::date);
  if (r->>'vendas')::int <> 3 or (r->>'total')::numeric <> 165 then raise exception 'FALHA fechamento: %', r; end if;
  if (r->>'dinheiro_esperado')::numeric <> 85 - 8 then raise exception 'FALHA fechamento gaveta: %', r->>'dinheiro_esperado'; end if;
  if jsonb_array_length(r->'por_forma') <> 3 then raise exception 'FALHA fechamento por forma: %', r->'por_forma'; end if;
  if (r->>'entregadores')::numeric <> 8 then raise exception 'FALHA fechamento entregadores'; end if;

  -- ---------- cancelar venda remove receita e entregador ----------
  perform public.cancelar_venda(v1);
  if exists (select 1 from public.lancamentos where venda_id = v1) then raise exception 'FALHA: cancelamento deixou lançamentos'; end if;

  -- ---------- lista de compras: blend acabando? pão consumido ----------
  update public.insumos set estoque_minimo = 20 where id = i_pao;
  select count(*) into v_cnt from public.lista_compras(7, 14) l where l.insumo_id = i_pao and l.sugerido > 0;
  if v_cnt <> 1 then raise exception 'FALHA lista de compras: pão abaixo do mínimo não sugerido'; end if;
  if exists (select 1 from public.lista_compras(7, 14) l where l.insumo_id = i_blend) then
    raise exception 'FALHA lista de compras: pré-preparo não se compra';
  end if;
  -- carne consumida pela produção hoje (1 kg/dia) e só 1 kg em estoque → sugerida
  select sugerido into v_n from public.lista_compras(7, 14) l where l.insumo_id = i_carne;
  if coalesce(v_n, 0) <= 0 then raise exception 'FALHA lista: carne zerada com consumo não foi sugerida'; end if;

  -- ---------- perdas entram no resultado ----------
  r := public.painel(current_date - 30, current_date + 1);
  v_n := (r->>'resultado')::numeric;
  perform public.ajustar_estoque(i_pao, 'saida', 2, 'perda', null, 'mofou');      -- 2 pães a R$ 3
  r := public.painel(current_date - 30, current_date + 1);
  if (r->>'perdas_estoque')::numeric <> 6 or (r->>'resultado')::numeric <> v_n - 6 then
    raise exception 'FALHA perdas: perdas % resultado % (antes %)', r->>'perdas_estoque', r->>'resultado', v_n;
  end if;
  perform public.contar_estoque(i_pao, (select estoque_atual from public.insumos where id = i_pao) + 1);   -- achou 1 a mais
  r := public.painel(current_date - 30, current_date + 1);
  if (r->>'perdas_estoque')::numeric <> 3 then raise exception 'FALHA sobra na contagem: %', r->>'perdas_estoque'; end if;

  -- ---------- segurança ----------
  begin
    perform public.admin_exec('select 1');
    raise exception 'FALHA: app executou admin_exec';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform 1 from public.formas_pagamento;
    raise exception 'FALHA: anon leu formas_pagamento';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  perform public.admin_exec('create temporary table teste_admin_exec(x int)');
  execute 'reset role';

  raise exception 'TESTES_V11_OK';
end $$;

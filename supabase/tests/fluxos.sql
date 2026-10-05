-- Teste de ponta a ponta dos fluxos no banco, rodando como o papel "authenticated" (igual ao app).
-- Termina com RAISE EXCEPTION 'TESTES_OK' → tudo é desfeito (rollback). Qualquer outra mensagem = falha.
do $$
declare
  v_dono uuid := (select id from auth.users where email = 'dono@teste.local');
  v_intruso uuid := (select id from auth.users where email = 'intruso@teste.local');
  c_bolso uuid; c_empresa uuid; ch_ifood uuid; ch_balcao uuid;
  cat_equip uuid; cat_juros uuid; cat_das uuid; cat_estoque uuid;
  i_carne uuid; i_pao uuid; i_queijo uuid; i_saco uuid; i_coca uuid;
  p_burger uuid; p_coca uuid;
  v_compra uuid; v_compra2 uuid; v_frit uuid; v_venda uuid; v_venda2 uuid;
  v_n numeric; v_n2 numeric; v_cnt int; r jsonb; v_lanc uuid;
begin
  -- ===== intruso: logado, mas não é membro =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruso, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_cnt from public.categorias;
  if v_cnt <> 0 then raise exception 'FALHA: intruso enxerga % categorias', v_cnt; end if;
  begin
    perform public.painel(current_date, current_date);
    raise exception 'FALHA: intruso abriu o painel';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_venda('{"itens":[{}]}'::jsonb);
    raise exception 'FALHA: intruso registrou venda';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.categorias(nome, tipo) values ('Hack', 'despesa');
    raise exception 'FALHA: intruso gravou categoria';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- ===== anon: sem login, nada =====
  execute 'set local role anon';
  begin
    select count(*) into v_cnt from public.lancamentos;
    raise exception 'FALHA: anon leu lancamentos';
  exception when insufficient_privilege then null; end;
  begin
    perform public.painel(current_date, current_date);
    raise exception 'FALHA: anon executou painel';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- ===== dono =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select id into c_bolso from public.contas where nome = 'Do meu bolso';
  select id into c_empresa from public.contas where nome = 'Conta da empresa';
  select id into ch_ifood from public.canais where nome = 'iFood';
  select id into ch_balcao from public.canais where nome = 'Balcão';
  select id into cat_equip from public.categorias where nome = 'Equipamentos e utensílios';
  select id into cat_juros from public.categorias where nome = 'Juros e tarifas';
  select id into cat_das from public.categorias where nome = 'Impostos (DAS)';
  select id into cat_estoque from public.categorias where nome = 'Insumos e embalagens';
  if c_bolso is null or ch_ifood is null or cat_equip is null or cat_estoque is null then
    raise exception 'FALHA: dados iniciais ausentes';
  end if;

  insert into public.insumos(nome, unidade, grupo, estoque_minimo) values ('Carne moída', 'kg', 'Ingrediente', 0.5) returning id into i_carne;
  insert into public.insumos(nome, unidade, grupo) values ('Pão brioche', 'un', 'Ingrediente') returning id into i_pao;
  insert into public.insumos(nome, unidade, grupo) values ('Queijo cheddar', 'fatia', 'Ingrediente') returning id into i_queijo;
  insert into public.insumos(nome, unidade, grupo, estoque_minimo) values ('Saco kraft', 'un', 'Embalagem', 100) returning id into i_saco;
  insert into public.insumos(nome, unidade, grupo) values ('Coca lata', 'un', 'Bebida') returning id into i_coca;

  begin
    update public.insumos set estoque_atual = 999 where id = i_carne;
    raise exception 'FALHA: app alterou estoque_atual direto';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.movimentos(insumo_id, tipo, quantidade, origem) values (i_carne, 'entrada', 5, 'ajuste');
    raise exception 'FALHA: app gravou movimento direto';
  exception when insufficient_privilege then null; end;

  -- ---------- Compra 1: mercado à vista, do bolso ----------
  v_compra := public.registrar_compra(jsonb_build_object(
    'data', '2026-10-04', 'fornecedor', 'Costa Atacadão', 'conta_id', c_bolso,
    'itens', jsonb_build_array(
      jsonb_build_object('insumo_id', i_carne,  'descricao', '', 'quantidade', 1.062, 'valor_total', 37.16),
      jsonb_build_object('insumo_id', i_pao,    'descricao', '', 'quantidade', 12,    'valor_total', 45.98),
      jsonb_build_object('insumo_id', i_queijo, 'descricao', '', 'quantidade', 15,    'valor_total', 53.97),
      jsonb_build_object('insumo_id', i_coca,   'descricao', '', 'quantidade', 12,    'valor_total', 35.88))));
  select estoque_atual, custo_medio into v_n, v_n2 from public.insumos where id = i_carne;
  if v_n <> 1.062 or v_n2 <> 34.9906 then raise exception 'FALHA compra1 carne: estoque % custo %', v_n, v_n2; end if;
  select custo_medio into v_n from public.insumos where id = i_coca;
  if v_n <> 2.99 then raise exception 'FALHA compra1 coca custo %', v_n; end if;
  select count(*), sum(valor) into v_cnt, v_n from public.lancamentos where compra_id = v_compra;
  if v_cnt <> 1 or v_n <> 172.99 then raise exception 'FALHA compra1 lançamentos % soma %', v_cnt, v_n; end if;
  if (select pago_em from public.lancamentos where compra_id = v_compra) <> '2026-10-04' then
    raise exception 'FALHA compra1: à vista não ficou pago';
  end if;
  if (select descricao from public.compra_itens where compra_id = v_compra and insumo_id = i_pao) <> 'Pão brioche' then
    raise exception 'FALHA compra1: descrição vazia não herdou o nome do insumo';
  end if;

  -- ---------- Compra 2: embalagem + equipamento, com frete e desconto (rateio exato) ----------
  v_compra2 := public.registrar_compra(jsonb_build_object(
    'data', '2026-10-02', 'fornecedor', 'Mercado Livre', 'conta_id', c_bolso, 'frete', 37.99, 'desconto', 17.64,
    'itens', jsonb_build_array(
      jsonb_build_object('insumo_id', i_saco, 'descricao', 'Sacos kraft', 'quantidade', 100, 'valor_total', 78.90),
      jsonb_build_object('categoria_id', cat_equip, 'descricao', 'Espátulas', 'quantidade', 1, 'valor_total', 29.49))));
  select total into v_n from public.compras where id = v_compra2;
  if v_n <> 128.74 then raise exception 'FALHA compra2 total %', v_n; end if;
  select sum(valor), count(*) into v_n, v_cnt from public.lancamentos where compra_id = v_compra2;
  if v_n <> 128.74 or v_cnt <> 2 then raise exception 'FALHA compra2 soma lançamentos % (%)', v_n, v_cnt; end if;
  select custo_medio into v_n from public.insumos where id = i_saco;     -- 78.90 * 128.74/108.39 / 100
  if v_n <> 0.9371 then raise exception 'FALHA compra2 custo saco %', v_n; end if;

  -- ---------- Compra 3: fritador parcelado 4x com juros (em aberto) ----------
  v_frit := public.registrar_compra(jsonb_build_object(
    'data', '2026-08-20', 'fornecedor', 'Mercado Livre — fritador', 'conta_id', c_bolso, 'parcelas', 4,
    'primeiro_vencimento', '2026-09-20',
    'itens', jsonb_build_array(
      jsonb_build_object('categoria_id', cat_equip, 'descricao', 'Fritador + chapa', 'quantidade', 1, 'valor_total', 297.20),
      jsonb_build_object('categoria_id', cat_juros, 'descricao', 'Juros do parcelamento', 'quantidade', 1, 'valor_total', 81.68))));
  select count(*), sum(valor), count(*) filter (where pago_em is null) into v_cnt, v_n, v_n2
    from public.lancamentos where compra_id = v_frit;
  if v_cnt <> 8 or v_n <> 378.88 or v_n2 <> 8 then raise exception 'FALHA fritador: % lanç, soma %, abertos %', v_cnt, v_n, v_n2; end if;
  if (select max(vencimento) from public.lancamentos where compra_id = v_frit) <> '2026-12-20' then
    raise exception 'FALHA fritador: último vencimento errado';
  end if;
  -- pagar parcela: pode mudar pago_em/conta…
  select id into v_lanc from public.lancamentos where compra_id = v_frit and parcela = '1/4' and categoria_id = cat_equip;
  update public.lancamentos set pago_em = '2026-09-20' where id = v_lanc;
  -- …mas não o valor
  begin
    update public.lancamentos set valor = 1 where id = v_lanc;
    raise exception 'FALHA: alterou valor de lançamento de compra';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  begin
    delete from public.lancamentos where id = v_lanc;
    raise exception 'FALHA: apagou lançamento de compra direto';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;
  begin
    insert into public.lancamentos(tipo, categoria_id, descricao, valor, vencimento, origem)
    values ('despesa', cat_das, 'falso', 10, current_date, 'venda');
    raise exception 'FALHA: criou lançamento com origem de sistema';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;

  -- lançamento manual: DAS
  insert into public.lancamentos(tipo, categoria_id, descricao, valor, vencimento, pago_em, conta_id)
  values ('despesa', cat_das, 'DAS outubro', 86.05, '2026-10-20', null, null);
  begin
    insert into public.lancamentos(tipo, categoria_id, descricao, valor, vencimento)
    values ('receita', cat_das, 'receita errada', 10, current_date);
    raise exception 'FALHA: receita com categoria de despesa';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;

  -- ---------- Cardápio + ficha técnica ----------
  insert into public.produtos(nome, grupo, preco_venda) values ('Burger Goiabacon', 'Lanches', 42) returning id into p_burger;
  insert into public.produtos(nome, grupo, preco_venda) values ('Coca-Cola lata', 'Bebidas', 7) returning id into p_coca;
  insert into public.ficha_tecnica(produto_id, insumo_id, quantidade) values
    (p_burger, i_carne, 0.177), (p_burger, i_pao, 1), (p_burger, i_queijo, 1), (p_burger, i_saco, 1),
    (p_coca, i_coca, 1);
  select custo into v_n from public.v_produtos_custo where id = p_burger;
  -- 0.177*34.9906 + 3.8317 + 3.598 + 0.9371 = 6.1933 + 8.3668 = 14.56
  if v_n <> 14.56 then raise exception 'FALHA custo ficha burger %', v_n; end if;

  -- ---------- Venda iFood: 2 burgers + 1 coca ----------
  v_venda := public.registrar_venda(jsonb_build_object(
    'canal_id', ch_ifood, 'data', '2026-10-05T20:30:00-03:00', 'cliente', 'Ana',
    'itens', jsonb_build_array(
      jsonb_build_object('produto_id', p_burger, 'quantidade', 2),
      jsonb_build_object('produto_id', p_coca, 'quantidade', 1, 'preco_unitario', 8))));
  select * into r from (select to_jsonb(v) from public.vendas v where id = v_venda) t(to_jsonb);
  if (r->>'subtotal')::numeric <> 92 or (r->>'taxa_canal')::numeric <> 24.10 or (r->>'liquido')::numeric <> 67.90 then
    raise exception 'FALHA venda iFood: %', r;
  end if;
  if (r->>'conta_id')::uuid <> c_empresa then raise exception 'FALHA venda: conta padrão não foi a da empresa'; end if;
  select estoque_atual into v_n from public.insumos where id = i_carne;
  if v_n <> 0.708 then raise exception 'FALHA venda: carne ficou %', v_n; end if;
  select estoque_atual into v_n from public.insumos where id = i_coca;
  if v_n <> 11 then raise exception 'FALHA venda: coca ficou %', v_n; end if;
  if (select valor from public.lancamentos where venda_id = v_venda) <> 67.90 then raise exception 'FALHA venda: receita'; end if;
  if (select pago_em from public.lancamentos where venda_id = v_venda) <> '2026-10-05' then raise exception 'FALHA venda: data local'; end if;

  -- venda balcão com desconto e taxa de entrega
  v_venda2 := public.registrar_venda(jsonb_build_object(
    'canal_id', ch_balcao, 'conta_id', c_empresa, 'desconto', 2, 'taxa_entrega', 5,
    'data', '2026-10-05T21:00:00-03:00',
    'itens', jsonb_build_array(jsonb_build_object('produto_id', p_burger, 'quantidade', 1))));
  select total, liquido into v_n, v_n2 from public.vendas where id = v_venda2;
  if v_n <> 45 or v_n2 <> 45 then raise exception 'FALHA venda balcão total % liquido %', v_n, v_n2; end if;

  -- ---------- Cancelar venda devolve estoque e tira a receita ----------
  perform public.cancelar_venda(v_venda);
  select estoque_atual into v_n from public.insumos where id = i_carne;
  if v_n <> 0.885 then raise exception 'FALHA cancelamento: carne %', v_n; end if;
  if exists (select 1 from public.lancamentos where venda_id = v_venda) then raise exception 'FALHA cancelamento: receita ficou'; end if;
  begin
    perform public.cancelar_venda(v_venda);
    raise exception 'FALHA: cancelou duas vezes';
  exception when raise_exception then
    if sqlerrm like 'FALHA%' then raise; end if;
  end;

  -- ---------- Contagem e perda ----------
  v_n := public.contar_estoque(i_pao, 9);       -- tinha 11 (12 - 1 venda balcão)
  if v_n <> -2 then raise exception 'FALHA contagem diferença %', v_n; end if;
  perform public.ajustar_estoque(i_queijo, 'saida', 2, 'perda', null, 'caiu no chão');
  select estoque_atual into v_n from public.insumos where id = i_queijo;
  if v_n <> 12 then raise exception 'FALHA perda queijo %', v_n; end if;

  -- ---------- Editar compra (corrigir valor da carne) recalcula custo ----------
  perform public.registrar_compra(jsonb_build_object(
    'id', v_compra, 'data', '2026-10-04', 'fornecedor', 'Costa Atacadão', 'conta_id', c_bolso,
    'itens', jsonb_build_array(
      jsonb_build_object('insumo_id', i_carne,  'quantidade', 1.062, 'valor_total', 40.00),
      jsonb_build_object('insumo_id', i_pao,    'quantidade', 12,    'valor_total', 45.98),
      jsonb_build_object('insumo_id', i_queijo, 'quantidade', 15,    'valor_total', 53.97),
      jsonb_build_object('insumo_id', i_coca,   'quantidade', 12,    'valor_total', 35.88))));
  select custo_medio into v_n from public.insumos where id = i_carne;
  if v_n <> 37.6648 then raise exception 'FALHA edição: custo carne %', v_n; end if;
  if (select count(*) from public.compras where id = v_compra) <> 1 then raise exception 'FALHA edição duplicou compra'; end if;

  -- ---------- Painel ----------
  r := public.painel('2026-10-01', '2026-10-31');
  if (r->'vendas'->>'quantidade')::int <> 1 then raise exception 'FALHA painel vendas: %', r->'vendas'; end if;
  if (r->'vendas'->>'faturamento')::numeric <> 45 then raise exception 'FALHA painel faturamento: %', r->'vendas'; end if;
  -- investimento = espátulas (com rateio de frete/desconto) + fritador; juros são despesa
  if (r->>'investimento_total')::numeric <> 297.20 + (select valor from public.lancamentos where compra_id = v_compra2 and categoria_id = cat_equip) then
    raise exception 'FALHA painel investimento: %', r->>'investimento_total';
  end if;
  -- DAS 86.05 + parcela 2/4 dos juros (81.68/4 = 20.42, vence 20/10)
  if (r->>'despesas_operacionais')::numeric <> 106.47 then raise exception 'FALHA painel despesas %', r->>'despesas_operacionais'; end if;
  if jsonb_array_length(r->'estoque_baixo') < 1 then raise exception 'FALHA painel estoque baixo: %', r->'estoque_baixo'; end if;
  -- aporte = pago do bolso: compra1 (175.83) + compra2 (128.74) + parcela 1/4 equipamento (74.30)
  if (r->>'aportado_do_bolso')::numeric <> round(175.83 + 128.74 + 74.30, 2) then
    raise exception 'FALHA painel aporte %', r->>'aportado_do_bolso';
  end if;

  -- resultado acumulado ignora despesas que vencem no futuro
  insert into public.lancamentos(tipo, categoria_id, descricao, valor, vencimento)
  values ('despesa', cat_das, 'DAS futuro', 1000, current_date + 60);
  if (public.painel('2026-10-01', '2026-10-31')->>'resultado_acumulado')::numeric
     <> (r->>'resultado_acumulado')::numeric then
    raise exception 'FALHA: despesa futura entrou no acumulado';
  end if;

  -- ---------- Excluir compra ----------
  perform public.excluir_compra(v_compra2);
  if exists (select 1 from public.lancamentos where compra_id = v_compra2) then raise exception 'FALHA exclusão: ficou lançamento'; end if;
  select estoque_atual into v_n from public.insumos where id = i_saco;
  if v_n <> -1 then raise exception 'FALHA exclusão: saco ficou %', v_n; end if;

  -- insumo em uso não pode ser apagado (só desativado)
  begin
    delete from public.insumos where id = i_carne;
    raise exception 'FALHA: apagou insumo usado';
  exception when foreign_key_violation then null; end;

  execute 'reset role';
  raise exception 'TESTES_OK';
end $$;

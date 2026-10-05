-- =============================================================================
-- v1.1 — formas de pagamento (taxa + prazo), pré-preparo, lista de compras, fechamento do dia,
--        custo do entregador, código do produto, versões do app (atualização automática)
-- Aplica por cima da v1.0 sem perder dados.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Formas de pagamento: onde o dinheiro cai, quanto a maquininha/app cobra e em quantos dias recebe
-- ---------------------------------------------------------------------------
create table public.formas_pagamento (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null unique check (btrim(nome) <> ''),
  taxa_percentual  numeric(5,2) not null default 0 check (taxa_percentual between 0 and 100),
  taxa_fixa        numeric(10,2) not null default 0 check (taxa_fixa >= 0),
  dias_recebimento int not null default 0 check (dias_recebimento between 0 and 120),
  conta_id         uuid references public.contas(id) on delete restrict,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

alter table public.canais add column forma_padrao_id uuid references public.formas_pagamento(id) on delete set null;

alter table public.vendas
  add column forma_pagamento_id uuid references public.formas_pagamento(id) on delete restrict,
  add column taxa_pagamento numeric(10,2) not null default 0,
  add column custo_entrega numeric(10,2) not null default 0 check (custo_entrega >= 0);

-- ---------------------------------------------------------------------------
-- Código do produto (mesmo código no ZIA) e pré-preparo
-- ---------------------------------------------------------------------------
alter table public.produtos add column codigo text unique check (codigo is null or btrim(codigo) <> '');

alter table public.insumos
  add column preparado boolean not null default false,
  add column rendimento numeric(12,3) not null default 1 check (rendimento > 0);
grant insert (preparado, rendimento) on public.insumos to authenticated;
grant update (preparado, rendimento) on public.insumos to authenticated;

-- receita de um lote do preparado (rende insumos.rendimento unidades)
create table public.receita_preparo (
  id           uuid primary key default gen_random_uuid(),
  preparado_id uuid not null references public.insumos(id) on delete cascade,
  insumo_id    uuid not null references public.insumos(id) on delete restrict,
  quantidade   numeric(12,4) not null check (quantidade > 0),
  unique (preparado_id, insumo_id),
  check (preparado_id <> insumo_id)
);

create table public.producoes (
  id             uuid primary key default gen_random_uuid(),
  insumo_id      uuid not null references public.insumos(id) on delete restrict,
  data           timestamptz not null default now(),
  quantidade     numeric(12,3) not null check (quantidade > 0),
  custo_unitario numeric(12,4) not null default 0,
  obs            text,
  criado_em      timestamptz not null default now()
);

alter table public.movimentos drop constraint movimentos_origem_check;
alter table public.movimentos add constraint movimentos_origem_check
  check (origem in ('compra','venda','ajuste','perda','contagem','inicial','producao'));
alter table public.movimentos add column producao_id uuid references public.producoes(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Versões publicadas do app (o app confere ao abrir)
-- ---------------------------------------------------------------------------
create table public.app_versoes (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('pacote','apk')),  -- pacote = telas/lógica (instala sozinho); apk = nativo
  versao     text not null,
  codigo     int not null,                                    -- número crescente para comparar
  url        text not null,
  checksum   text,                                            -- sha256 do arquivo (o app confere antes de instalar)
  notas      text,
  criado_em  timestamptz not null default now(),
  unique (tipo, codigo)
);

-- ---------------------------------------------------------------------------
-- RLS / grants das novas tabelas
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['formas_pagamento','receita_preparo','producoes','app_versoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy membros_leem on public.%I for select to authenticated using ((select public.eh_membro()))', t);
  end loop;
  foreach t in array array['formas_pagamento','receita_preparo'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy membros_gravam on public.%I for all to authenticated using ((select public.eh_membro())) with check ((select public.eh_membro()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VENDA v1.1: forma de pagamento (taxa + prazo) e custo do entregador
-- p = { ...v1.0..., "forma_pagamento_id"?: uuid, "custo_entrega"?: 0 }
-- Sem forma: usa a forma padrão do canal; sem ela, conta_id/1ª conta da empresa, recebido na hora (como na v1.0).
-- ---------------------------------------------------------------------------
create or replace function public.registrar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_data timestamptz := coalesce(nullif(p->>'data','')::timestamptz, now());
  v_dia date;
  v_canal public.canais%rowtype;
  v_forma public.formas_pagamento%rowtype;
  v_conta uuid := nullif(p->>'conta_id','')::uuid;
  v_desc numeric := coalesce(nullif(p->>'desconto','')::numeric, 0);
  v_entrega numeric := coalesce(nullif(p->>'taxa_entrega','')::numeric, 0);
  v_custo_entrega numeric := coalesce(nullif(p->>'custo_entrega','')::numeric, 0);
  v_sub numeric := 0;
  v_custo_total numeric := 0;
  v_taxa numeric;
  v_taxa_pag numeric := 0;
  v_total numeric;
  v_liquido numeric;
  v_dias int := 0;
  v_numero bigint;
  it jsonb;
  v_prod public.produtos%rowtype;
  v_qtd numeric;
  v_preco numeric;
  v_custo_unit numeric;
  f record;
begin
  perform public.exigir_membro();

  if jsonb_typeof(p->'itens') <> 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'A venda precisa de pelo menos um item';
  end if;
  if v_custo_entrega < 0 or v_entrega < 0 or v_desc < 0 then raise exception 'Valores negativos não são permitidos'; end if;
  select * into v_canal from public.canais where id = nullif(p->>'canal_id','')::uuid;
  if not found then raise exception 'Canal de venda não encontrado'; end if;

  select * into v_forma from public.formas_pagamento
   where id = coalesce(nullif(p->>'forma_pagamento_id','')::uuid, v_canal.forma_padrao_id);
  if found then
    v_conta := coalesce(v_forma.conta_id, v_conta);
    v_dias := v_forma.dias_recebimento;
  elsif nullif(p->>'forma_pagamento_id','') is not null then
    raise exception 'Forma de pagamento não encontrada';
  end if;
  if v_conta is null then
    select id into v_conta from public.contas where ativo and tipo = 'empresa' order by criado_em limit 1;
  end if;
  if v_conta is null then raise exception 'Cadastre uma conta da empresa para receber as vendas'; end if;
  v_dia := (v_data at time zone 'America/Sao_Paulo')::date;

  insert into public.vendas (data, canal_id, conta_id, forma_pagamento_id, cliente, desconto, taxa_entrega, custo_entrega, obs)
  values (v_data, v_canal.id, v_conta, v_forma.id, nullif(p->>'cliente',''), v_desc, v_entrega, v_custo_entrega, nullif(p->>'obs',''))
  returning id, numero into v_id, v_numero;

  for it in select * from jsonb_array_elements(p->'itens') loop
    select * into v_prod from public.produtos where id = nullif(it->>'produto_id','')::uuid;
    if not found then raise exception 'Produto não encontrado no cardápio'; end if;
    v_qtd := coalesce(nullif(it->>'quantidade','')::numeric, 1);
    if v_qtd <= 0 then raise exception 'Quantidade inválida em %', v_prod.nome; end if;
    v_preco := coalesce(nullif(it->>'preco_unitario','')::numeric, v_prod.preco_venda);
    if v_preco < 0 then raise exception 'Preço inválido em %', v_prod.nome; end if;

    v_custo_unit := 0;
    for f in select ft.insumo_id, ft.quantidade, i.custo_medio
               from public.ficha_tecnica ft join public.insumos i on i.id = ft.insumo_id
              where ft.produto_id = v_prod.id loop
      v_custo_unit := v_custo_unit + f.quantidade * f.custo_medio;
      insert into public.movimentos (insumo_id, data, tipo, quantidade, custo_unitario, origem, venda_id)
      values (f.insumo_id, v_data, 'saida', round(f.quantidade * v_qtd, 3), f.custo_medio, 'venda', v_id);
    end loop;

    insert into public.venda_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
    values (v_id, v_prod.id, v_qtd, v_preco, round(v_custo_unit, 4));
    v_sub := v_sub + v_qtd * v_preco;
    v_custo_total := v_custo_total + v_qtd * v_custo_unit;
  end loop;

  if v_desc > v_sub then raise exception 'Desconto maior que o valor dos itens'; end if;
  v_taxa := round((v_sub - v_desc) * v_canal.taxa_percentual / 100 + v_canal.taxa_fixa, 2);
  v_total := v_sub - v_desc + v_entrega;
  if v_forma.id is not null then
    v_taxa_pag := round(v_total * v_forma.taxa_percentual / 100 + v_forma.taxa_fixa, 2);
  end if;
  v_liquido := v_total - v_taxa - v_taxa_pag;

  update public.vendas set subtotal = v_sub, total = v_total, taxa_canal = v_taxa, taxa_pagamento = v_taxa_pag,
         liquido = v_liquido, custo_total = round(v_custo_total, 2)
   where id = v_id;

  if v_liquido > 0 then
    insert into public.lancamentos (tipo, categoria_id, descricao, valor, vencimento, pago_em, conta_id, origem, venda_id)
    values ('receita', public.categoria_por_nome('Vendas'),
            'Venda #' || v_numero || ' — ' || v_canal.nome || coalesce(' / ' || v_forma.nome, ''),
            v_liquido, v_dia + v_dias, case when v_dias = 0 then v_dia end,
            v_conta, 'venda', v_id);
  end if;

  if v_custo_entrega > 0 then
    insert into public.lancamentos (tipo, categoria_id, descricao, valor, vencimento, pago_em, conta_id, origem, venda_id)
    values ('despesa', coalesce(public.categoria_por_nome('Entrega'), public.categoria_por_nome('Outras despesas')),
            'Entregador da venda #' || v_numero, v_custo_entrega, v_dia, v_dia,
            coalesce((select id from public.contas where nome = 'Dinheiro (gaveta)' and ativo), v_conta), 'venda', v_id);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- PRÉ-PREPARO: produz N unidades do preparado consumindo a receita proporcional
-- ---------------------------------------------------------------------------
create or replace function public.produzir_preparo(p_insumo uuid, p_quantidade numeric, p_obs text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ins public.insumos%rowtype;
  v_id uuid;
  v_fator numeric;
  v_custo_lote numeric := 0;
  r record;
  v_n int := 0;
begin
  perform public.exigir_membro();
  select * into v_ins from public.insumos where id = p_insumo;
  if not found or not v_ins.preparado then raise exception 'Este insumo não é um pré-preparo'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  v_fator := p_quantidade / v_ins.rendimento;

  insert into public.producoes (insumo_id, quantidade, obs) values (p_insumo, p_quantidade, p_obs) returning id into v_id;
  for r in select rp.insumo_id, rp.quantidade, i.custo_medio
             from public.receita_preparo rp join public.insumos i on i.id = rp.insumo_id
            where rp.preparado_id = p_insumo loop
    v_n := v_n + 1;
    v_custo_lote := v_custo_lote + r.quantidade * v_fator * r.custo_medio;
    insert into public.movimentos (insumo_id, tipo, quantidade, custo_unitario, origem, producao_id, obs)
    values (r.insumo_id, 'saida', round(r.quantidade * v_fator, 3), r.custo_medio, 'producao', v_id, 'Preparo: ' || v_ins.nome);
  end loop;
  if v_n = 0 then raise exception 'Cadastre a receita de "%" antes de produzir', v_ins.nome; end if;

  update public.producoes set custo_unitario = round(v_custo_lote / p_quantidade, 4) where id = v_id;
  insert into public.movimentos (insumo_id, tipo, quantidade, custo_unitario, origem, producao_id, obs)
  values (p_insumo, 'entrada', p_quantidade, round(v_custo_lote / p_quantidade, 4), 'producao', v_id, 'Produzido');
  return v_id;
end $$;

create or replace function public.excluir_producao(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_membro();
  delete from public.producoes where id = p_id;
  if not found then raise exception 'Produção não encontrada'; end if;
end $$;

-- excluir_movimento: produção se desfaz por excluir_producao (inteira)
create or replace function public.excluir_movimento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_prod uuid;
begin
  perform public.exigir_membro();
  select producao_id into v_prod from public.movimentos where id = p_id;
  if v_prod is not null then
    delete from public.producoes where id = v_prod;
    return;
  end if;
  delete from public.movimentos where id = p_id and origem in ('ajuste','perda','contagem','inicial');
  if not found then raise exception 'Só dá para excluir ajustes manuais (compras/vendas: exclua a compra ou cancele a venda)'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- LISTA DE COMPRAS: consumo médio dos últimos N dias × dias de cobertura, respeitando o mínimo
-- ---------------------------------------------------------------------------
create or replace function public.lista_compras(p_dias_cobertura int default 7, p_dias_historico int default 14)
returns table (insumo_id uuid, nome text, unidade text, grupo text, estoque numeric, minimo numeric,
               consumo_dia numeric, sugerido numeric, custo_estimado numeric, motivo text)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.exigir_membro();
  return query
  with consumo as (
    select m.insumo_id, sum(m.quantidade) as total,
           greatest(1, least(p_dias_historico,
             (current_date - (min(m.data) at time zone 'America/Sao_Paulo')::date) + 1)) as dias
      from public.movimentos m
     where m.tipo = 'saida' and m.origem in ('venda','producao','perda')
       and m.data >= now() - make_interval(days => p_dias_historico)
     group by m.insumo_id
  ), calc as (
    select i.id, i.nome, i.unidade, i.grupo, i.estoque_atual, i.estoque_minimo, i.custo_medio, i.preparado,
           coalesce(c.total / c.dias, 0) as cdia
      from public.insumos i left join consumo c on c.insumo_id = i.id
     where i.ativo
  )
  select k.id, k.nome, k.unidade, k.grupo, k.estoque_atual, k.estoque_minimo, round(k.cdia, 3),
         ceil(greatest(k.estoque_minimo, k.cdia * p_dias_cobertura) - k.estoque_atual)::numeric,
         round(ceil(greatest(k.estoque_minimo, k.cdia * p_dias_cobertura) - k.estoque_atual) * k.custo_medio, 2),
         case when k.estoque_atual <= k.estoque_minimo and k.estoque_minimo > 0 then 'abaixo do mínimo'
              else 'acaba em ' || greatest(0, floor(k.estoque_atual / nullif(k.cdia, 0)))::int || ' dia(s)' end
    from calc k
   where not k.preparado
     and greatest(k.estoque_minimo, k.cdia * p_dias_cobertura) - k.estoque_atual > 0
     and (k.cdia > 0 or k.estoque_minimo > 0)
   order by k.grupo, k.nome;
end $$;

-- ---------------------------------------------------------------------------
-- FECHAMENTO DO DIA: por forma de pagamento + dinheiro esperado na gaveta
-- ---------------------------------------------------------------------------
create or replace function public.fechamento_dia(p_dia date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.exigir_membro();
  return jsonb_build_object(
    'dia', p_dia,
    'vendas', (select count(*) from public.vendas v where v.status = 'concluida' and (v.data at time zone 'America/Sao_Paulo')::date = p_dia),
    'total', (select coalesce(sum(total),0) from public.vendas v where v.status = 'concluida' and (v.data at time zone 'America/Sao_Paulo')::date = p_dia),
    'por_forma', (select coalesce(jsonb_agg(jsonb_build_object(
                     'forma', coalesce(f.nome, 'Sem forma informada'), 'conta', ct.nome, 'vendas', x.qtd, 'total', x.total,
                     'taxas', x.taxas, 'liquido', x.liquido, 'dias_recebimento', coalesce(f.dias_recebimento, 0)) order by x.total desc), '[]')
                    from (select v.forma_pagamento_id, v.conta_id, count(*) qtd, sum(v.total) total,
                                 sum(v.taxa_canal + v.taxa_pagamento) taxas, sum(v.liquido) liquido
                            from public.vendas v
                           where v.status = 'concluida' and (v.data at time zone 'America/Sao_Paulo')::date = p_dia
                           group by v.forma_pagamento_id, v.conta_id) x
                    left join public.formas_pagamento f on f.id = x.forma_pagamento_id
                    left join public.contas ct on ct.id = x.conta_id),
    'dinheiro_esperado', (select coalesce(sum(case when l.tipo = 'receita' then l.valor else -l.valor end), 0)
                            from public.lancamentos l join public.contas ct on ct.id = l.conta_id
                           where ct.nome = 'Dinheiro (gaveta)' and l.pago_em = p_dia),
    'entregadores', (select coalesce(sum(custo_entrega),0) from public.vendas v where v.status = 'concluida' and (v.data at time zone 'America/Sao_Paulo')::date = p_dia)
  );
end $$;

-- ---------------------------------------------------------------------------
-- PAINEL v1.1: taxas = canal + pagamento (o líquido já desconta as duas); inclui valores a receber
-- ---------------------------------------------------------------------------
-- painel: "taxas_canal" passa a somar canal + pagamento para o resultado bater (líquido já desconta as duas)
create or replace function public.painel(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  r jsonb;
  v_vendas record;
  v_desp numeric; v_desp_pagas numeric; v_estoque_compras numeric;
  v_invest_total numeric; v_aporte numeric; v_result_total numeric;
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
    into v_result_total;

  r := jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'vendas', jsonb_build_object(
      'quantidade', v_vendas.qtd, 'faturamento', v_vendas.faturamento, 'taxas_canal', v_vendas.taxas,
      'liquido', v_vendas.liquido, 'cmv', v_vendas.cmv, 'lucro_bruto', v_vendas.liquido - v_vendas.cmv,
      'ticket_medio', case when v_vendas.qtd > 0 then round(v_vendas.faturamento / v_vendas.qtd, 2) else 0 end),
    'despesas_operacionais', v_desp,
    'despesas_operacionais_pagas', v_desp_pagas,
    'compras_estoque', v_estoque_compras,
    'outras_receitas', (select coalesce(sum(l.valor),0) from public.lancamentos l
                         where l.tipo = 'receita' and l.origem = 'manual' and l.vencimento between p_inicio and p_fim),
    'resultado', v_vendas.liquido - v_vendas.cmv - v_desp
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

-- ---------------------------------------------------------------------------
-- Atualizações de banco remotas: só a chave secreta (service_role) executa. Nunca liberada ao app.
-- Para desligar: drop function public.admin_exec(text);
-- ---------------------------------------------------------------------------
create or replace function public.admin_exec(p_sql text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  execute p_sql;
end $$;

-- funções novas: só membros
revoke execute on function public.produzir_preparo(uuid, numeric, text), public.excluir_producao(uuid),
  public.lista_compras(int, int), public.fechamento_dia(date), public.admin_exec(text) from public, anon, authenticated;
grant execute on function public.produzir_preparo(uuid, numeric, text), public.excluir_producao(uuid),
  public.lista_compras(int, int), public.fechamento_dia(date) to authenticated;
grant execute on function public.admin_exec(text) to service_role;

-- ---------------------------------------------------------------------------
-- Dados iniciais (editáveis em Ajustes). Taxas de maquininha ficam 0 até você informar as suas.
-- ---------------------------------------------------------------------------
insert into public.formas_pagamento (nome, taxa_percentual, dias_recebimento, conta_id) values
  ('Dinheiro', 0, 0, (select id from public.contas where nome = 'Dinheiro (gaveta)')),
  ('Pix', 0, 0, (select id from public.contas where nome = 'Conta da empresa')),
  ('Cartão de débito', 0, 1, (select id from public.contas where nome = 'Conta da empresa')),
  ('Cartão de crédito', 0, 30, (select id from public.contas where nome = 'Conta da empresa')),
  ('Pago no app (iFood)', 0, 30, (select id from public.contas where nome = 'Conta da empresa'))
on conflict (nome) do nothing;

update public.canais set forma_padrao_id = (select id from public.formas_pagamento where nome = 'Pago no app (iFood)')
 where nome = 'iFood' and forma_padrao_id is null;
update public.canais set forma_padrao_id = (select id from public.formas_pagamento where nome = 'Dinheiro')
 where nome = 'Balcão' and forma_padrao_id is null;
update public.canais set forma_padrao_id = (select id from public.formas_pagamento where nome = 'Pix')
 where nome = 'WhatsApp' and forma_padrao_id is null;

insert into public.categorias (nome, tipo) values ('Taxas de maquininha e apps', 'despesa') on conflict (nome) do nothing;

comment on function public.registrar_venda(jsonb) is
  'Registra venda: {"canal_id","forma_pagamento_id"?,"conta_id"?,"cliente"?,"desconto"?,"taxa_entrega"?,"custo_entrega"?,"data"?,"itens":[{"produto_id","quantidade","preco_unitario"?}]}. Baixa estoque pela ficha, desconta taxa do canal e da forma; receita fica a receber quando a forma tem prazo.';
comment on function public.produzir_preparo(uuid, numeric, text) is 'Produz N unidades de um pré-preparo consumindo a receita proporcional ao rendimento.';
comment on function public.lista_compras(int, int) is 'Sugestão de compra: consumo médio diário × dias de cobertura, respeitando o estoque mínimo.';
comment on function public.fechamento_dia(date) is 'Vendas do dia por forma de pagamento e dinheiro esperado na gaveta.';

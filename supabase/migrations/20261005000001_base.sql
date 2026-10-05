-- =============================================================================
-- Hamburgueria — banco do app de controle (estoque, cardápio, vendas, compras, financeiro)
--
-- Regras de ouro (vale para o app E para o Claude via MCP):
--   • Vendas:   registrar_venda(jsonb) / cancelar_venda(uuid)          — nunca INSERT direto
--   • Compras:  registrar_compra(jsonb) / excluir_compra(uuid)         — nunca INSERT direto
--   • Estoque:  ajustar_estoque(insumo, tipo, qtd, motivo) / contar_estoque(insumo, qtd)
--   • Painel:   painel(inicio, fim) → jsonb com faturamento, CMV, lucro, caixa, investimento
--   • Saldo e custo médio dos insumos são calculados pelo banco (recalcular_insumo).
-- Projeto dedicado à hamburgueria: acesso = estar em public.membros.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Membros (quem pode usar o app)
-- ---------------------------------------------------------------------------
create table public.membros (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text,
  papel     text not null default 'dono' check (papel in ('dono','funcionario')),
  criado_em timestamptz not null default now()
);

create or replace function public.eh_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.user_id = (select auth.uid()))
$$;

create or replace function public.exigir_membro() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_membro() then
    raise exception 'Acesso negado: usuário não é membro da hamburgueria' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cadastros variáveis
-- ---------------------------------------------------------------------------
create table public.categorias (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique check (btrim(nome) <> ''),
  -- receita | despesa (operacional) | estoque (compra de insumo, vira CMV na venda) | investimento (abertura/equipamento)
  tipo      text not null check (tipo in ('receita','despesa','estoque','investimento')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.contas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique check (btrim(nome) <> ''),
  -- empresa = dinheiro do negócio | dono = dinheiro do seu bolso (vira aporte)
  tipo          text not null default 'empresa' check (tipo in ('empresa','dono')),
  saldo_inicial numeric(12,2) not null default 0,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table public.canais (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique check (btrim(nome) <> ''),
  taxa_percentual numeric(5,2) not null default 0 check (taxa_percentual between 0 and 100),
  taxa_fixa       numeric(10,2) not null default 0 check (taxa_fixa >= 0),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);

create table public.insumos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null unique check (btrim(nome) <> ''),
  unidade        text not null default 'un' check (btrim(unidade) <> ''),
  grupo          text not null default 'Ingrediente',
  estoque_minimo numeric(12,3) not null default 0 check (estoque_minimo >= 0),
  estoque_atual  numeric(12,3) not null default 0,   -- calculado (recalcular_insumo)
  custo_medio    numeric(12,4) not null default 0,   -- calculado (recalcular_insumo)
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

create table public.produtos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique check (btrim(nome) <> ''),
  grupo       text not null default 'Lanches',
  preco_venda numeric(10,2) not null default 0 check (preco_venda >= 0),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table public.ficha_tecnica (
  id         uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  insumo_id  uuid not null references public.insumos(id) on delete restrict,
  quantidade numeric(12,4) not null check (quantidade > 0),
  unique (produto_id, insumo_id)
);
create index on public.ficha_tecnica (insumo_id);

-- ---------------------------------------------------------------------------
-- Movimento (compras, vendas, estoque, dinheiro)
-- ---------------------------------------------------------------------------
create table public.compras (
  id                  uuid primary key default gen_random_uuid(),
  data                date not null default current_date,
  fornecedor          text,
  conta_id            uuid references public.contas(id) on delete restrict,
  frete               numeric(10,2) not null default 0 check (frete >= 0),
  desconto            numeric(10,2) not null default 0 check (desconto >= 0),
  total               numeric(12,2) not null default 0,
  parcelas            int not null default 1 check (parcelas between 1 and 36),
  primeiro_vencimento date,
  obs                 text,
  criado_em           timestamptz not null default now()
);

create table public.compra_itens (
  id           uuid primary key default gen_random_uuid(),
  compra_id    uuid not null references public.compras(id) on delete cascade,
  insumo_id    uuid references public.insumos(id) on delete restrict,
  categoria_id uuid references public.categorias(id) on delete restrict,
  descricao    text not null,
  quantidade   numeric(12,3) not null check (quantidade > 0),
  valor_total  numeric(12,2) not null check (valor_total >= 0),
  check (insumo_id is not null or categoria_id is not null)
);
create index on public.compra_itens (compra_id);

create table public.vendas (
  id           uuid primary key default gen_random_uuid(),
  numero       bigint generated always as identity unique,
  data         timestamptz not null default now(),
  canal_id     uuid not null references public.canais(id) on delete restrict,
  conta_id     uuid references public.contas(id) on delete restrict,
  cliente      text,
  subtotal     numeric(10,2) not null default 0,
  desconto     numeric(10,2) not null default 0 check (desconto >= 0),
  taxa_entrega numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  total        numeric(10,2) not null default 0,
  taxa_canal   numeric(10,2) not null default 0,
  liquido      numeric(10,2) not null default 0,
  custo_total  numeric(10,2) not null default 0,
  status       text not null default 'concluida' check (status in ('concluida','cancelada')),
  obs          text,
  criado_em    timestamptz not null default now()
);
create index on public.vendas (data);

create table public.venda_itens (
  id             uuid primary key default gen_random_uuid(),
  venda_id       uuid not null references public.vendas(id) on delete cascade,
  produto_id     uuid not null references public.produtos(id) on delete restrict,
  quantidade     numeric(10,3) not null check (quantidade > 0),
  preco_unitario numeric(10,2) not null check (preco_unitario >= 0),
  custo_unitario numeric(12,4) not null default 0
);
create index on public.venda_itens (venda_id);
create index on public.venda_itens (produto_id);

create table public.movimentos (
  id             uuid primary key default gen_random_uuid(),
  insumo_id      uuid not null references public.insumos(id) on delete restrict,
  data           timestamptz not null default now(),
  tipo           text not null check (tipo in ('entrada','saida')),
  quantidade     numeric(12,3) not null check (quantidade > 0),
  custo_unitario numeric(12,4) not null default 0 check (custo_unitario >= 0),
  origem         text not null check (origem in ('compra','venda','ajuste','perda','contagem','inicial')),
  compra_id      uuid references public.compras(id) on delete cascade,
  venda_id       uuid references public.vendas(id) on delete cascade,
  obs            text,
  criado_em      timestamptz not null default now()
);
create index on public.movimentos (insumo_id, data);

create table public.lancamentos (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null check (tipo in ('receita','despesa')),
  categoria_id uuid not null references public.categorias(id) on delete restrict,
  descricao    text not null check (btrim(descricao) <> ''),
  valor        numeric(12,2) not null check (valor > 0),
  vencimento   date not null,
  pago_em      date,
  conta_id     uuid references public.contas(id) on delete restrict,
  origem       text not null default 'manual' check (origem in ('manual','compra','venda')),
  compra_id    uuid references public.compras(id) on delete cascade,
  venda_id     uuid references public.vendas(id) on delete cascade,
  parcela      text,
  criado_em    timestamptz not null default now(),
  check (pago_em is null or conta_id is not null)
);
create index on public.lancamentos (vencimento);
create index on public.lancamentos (pago_em);

-- ---------------------------------------------------------------------------
-- Estoque: saldo e custo médio ponderado recalculados do histórico
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_insumo(p_insumo uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m record;
  v_qtd numeric := 0;
  v_custo numeric := 0;
begin
  for m in select tipo, quantidade, custo_unitario from public.movimentos
           where insumo_id = p_insumo order by data, criado_em, id loop
    if m.tipo = 'entrada' then
      if v_qtd + m.quantidade > 0 and v_qtd > 0 then
        v_custo := (v_qtd * v_custo + m.quantidade * m.custo_unitario) / (v_qtd + m.quantidade);
      elsif m.custo_unitario > 0 or v_qtd <= 0 then
        v_custo := m.custo_unitario;
      end if;
      v_qtd := v_qtd + m.quantidade;
    else
      v_qtd := v_qtd - m.quantidade;
    end if;
  end loop;
  update public.insumos set estoque_atual = round(v_qtd, 3), custo_medio = round(v_custo, 4)
   where id = p_insumo;
end $$;

create or replace function public.trg_movimentos_recalcular() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalcular_insumo(old.insumo_id);
    return old;
  end if;
  perform public.recalcular_insumo(new.insumo_id);
  return new;
end $$;

create trigger movimentos_recalcular after insert or delete on public.movimentos
for each row execute function public.trg_movimentos_recalcular();

-- ---------------------------------------------------------------------------
-- Lançamentos: categoria compatível + gerados pelo sistema são protegidos
-- ---------------------------------------------------------------------------
create or replace function public.trg_lancamentos_guarda() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_tipo_cat text;
begin
  if tg_op in ('INSERT','UPDATE') then
    select tipo into v_tipo_cat from public.categorias where id = new.categoria_id;
    if new.tipo = 'receita' and v_tipo_cat <> 'receita' then
      raise exception 'Receita precisa de uma categoria do tipo receita';
    elsif new.tipo = 'despesa' and v_tipo_cat = 'receita' then
      raise exception 'Despesa não pode usar categoria de receita';
    end if;
  end if;

  -- RPCs (security definer) rodam como dono do banco → liberado; app direto roda como authenticated → travado
  if current_user not in ('authenticated','anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and new.origem <> 'manual' then
    raise exception 'Lançamentos de compra/venda são criados pelo registro da compra ou venda';
  elsif tg_op = 'DELETE' and old.origem <> 'manual' then
    raise exception 'Este lançamento veio de uma %: exclua ou cancele a % para apagá-lo', old.origem, old.origem;
  elsif tg_op = 'UPDATE' and old.origem <> 'manual' then
    if (new.tipo, new.categoria_id, new.descricao, new.valor, new.origem, new.compra_id, new.venda_id, new.parcela)
       is distinct from
       (old.tipo, old.categoria_id, old.descricao, old.valor, old.origem, old.compra_id, old.venda_id, old.parcela) then
      raise exception 'Lançamento de %: só dá para mudar vencimento, data de pagamento e conta', old.origem;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger lancamentos_guarda before insert or update or delete on public.lancamentos
for each row execute function public.trg_lancamentos_guarda();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.categoria_por_nome(p_nome text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.categorias where lower(nome) = lower(p_nome) limit 1
$$;

-- Divide um valor em n parcelas (centavos que sobram vão na última)
create or replace function public.dividir_parcelas(p_valor numeric, p_n int) returns numeric[]
language plpgsql immutable set search_path = '' as $$
declare
  v_base numeric := trunc(p_valor / p_n, 2);
  v_arr numeric[] := '{}';
begin
  for i in 1..p_n loop
    v_arr := v_arr || case when i = p_n then p_valor - v_base * (p_n - 1) else v_base end;
  end loop;
  return v_arr;
end $$;

-- ---------------------------------------------------------------------------
-- COMPRA: registra itens, entrada no estoque (custo com frete/desconto rateados)
-- e contas a pagar (à vista = pago; parcelado = parcelas mensais em aberto)
--
-- p = { "id"?: uuid (para editar), "data": "2026-10-04", "fornecedor": "...",
--       "conta_id": uuid, "frete": 0, "desconto": 0, "parcelas": 1,
--       "primeiro_vencimento"?: "2026-11-04", "pago"?: true, "obs"?: "...",
--       "itens": [ { "insumo_id"?: uuid, "categoria_id"?: uuid, "descricao": "...",
--                    "quantidade": 1, "valor_total": 10.5 } ] }
-- pago: só vale para parcelas=1 (padrão true). Parcelado nasce em aberto.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_compra(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_data date := coalesce(nullif(p->>'data','')::date, current_date);
  v_conta uuid := nullif(p->>'conta_id','')::uuid;
  v_frete numeric := coalesce(nullif(p->>'frete','')::numeric, 0);
  v_desc numeric := coalesce(nullif(p->>'desconto','')::numeric, 0);
  v_parc int := coalesce(nullif(p->>'parcelas','')::int, 1);
  v_pago boolean := coalesce((p->>'pago')::boolean, true);
  v_venc1 date;
  v_itens_total numeric := 0;
  v_total numeric;
  v_fator numeric;
  v_cat_estoque uuid := public.categoria_por_nome('Insumos e embalagens');
  it jsonb;
  v_item_id uuid;
  v_custo_item numeric;
  g record;
  v_partes numeric[];
  v_cont int := 0;
  v_ngrupos int;
  v_alocado numeric := 0;
  v_valor_grupo numeric;
begin
  perform public.exigir_membro();

  if jsonb_typeof(p->'itens') <> 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'A compra precisa de pelo menos um item';
  end if;
  if v_parc < 1 or v_parc > 36 then raise exception 'Parcelas entre 1 e 36'; end if;
  if v_conta is null and (v_parc = 1 and v_pago) then
    raise exception 'Informe de qual conta saiu o dinheiro';
  end if;
  if v_cat_estoque is null then raise exception 'Categoria "Insumos e embalagens" não existe'; end if;

  select coalesce(sum((x->>'valor_total')::numeric), 0) into v_itens_total
    from jsonb_array_elements(p->'itens') x;
  v_total := v_itens_total + v_frete - v_desc;
  if v_total < 0 then raise exception 'Desconto maior que o valor da compra'; end if;
  v_fator := case when v_itens_total > 0 then v_total / v_itens_total else 1 end;
  v_venc1 := coalesce(nullif(p->>'primeiro_vencimento','')::date,
                      case when v_parc = 1 then v_data else (v_data + interval '1 month')::date end);

  if v_id is not null then
    if not exists (select 1 from public.compras where id = v_id) then
      raise exception 'Compra % não encontrada', v_id;
    end if;
    delete from public.lancamentos where compra_id = v_id;
    delete from public.movimentos where compra_id = v_id;
    delete from public.compra_itens where compra_id = v_id;
    update public.compras set data = v_data, fornecedor = nullif(p->>'fornecedor',''), conta_id = v_conta,
           frete = v_frete, desconto = v_desc, total = v_total, parcelas = v_parc,
           primeiro_vencimento = v_venc1, obs = nullif(p->>'obs','')
     where id = v_id;
  else
    insert into public.compras (data, fornecedor, conta_id, frete, desconto, total, parcelas, primeiro_vencimento, obs)
    values (v_data, nullif(p->>'fornecedor',''), v_conta, v_frete, v_desc, v_total, v_parc, v_venc1, nullif(p->>'obs',''))
    returning id into v_id;
  end if;

  for it in select * from jsonb_array_elements(p->'itens') loop
    if coalesce(btrim(it->>'descricao'), '') = '' and nullif(it->>'insumo_id','') is null then
      raise exception 'Item sem descrição';
    end if;
    insert into public.compra_itens (compra_id, insumo_id, categoria_id, descricao, quantidade, valor_total)
    values (v_id, nullif(it->>'insumo_id','')::uuid,
            case when nullif(it->>'insumo_id','') is null then nullif(it->>'categoria_id','')::uuid end,
            coalesce(nullif(btrim(it->>'descricao'),''), (select nome from public.insumos where id = nullif(it->>'insumo_id','')::uuid)),
            (it->>'quantidade')::numeric, (it->>'valor_total')::numeric)
    returning id into v_item_id;

    if nullif(it->>'insumo_id','') is not null then
      v_custo_item := round((it->>'valor_total')::numeric * v_fator / (it->>'quantidade')::numeric, 4);
      insert into public.movimentos (insumo_id, data, tipo, quantidade, custo_unitario, origem, compra_id, obs)
      values ((it->>'insumo_id')::uuid, (v_data::timestamp at time zone 'America/Sao_Paulo') + interval '12 hours',
              'entrada', (it->>'quantidade')::numeric, v_custo_item, 'compra', v_id, nullif(p->>'fornecedor',''));
    end if;
  end loop;

  -- contas a pagar: um grupo por categoria, frete/desconto rateados
  select count(distinct coalesce(ci.categoria_id, v_cat_estoque)) into v_ngrupos
    from public.compra_itens ci where ci.compra_id = v_id;
  for g in
    select coalesce(ci.categoria_id, v_cat_estoque) as categoria_id, sum(ci.valor_total) as bruto
      from public.compra_itens ci where ci.compra_id = v_id
     group by 1 order by 1
  loop
    v_cont := v_cont + 1;
    v_valor_grupo := case when v_cont = v_ngrupos then v_total - v_alocado else round(g.bruto * v_fator, 2) end;
    v_alocado := v_alocado + v_valor_grupo;
    v_partes := public.dividir_parcelas(v_valor_grupo, v_parc);
    for i in 1..v_parc loop
      if v_partes[i] > 0 then
        insert into public.lancamentos (tipo, categoria_id, descricao, valor, vencimento, pago_em, conta_id, origem, compra_id, parcela)
        values ('despesa', g.categoria_id,
                'Compra ' || coalesce(nullif(p->>'fornecedor',''), to_char(v_data, 'DD/MM/YYYY')),
                v_partes[i], (v_venc1 + make_interval(months => i - 1))::date,
                case when v_parc = 1 and v_pago then v_data end,
                v_conta, 'compra', v_id,
                case when v_parc > 1 then i || '/' || v_parc end);
      end if;
    end loop;
  end loop;

  return v_id;
end $$;

create or replace function public.excluir_compra(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_membro();
  delete from public.compras where id = p_id;
  if not found then raise exception 'Compra não encontrada'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- VENDA: baixa os insumos pela ficha técnica, calcula taxa do canal e lança a receita
--
-- p = { "data"?: timestamptz, "canal_id": uuid, "conta_id"?: uuid, "cliente"?: "...",
--       "desconto"?: 0, "taxa_entrega"?: 0, "obs"?: "...",
--       "itens": [ { "produto_id": uuid, "quantidade": 1, "preco_unitario"?: 42 } ] }
-- Sem conta_id: usa a primeira conta ativa do tipo empresa.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_data timestamptz := coalesce(nullif(p->>'data','')::timestamptz, now());
  v_canal public.canais%rowtype;
  v_conta uuid := nullif(p->>'conta_id','')::uuid;
  v_desc numeric := coalesce(nullif(p->>'desconto','')::numeric, 0);
  v_entrega numeric := coalesce(nullif(p->>'taxa_entrega','')::numeric, 0);
  v_sub numeric := 0;
  v_custo_total numeric := 0;
  v_taxa numeric;
  v_total numeric;
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
  select * into v_canal from public.canais where id = nullif(p->>'canal_id','')::uuid;
  if not found then raise exception 'Canal de venda não encontrado'; end if;
  if v_conta is null then
    select id into v_conta from public.contas where ativo and tipo = 'empresa' order by criado_em limit 1;
  end if;
  if v_conta is null then raise exception 'Cadastre uma conta da empresa para receber as vendas'; end if;

  insert into public.vendas (data, canal_id, conta_id, cliente, desconto, taxa_entrega, obs)
  values (v_data, v_canal.id, v_conta, nullif(p->>'cliente',''), v_desc, v_entrega, nullif(p->>'obs',''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    select * into v_prod from public.produtos where id = nullif(it->>'produto_id','')::uuid;
    if not found then raise exception 'Produto não encontrado no cardápio'; end if;
    v_qtd := coalesce(nullif(it->>'quantidade','')::numeric, 1);
    if v_qtd <= 0 then raise exception 'Quantidade inválida em %', v_prod.nome; end if;
    v_preco := coalesce(nullif(it->>'preco_unitario','')::numeric, v_prod.preco_venda);

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

  update public.vendas set subtotal = v_sub, total = v_total, taxa_canal = v_taxa,
         liquido = v_total - v_taxa, custo_total = round(v_custo_total, 2)
   where id = v_id;

  if v_total - v_taxa > 0 then
    insert into public.lancamentos (tipo, categoria_id, descricao, valor, vencimento, pago_em, conta_id, origem, venda_id)
    values ('receita', public.categoria_por_nome('Vendas'),
            'Venda #' || (select numero from public.vendas where id = v_id) || ' — ' || v_canal.nome,
            v_total - v_taxa, (v_data at time zone 'America/Sao_Paulo')::date,
            (v_data at time zone 'America/Sao_Paulo')::date, v_conta, 'venda', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.cancelar_venda(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_membro();
  update public.vendas set status = 'cancelada' where id = p_id and status = 'concluida';
  if not found then raise exception 'Venda não encontrada ou já cancelada'; end if;
  delete from public.movimentos where venda_id = p_id;
  delete from public.lancamentos where venda_id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- ESTOQUE manual
-- ---------------------------------------------------------------------------
-- tipo: 'entrada' (ajuste para mais / saldo inicial) | 'saida' (perda, uso interno)
create or replace function public.ajustar_estoque(p_insumo uuid, p_tipo text, p_quantidade numeric,
                                                  p_motivo text default 'ajuste', p_custo_unitario numeric default null,
                                                  p_obs text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ins public.insumos%rowtype;
begin
  perform public.exigir_membro();
  select * into v_ins from public.insumos where id = p_insumo;
  if not found then raise exception 'Insumo não encontrado'; end if;
  if p_tipo not in ('entrada','saida') then raise exception 'Tipo deve ser entrada ou saida'; end if;
  if p_motivo not in ('ajuste','perda','inicial') then raise exception 'Motivo deve ser ajuste, perda ou inicial'; end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  insert into public.movimentos (insumo_id, tipo, quantidade, custo_unitario, origem, obs)
  values (p_insumo, p_tipo, p_quantidade, coalesce(p_custo_unitario, v_ins.custo_medio), p_motivo, p_obs);
end $$;

-- Contagem física: informa quanto tem de verdade e o banco lança a diferença
create or replace function public.contar_estoque(p_insumo uuid, p_quantidade_contada numeric) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_ins public.insumos%rowtype; v_dif numeric;
begin
  perform public.exigir_membro();
  select * into v_ins from public.insumos where id = p_insumo;
  if not found then raise exception 'Insumo não encontrado'; end if;
  if p_quantidade_contada is null or p_quantidade_contada < 0 then raise exception 'Contagem inválida'; end if;
  v_dif := p_quantidade_contada - v_ins.estoque_atual;
  if v_dif <> 0 then
    insert into public.movimentos (insumo_id, tipo, quantidade, custo_unitario, origem, obs)
    values (p_insumo, case when v_dif > 0 then 'entrada' else 'saida' end, abs(v_dif), v_ins.custo_medio,
            'contagem', 'Contagem: ' || p_quantidade_contada);
  end if;
  return v_dif;
end $$;

create or replace function public.excluir_movimento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_membro();
  delete from public.movimentos where id = p_id and origem in ('ajuste','perda','contagem','inicial');
  if not found then raise exception 'Só dá para excluir ajustes manuais (compras/vendas: exclua a compra ou cancele a venda)'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Visões (respeitam RLS de quem consulta)
-- ---------------------------------------------------------------------------
create view public.v_produtos_custo with (security_invoker = true) as
select p.id, p.nome, p.grupo, p.preco_venda, p.ativo,
       coalesce(sum(ft.quantidade * i.custo_medio), 0)::numeric(12,2) as custo,
       count(ft.id) as itens_ficha,
       (p.preco_venda - coalesce(sum(ft.quantidade * i.custo_medio), 0))::numeric(12,2) as margem_bruta
  from public.produtos p
  left join public.ficha_tecnica ft on ft.produto_id = p.id
  left join public.insumos i on i.id = ft.insumo_id
 group by p.id;

create view public.v_saldos_contas with (security_invoker = true) as
select c.id, c.nome, c.tipo, c.ativo, c.saldo_inicial,
       (c.saldo_inicial
        + coalesce(sum(l.valor) filter (where l.tipo = 'receita' and l.pago_em is not null), 0)
        - coalesce(sum(l.valor) filter (where l.tipo = 'despesa' and l.pago_em is not null), 0))::numeric(12,2) as saldo
  from public.contas c
  left join public.lancamentos l on l.conta_id = c.id
 group by c.id;

-- ---------------------------------------------------------------------------
-- PAINEL: tudo que o dono precisa ver num período (datas no fuso de São Paulo)
-- ---------------------------------------------------------------------------
create or replace function public.painel(p_inicio date, p_fim date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  r jsonb;
  v_vendas record;
  v_desp numeric; v_desp_pagas numeric; v_estoque_compras numeric;
  v_invest_total numeric; v_aporte numeric; v_result_total numeric;
begin
  perform public.exigir_membro();

  select count(*) as qtd, coalesce(sum(total),0) as faturamento, coalesce(sum(taxa_canal),0) as taxas,
         coalesce(sum(liquido),0) as liquido, coalesce(sum(custo_total),0) as cmv
    into v_vendas
    from public.vendas
   where status = 'concluida' and (data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;

  select coalesce(sum(l.valor),0),
         coalesce(sum(l.valor) filter (where l.pago_em is not null),0)
    into v_desp, v_desp_pagas
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'despesa' and l.vencimento between p_inicio and p_fim;

  select coalesce(sum(l.valor),0) into v_estoque_compras
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'estoque' and l.vencimento between p_inicio and p_fim;

  -- desde o início até hoje (parcelas futuras ainda não aconteceram)
  select coalesce(sum(l.valor),0) into v_invest_total
    from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.tipo = 'despesa' and c.tipo = 'investimento';

  select coalesce(sum(l.valor),0) into v_aporte
    from public.lancamentos l join public.contas ct on ct.id = l.conta_id
   where l.tipo = 'despesa' and l.pago_em is not null and ct.tipo = 'dono';

  select coalesce((select sum(liquido - custo_total) from public.vendas where status = 'concluida'),0)
       - coalesce((select sum(l.valor) from public.lancamentos l join public.categorias c on c.id = l.categoria_id
                    where l.tipo = 'despesa' and c.tipo = 'despesa' and l.vencimento <= current_date),0)
       + coalesce((select sum(l.valor) from public.lancamentos l
                    where l.tipo = 'receita' and l.origem = 'manual' and l.vencimento <= current_date),0)
    into v_result_total;

  r := jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'vendas', jsonb_build_object(
      'quantidade', v_vendas.qtd,
      'faturamento', v_vendas.faturamento,
      'taxas_canal', v_vendas.taxas,
      'liquido', v_vendas.liquido,
      'cmv', v_vendas.cmv,
      'lucro_bruto', v_vendas.liquido - v_vendas.cmv,
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
                    from (select canal_id, count(*) qtd, sum(total) fat, sum(taxa_canal) tx from public.vendas
                           where status = 'concluida' and (data at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
                           group by canal_id) t join public.canais c on c.id = t.canal_id)
  );
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Segurança: RLS + grants mínimos
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['membros','categorias','contas','canais','insumos','produtos','ficha_tecnica',
                           'compras','compra_itens','vendas','venda_itens','movimentos','lancamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy membros_leem on public.%I for select to authenticated using ((select public.eh_membro()))', t);
  end loop;

  -- cadastros editáveis direto pelo app
  foreach t in array array['categorias','contas','canais','produtos','ficha_tecnica','lancamentos'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy membros_gravam on public.%I for all to authenticated using ((select public.eh_membro())) with check ((select public.eh_membro()))', t);
  end loop;
end $$;

-- insumos: saldo e custo médio são do banco
grant insert (nome, unidade, grupo, estoque_minimo, ativo) on public.insumos to authenticated;
grant update (nome, unidade, grupo, estoque_minimo, ativo) on public.insumos to authenticated;
grant delete on public.insumos to authenticated;
create policy membros_gravam on public.insumos for all to authenticated
  using ((select public.eh_membro())) with check ((select public.eh_membro()));

revoke all on public.v_produtos_custo, public.v_saldos_contas from anon, authenticated;
grant select on public.v_produtos_custo, public.v_saldos_contas to authenticated;

-- funções: só membros logados
revoke execute on all functions in schema public from public, anon;
grant execute on function public.eh_membro(), public.exigir_membro(), public.registrar_compra(jsonb), public.excluir_compra(uuid),
  public.registrar_venda(jsonb), public.cancelar_venda(uuid),
  public.ajustar_estoque(uuid, text, numeric, text, numeric, text), public.contar_estoque(uuid, numeric),
  public.excluir_movimento(uuid), public.painel(date, date), public.dividir_parcelas(numeric, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Dados iniciais (todos editáveis no app)
-- ---------------------------------------------------------------------------
insert into public.categorias (nome, tipo) values
  ('Vendas','receita'), ('Outras receitas','receita'),
  ('Insumos e embalagens','estoque'),
  ('Impostos (DAS)','despesa'), ('Gás','despesa'), ('Entrega','despesa'), ('Marketing','despesa'),
  ('Juros e tarifas','despesa'), ('Pró-labore','despesa'), ('Outras despesas','despesa'),
  ('Equipamentos e utensílios','investimento'), ('Abertura e documentação','investimento');

insert into public.contas (nome, tipo) values
  ('Conta da empresa','empresa'), ('Dinheiro (gaveta)','empresa'), ('Do meu bolso','dono');

insert into public.canais (nome, taxa_percentual) values
  ('Balcão', 0), ('WhatsApp', 0), ('iFood', 26.2);

comment on function public.registrar_venda(jsonb) is
  'Registra venda: {"canal_id":uuid,"conta_id"?:uuid,"cliente"?,"desconto"?,"taxa_entrega"?,"data"?,"itens":[{"produto_id":uuid,"quantidade":n,"preco_unitario"?:n}]}. Baixa estoque pela ficha técnica e lança receita líquida (total − taxa do canal).';
comment on function public.registrar_compra(jsonb) is
  'Registra compra: {"data","fornecedor","conta_id","frete","desconto","parcelas","primeiro_vencimento"?,"pago"?,"itens":[{"insumo_id"? | "categoria_id"?,"descricao","quantidade","valor_total"}]}. Item com insumo entra no estoque; demais vão para a categoria. Com "id" edita a compra.';
comment on function public.painel(date, date) is
  'Resumo do período: vendas, CMV, lucro bruto, despesas, resultado, caixa, contas, a pagar, investimento total, aporte do bolso, retorno %, estoque baixo, mais vendidos, por canal.';

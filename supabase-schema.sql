create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_name text not null,
  subscription_status text not null default 'trial',
  subscription_provider text,
  subscription_external_id text,
  trial_ends_at timestamptz default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  product text not null default 'compra parcelada',
  notes text default '',
  created_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  number integer not null,
  amount numeric(12,2) not null,
  due_date date not null,
  paid boolean not null default false,
  paid_at timestamptz
);

create table public.client_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.message_templates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminder text not null,
  late text not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.installments enable row level security;
alter table public.client_history enable row level security;
alter table public.message_templates enable row level security;

create policy "profiles own rows" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "clients own rows" on public.clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "installments own rows" on public.installments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "history own rows" on public.client_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "templates own rows" on public.message_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

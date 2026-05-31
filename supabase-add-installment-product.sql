alter table public.installments
add column if not exists product text not null default 'compra parcelada';

update public.installments
set product = coalesce(public.clients.product, 'compra parcelada')
from public.clients
where public.installments.client_id = public.clients.id
  and (public.installments.product is null or public.installments.product = 'compra parcelada');

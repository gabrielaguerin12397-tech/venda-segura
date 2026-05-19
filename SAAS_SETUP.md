# Venda Segura como SaaS

Objetivo: vender o Venda Segura por assinatura para usuario final.

## Stack recomendada

- Hospedagem: Vercel ou Netlify.
- Login e banco de dados: Supabase.
- Pagamento recorrente: Mercado Pago ou Asaas.
- Preco inicial: R$ 29,90 por mes.

## Etapa 1: publicar o sistema

1. Entre na Vercel ou Netlify.
2. Importe o repositorio `gabrielaguerin12397-tech/venda-segura`.
3. Deixe o build command vazio.
4. Use publish directory como `.`.
5. Depois copie o link publicado.

## Etapa 2: criar assinatura

1. Crie uma conta no Mercado Pago ou Asaas.
2. Crie um plano recorrente de R$ 29,90 por mes.
3. Copie o link de checkout.
4. Crie um arquivo `config.js` baseado em `config.example.js`.
5. Cole o link no campo `checkoutUrl`.

## Etapa 3: ativar login e banco online

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Rode o arquivo `supabase-schema.sql`.
4. Copie a Project URL e a anon public key.
5. Coloque os valores em `config.js`.

## Etapa 4: regra comercial

Enquanto o pagamento ainda nao estiver integrado automaticamente, use este fluxo:

1. Cliente clica em assinar.
2. Cliente paga no checkout.
3. Voce confirma o pagamento no painel do provedor.
4. Voce libera o acesso do cliente no Supabase.

Depois, o proximo passo tecnico e criar um webhook para liberar ou bloquear acesso automaticamente quando a assinatura for paga, cancelada ou vencida.

## Importante

Hoje o app salva dados no navegador. Para vender assinatura de verdade, os dados precisam ficar por usuario no banco online. O arquivo `supabase-schema.sql` ja deixa a estrutura preparada para isso, com seguranca por usuario usando Row Level Security.

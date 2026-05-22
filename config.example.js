window.VENDA_SEGURA_CONFIG = {
  // Cole aqui o link de checkout/assinatura criado no Mercado Pago, Asaas ou Stripe.
  checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout/seu-link-aqui",
  siteUrl: "https://appvendasegura.com.br",

  // Preencha quando ativar Supabase para login e banco de dados online.
  supabaseUrl: "https://seu-projeto.supabase.co",
  supabaseAnonKey: "sua-chave-publica-anon",

  // Use false em producao depois que login, banco e pagamento estiverem ativos.
  allowLocalMode: true,
};

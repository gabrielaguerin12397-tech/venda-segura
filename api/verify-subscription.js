const ASAAS_API_URL = process.env.ASAAS_API_URL || "https://api.asaas.com/v3";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Metodo nao permitido." });
  }

  try {
    assertEnv(["ASAAS_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

    const token = getBearerToken(request);
    if (!token) {
      return response.status(401).json({ error: "Sessao invalida." });
    }

    const user = await getSupabaseUser(token);
    const profile = await getProfile(user.id);
    const payments = await findAsaasPayments(user.id, profile?.subscription_external_id);
    const status = getSubscriptionStatus(payments);

    if (status !== "pending") {
      await updateProfile(user.id, {
        subscription_status: status,
        subscription_provider: "asaas",
        subscription_external_id: payments[0]?.subscription || profile?.subscription_external_id || null,
      });
    }

    return response.status(200).json({
      status,
      message: getStatusMessage(status),
      paymentStatus: payments[0]?.status || null,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Erro interno." });
  }
};

function getSubscriptionStatus(payments) {
  if (payments.some((payment) => ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(payment.status))) {
    return "active";
  }

  if (payments.some((payment) => payment.status === "OVERDUE")) {
    return "past_due";
  }

  if (payments.some((payment) => ["REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"].includes(payment.status))) {
    return "blocked";
  }

  return "pending";
}

function getStatusMessage(status) {
  if (status === "active") return "Pagamento confirmado. Assinatura ativa.";
  if (status === "past_due") return "Pagamento esta pendente ou vencido.";
  if (status === "blocked") return "Pagamento nao foi aprovado.";
  return "Pagamento ainda aguardando confirmacao do Asaas.";
}

async function findAsaasPayments(userId, checkoutSession) {
  const queries = [`externalReference=${encodeURIComponent(userId)}`];

  if (checkoutSession) {
    queries.push(`checkoutSession=${encodeURIComponent(checkoutSession)}`);
  }

  const results = await Promise.all(queries.map((query) => listPayments(query)));
  const unique = new Map();

  results.flat().forEach((payment) => {
    if (payment?.id) unique.set(payment.id, payment);
  });

  return Array.from(unique.values()).sort((a, b) => String(b.dateCreated || "").localeCompare(String(a.dateCreated || "")));
}

async function listPayments(query) {
  const result = await fetch(`${ASAAS_API_URL}/payments?limit=10&${query}`, {
    headers: {
      accept: "application/json",
      access_token: process.env.ASAAS_API_KEY,
    },
  });

  if (!result.ok) {
    throw new Error("Nao foi possivel consultar pagamentos no Asaas.");
  }

  const payload = await result.json();
  return payload.data || [];
}

async function getSupabaseUser(token) {
  const result = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!result.ok) {
    throw new Error("Sessao invalida.");
  }

  return result.json();
}

async function getProfile(userId) {
  const result = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!result.ok) {
    throw new Error("Nao foi possivel consultar assinatura no Supabase.");
  }

  const rows = await result.json();
  return rows[0] || null;
}

async function updateProfile(userId, fields) {
  const result = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });

  if (!result.ok) {
    throw new Error("Nao foi possivel atualizar assinatura no Supabase.");
  }
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function assertEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Variaveis ausentes na Vercel: ${missing.join(", ")}`);
  }
}

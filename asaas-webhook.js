module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Metodo nao permitido." });
  }

  if (request.headers["asaas-access-token"] !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return response.status(401).json({ error: "Webhook nao autorizado." });
  }

  try {
    assertEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ASAAS_WEBHOOK_TOKEN"]);

    const event = request.body?.event;
    const userId = findExternalReference(request.body);

    if (!userId) {
      return response.status(200).json({ received: true, ignored: "Sem externalReference." });
    }

    const status = mapAsaasEventToStatus(event);

    if (status) {
      await updateProfile(userId, {
        subscription_status: status,
        subscription_provider: "asaas",
        subscription_external_id: request.body?.payment?.subscription || request.body?.subscription?.id || null,
      });
    }

    return response.status(200).json({ received: true });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Erro interno." });
  }
};

function mapAsaasEventToStatus(event) {
  if (["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(event)) {
    return "active";
  }

  if (["PAYMENT_OVERDUE"].includes(event)) {
    return "past_due";
  }

  if (["PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "SUBSCRIPTION_DELETED"].includes(event)) {
    return "blocked";
  }

  return null;
}

function findExternalReference(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.externalReference === "string" && value.externalReference.length <= 200) {
    return value.externalReference;
  }

  for (const child of Object.values(value)) {
    const found = findExternalReference(child);
    if (found) return found;
  }

  return null;
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

function assertEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Variaveis ausentes na Vercel: ${missing.join(", ")}`);
  }
}

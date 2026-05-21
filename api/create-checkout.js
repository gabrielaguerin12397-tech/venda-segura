const ASAAS_API_URL = process.env.ASAAS_API_URL || "https://api.asaas.com/v3";
const PLAN_VALUE = 29.9;

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
    const customerName = String(request.body?.name || user.email || "Minha loja").trim();
    const cpfCnpj = onlyDigits(request.body?.cpfCnpj || "");
    const phoneNumber = onlyDigits(request.body?.phoneNumber || "");
    const origin = request.headers.origin || `https://${request.headers.host}`;

    if (![11, 14].includes(cpfCnpj.length)) {
      return response.status(400).json({ error: "Informe um CPF ou CNPJ valido para assinar." });
    }

    if (![10, 11].includes(phoneNumber.length)) {
      return response.status(400).json({ error: "Informe um telefone valido com DDD para assinar." });
    }

    const checkoutResponse = await fetch(`${ASAAS_API_URL}/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: process.env.ASAAS_API_KEY,
      },
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 1440,
        externalReference: user.id,
        callback: {
          successUrl: origin,
          cancelUrl: origin,
          expiredUrl: origin,
        },
        items: [
          {
            name: "Venda Segura - Plano Essencial",
            description: "Assinatura mensal do Venda Segura",
            quantity: 1,
            value: PLAN_VALUE,
          },
        ],
        customerData: {
          name: customerName,
          email: user.email,
          cpfCnpj,
          phone: phoneNumber,
          phoneNumber,
        },
        subscription: {
          cycle: "MONTHLY",
          nextDueDate: formatAsaasDate(addDays(new Date(), 1)),
        },
      }),
    });

    const checkout = await checkoutResponse.json();

    if (!checkoutResponse.ok) {
      return response.status(400).json({
        error: checkout.errors?.[0]?.description || "Nao foi possivel criar o checkout no Asaas.",
      });
    }

    await updateProfile(user.id, {
      subscription_status: "pending",
      subscription_provider: "asaas",
      subscription_external_id: checkout.id || null,
    });

    return response.status(200).json({
      url: checkout.url || checkout.link || checkout.checkoutUrl || checkout.invoiceUrl,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Erro interno." });
  }
};

function assertEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Variaveis ausentes na Vercel: ${missing.join(", ")}`);
  }
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
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

async function updateProfile(userId, fields) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatAsaasDate(date) {
  return date.toISOString().slice(0, 10);
}

function onlyDigits(value) {
  return String(value).replace(/\D/g, "");
}

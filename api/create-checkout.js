const ASAAS_API_URL = process.env.ASAAS_API_URL || "https://api.asaas.com/v3";
const PLAN_VALUE = 19.99;

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
    const cpfCnpj = normalizeCpfCnpj(request.body?.cpfCnpj || "");
    const phoneNumber = normalizeBrazilPhone(request.body?.phoneNumber || "");
    const postalCode = onlyDigits(request.body?.postalCode || "");
    const address = String(request.body?.address || "").trim();
    const addressNumber = String(request.body?.addressNumber || "").trim();
    const province = String(request.body?.province || "").trim();
    const city = String(request.body?.city || "").trim();
    const state = String(request.body?.state || "").trim().toUpperCase();
    const origin = request.headers.origin || `https://${request.headers.host}`;
    const callbackBaseUrl = getCallbackBaseUrl(origin);

    if (!isValidCpfCnpj(cpfCnpj)) {
      return response.status(400).json({ error: "Informe um CPF ou CNPJ valido para assinar." });
    }

    if (!phoneNumber) {
      return response.status(400).json({ error: "Informe um telefone valido com DDD para assinar." });
    }

    if (postalCode.length !== 8 || !address || !addressNumber || !province || !city || state.length !== 2) {
      return response.status(400).json({ error: "Informe endereco completo para assinar." });
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
          successUrl: `${callbackBaseUrl}?checkout=success`,
          cancelUrl: `${callbackBaseUrl}?checkout=cancel`,
          expiredUrl: `${callbackBaseUrl}?checkout=expired`,
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
          postalCode,
          address,
          addressNumber,
          province,
          city,
          state,
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

function getCallbackBaseUrl(origin) {
  return (process.env.APP_URL || origin).replace(/\/$/, "");
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

function normalizeCpfCnpj(value) {
  return onlyDigits(value).slice(0, 14);
}

function normalizeBrazilPhone(value) {
  let digits = onlyDigits(value);

  if (digits.startsWith("0055")) {
    digits = digits.slice(4);
  }

  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }

  return [10, 11].includes(digits.length) ? digits : "";
}

function isValidCpfCnpj(value) {
  return isValidCpf(value) || isValidCnpj(value);
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  return digit === Number(cpf[10]);
}

function isValidCnpj(value) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calc = (size) => {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

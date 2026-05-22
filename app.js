const storageKey = "venda-segura";
const sessionKey = "venda-segura-session";
const notificationEnabledKey = "venda-segura-notifications-enabled";
const notificationDateKey = "venda-segura-last-notification-date";
const appConfig = window.VENDA_SEGURA_CONFIG || {};
const supabaseClient =
  window.supabase && appConfig.supabaseUrl && appConfig.supabaseAnonKey
    ? window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey)
    : null;

const defaultTemplates = {
  reminder:
    "Oi, {nome}. Tudo bem? Passando para lembrar que sua parcela de {valor}, referente a {produto}, vence em {vencimento}. Qualquer coisa me avisa.",
  late:
    "Oi, {nome}. Tudo bem? Vi aqui que sua parcela de {valor}, referente a {produto}, venceu em {vencimento}. Pode me confirmar quando consegue regularizar?",
};

const state = loadState();
const runtimeStatus = document.querySelector("#runtime-status");
let editingClientId = null;
let filterTimer = null;
let currentUserId = null;
let currentProfile = null;

runtimeStatus.textContent = "Interação ativa";
runtimeStatus.classList.add("ready");

const formatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
});

const views = {
  clients: document.querySelector("#clients-view"),
  charges: document.querySelector("#charges-view"),
};

const pageTitles = {
  clients: "Clientes",
  charges: "Cobranças",
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-open-client-modal]").forEach((button) => {
  button.addEventListener("click", startNewClient);
});

document.querySelector("#enter-app").addEventListener("click", enterApp);
document.querySelector("#create-account").addEventListener("click", createAccount);
document.querySelector("#start-trial").addEventListener("click", () => showAuthPage("signup"));
document.querySelector("#open-login").addEventListener("click", () => showAuthPage("login"));
document.querySelector("#back-to-sales").addEventListener("click", showSalesPage);
document.querySelector("#forgot-password").addEventListener("click", openPasswordModal);
document.querySelector("#close-password-modal").addEventListener("click", closePasswordModal);
document.querySelector("#cancel-password-recovery").addEventListener("click", closePasswordModal);
document.querySelector("#send-password-recovery").addEventListener("click", recoverPassword);
document.querySelector("#save-new-password").addEventListener("click", saveNewPassword);
document.querySelector("#sidebar-toggle").addEventListener("click", toggleSidebar);
document.querySelector("#client-form").addEventListener("submit", handleClientSubmit);
document.querySelector("#clear-client-form").addEventListener("click", resetClientForm);
document.querySelector("#open-client-search").addEventListener("click", showClientSearch);
["#client-search", "#product-filter", "#created-start-filter", "#created-end-filter", "#due-start-filter", "#due-end-filter"].forEach(
  (selector) => document.querySelector(selector).addEventListener("input", scheduleClientRender),
);
document.querySelector("#client-filter").addEventListener("change", renderClients);
document.querySelector("#clear-filters").addEventListener("click", clearFilters);
document.querySelector("#sign-out").addEventListener("click", signOut);
document.querySelector("#billing-sign-out").addEventListener("click", signOut);
document.querySelector("#billing-form").addEventListener("submit", startSubscription);
document.querySelector("#billing-cpf-cnpj").addEventListener("input", formatBillingDocument);
document.querySelector("#billing-phone").addEventListener("input", formatBillingPhone);
document.querySelector("#enable-notifications").addEventListener("click", enableNotifications);

document.querySelector("#workspace-name").value = localStorage.getItem(sessionKey) || "";

initializeApp();

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return {
      clients: [],
      templates: { ...defaultTemplates },
    };
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      clients: (parsed.clients || []).map(normalizeClient),
      templates: { ...defaultTemplates, ...(parsed.templates || {}) },
    };
  } catch {
    return {
      clients: [],
      templates: { ...defaultTemplates },
    };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

async function initializeApp() {
  resetClientForm();
  render();
  watchPasswordRecovery();
  await showGateIfNeeded();
}

function watchPasswordRecovery() {
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      openNewPasswordModal();
    }
  });

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("type") === "recovery") {
    openNewPasswordModal();
  }
}

async function showGateIfNeeded() {
  if (!supabaseClient) {
    if (appConfig.allowLocalMode) {
      setAuthStatus("Supabase nao configurado. Modo local liberado para testes.");
      return;
    }

    setAuthStatus("Configure o Supabase no arquivo config.js para liberar o acesso.");
    document.querySelector("#app-shell").classList.add("is-hidden");
    showAuthPage("login");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  const user = data.session?.user;

  if (user) {
    currentUserId = user.id;
    const storeName = user.user_metadata?.store_name || user.email || "Minha loja";
    localStorage.setItem(sessionKey, storeName);
    await ensureUserProfile(user, storeName);
    await loadRemoteState();
    showAppOrBilling();
    return;
  }

  localStorage.removeItem(sessionKey);
  showSalesPage();
}

async function enterApp() {
  if (document.querySelector("#enter-app").dataset.authMode === "switch-login") {
    showAuthPage("login");
    return;
  }

  const name = document.querySelector("#workspace-name").value.trim() || "Minha loja";

  if (supabaseClient) {
    const email = document.querySelector("#auth-email").value.trim();
    const password = document.querySelector("#auth-password").value;

    if (!email || !password) {
      setAuthStatus("Informe e-mail e senha para entrar.");
      return;
    }

    setAuthStatus("Entrando...");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthStatus("Nao foi possivel entrar. Confira e-mail e senha.");
      return;
    }

    const { data } = await supabaseClient.auth.getUser();
    currentUserId = data.user?.id || null;
    if (data.user) {
      await ensureUserProfile(data.user, name);
      await loadRemoteState();
    }
  }

  localStorage.setItem(sessionKey, name);
  showAppOrBilling();
}

async function createAccount() {
  if (!supabaseClient) {
    setAuthStatus("Configure o Supabase antes de criar contas.");
    return;
  }

  const name = document.querySelector("#workspace-name").value.trim() || "Minha loja";
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;

  if (!email || !password) {
    setAuthStatus("Informe e-mail e senha para criar a conta.");
    return;
  }

  if (password.length < 6) {
    setAuthStatus("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  setAuthStatus("Criando conta...");
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        store_name: name,
      },
    },
  });

  if (error) {
    setAuthStatus(`Nao foi possivel criar a conta: ${translateSupabaseError(error.message)}`);
    return;
  }

  localStorage.setItem(sessionKey, name);

  if (data.session) {
    currentUserId = data.user?.id || null;
    if (data.user) {
      await ensureUserProfile(data.user, name);
      await loadRemoteState();
    }
    showAppOrBilling();
    return;
  }

  setAuthStatus("Conta criada. Se o Supabase pedir confirmacao, confira seu e-mail antes de entrar.");
}

function showApp() {
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#billing-gate").classList.add("is-hidden");
  document.querySelector("#app-shell").classList.remove("is-hidden");
}

function showSalesPage() {
  document.querySelector("#launch-gate").classList.remove("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#billing-gate").classList.add("is-hidden");
  document.querySelector("#app-shell").classList.add("is-hidden");
  setAuthStatus("");
}

function showAuthPage(mode) {
  const isLogin = mode === "login";
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.remove("is-hidden");
  document.querySelector("#billing-gate").classList.add("is-hidden");
  document.querySelector("#app-shell").classList.add("is-hidden");
  document.querySelector("#auth-title").textContent = isLogin ? "Entrar na conta" : "Criar conta";
  document.querySelector("#auth-intro").textContent = isLogin
    ? "Entre para acessar seus clientes, parcelas e mensagens salvas."
    : "Teste gratis e organize seus clientes, parcelas e cobrancas em uma conta segura.";
  document.querySelector("#workspace-name").closest("label").classList.toggle("is-hidden", isLogin);
  document.querySelector("#create-account").classList.toggle("is-hidden", isLogin);
  document.querySelector("#forgot-password").classList.toggle("is-hidden", !isLogin);
  document.querySelector("#enter-app").textContent = isLogin ? "Entrar" : "Ja tenho conta";
  document.querySelector("#enter-app").dataset.authMode = isLogin ? "login" : "switch-login";
  setAuthStatus("");
}

function openPasswordModal() {
  const email = document.querySelector("#auth-email").value.trim();
  document.querySelector("#recovery-email").value = email;
  document.querySelector("#recovery-status").textContent = "";
  document.querySelector("#password-modal").classList.remove("is-hidden");
  document.querySelector("#recovery-email").focus();
}

function closePasswordModal() {
  document.querySelector("#password-modal").classList.add("is-hidden");
}

async function recoverPassword() {
  if (!supabaseClient) {
    document.querySelector("#recovery-status").textContent = "Configure o Supabase antes de recuperar senha.";
    return;
  }

  const email = document.querySelector("#recovery-email").value.trim();
  const button = document.querySelector("#send-password-recovery");
  const status = document.querySelector("#recovery-status");

  if (!email) {
    status.textContent = "Informe seu e-mail para recuperar a senha.";
    document.querySelector("#recovery-email").focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Enviando...";
  status.textContent = "";

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  button.disabled = false;
  button.textContent = "Enviar link";

  if (error) {
    status.textContent = `Nao foi possivel enviar recuperacao: ${translateSupabaseError(error.message)}`;
    return;
  }

  status.textContent = "Enviamos um link de recuperacao para seu e-mail.";
}

function openNewPasswordModal() {
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#billing-gate").classList.add("is-hidden");
  document.querySelector("#new-password-status").textContent = "";
  document.querySelector("#new-password").value = "";
  document.querySelector("#confirm-new-password").value = "";
  document.querySelector("#new-password-modal").classList.remove("is-hidden");
  document.querySelector("#new-password").focus();
}

async function saveNewPassword() {
  if (!supabaseClient) return;

  const password = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-new-password").value;
  const status = document.querySelector("#new-password-status");
  const button = document.querySelector("#save-new-password");

  if (password.length < 6) {
    status.textContent = "A senha precisa ter pelo menos 6 caracteres.";
    return;
  }

  if (password !== confirmation) {
    status.textContent = "As senhas nao conferem.";
    return;
  }

  button.disabled = true;
  button.textContent = "Salvando...";
  status.textContent = "";

  const { error } = await supabaseClient.auth.updateUser({ password });

  button.disabled = false;
  button.textContent = "Salvar nova senha";

  if (error) {
    status.textContent = `Nao foi possivel salvar a senha: ${translateSupabaseError(error.message)}`;
    return;
  }

  status.textContent = "Senha alterada com sucesso. Abrindo o app...";
  window.history.replaceState({}, document.title, window.location.pathname);
  document.querySelector("#new-password-modal").classList.add("is-hidden");
  const { data } = await supabaseClient.auth.getUser();
  currentUserId = data.user?.id || null;
  if (data.user) {
    const storeName = data.user.user_metadata?.store_name || data.user.email || "Minha loja";
    localStorage.setItem(sessionKey, storeName);
    await ensureUserProfile(data.user, storeName);
    await loadRemoteState();
  }
  showAppOrBilling();
}

function showAppOrBilling() {
  if (hasSubscriptionAccess()) {
    showApp();
    return;
  }

  showBillingGate();
}

function showBillingGate() {
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#billing-gate").classList.remove("is-hidden");
  document.querySelector("#app-shell").classList.add("is-hidden");
  document.querySelector("#billing-message").textContent =
    currentProfile?.subscription_status === "past_due"
      ? "Identificamos uma pendencia na assinatura. Regularize para continuar usando."
      : "Seu periodo de teste terminou. Assine o Plano Essencial para continuar usando.";
}

function hasSubscriptionAccess() {
  if (!currentProfile) return true;
  if (currentProfile.subscription_status === "active") return true;
  if (currentProfile.subscription_status === "trial") {
    return !currentProfile.trial_ends_at || new Date(currentProfile.trial_ends_at) > new Date();
  }
  return false;
}

async function ensureUserProfile(user, storeName) {
  if (!supabaseClient || !user?.id) return;

  const { data: existingProfile } = await supabaseClient.from("profiles").select("id").eq("id", user.id).maybeSingle();

  if (existingProfile) {
    await supabaseClient
      .from("profiles")
      .update({
        store_name: storeName || user.email || "Minha loja",
      })
      .eq("id", user.id);
    return;
  }

  await supabaseClient.from("profiles").insert({
    id: user.id,
    store_name: storeName || user.email || "Minha loja",
    subscription_status: "trial",
  });
}

async function loadRemoteState() {
  if (!supabaseClient || !currentUserId) return;

  setAuthStatus("Carregando dados...");

  const [{ data: profile }, { data: clients }, { data: installments }, { data: history }, { data: templates }] = await Promise.all([
    supabaseClient.from("profiles").select("*").eq("id", currentUserId).maybeSingle(),
    supabaseClient.from("clients").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("installments").select("*").order("number", { ascending: true }),
    supabaseClient.from("client_history").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("message_templates").select("*").eq("user_id", currentUserId).maybeSingle(),
  ]);

  currentProfile = profile || null;

  state.clients = (clients || []).map((client) => ({
    id: client.id,
    name: client.name,
    phone: client.phone,
    product: client.product,
    notes: client.notes || "",
    createdAt: client.created_at,
    installments: (installments || [])
      .filter((installment) => installment.client_id === client.id)
      .map((installment) => ({
        id: installment.id,
        number: installment.number,
        amount: Number(installment.amount),
        dueDate: installment.due_date,
        paid: installment.paid,
        paidAt: installment.paid_at,
      })),
    history: (history || [])
      .filter((event) => event.client_id === client.id)
      .map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        createdAt: event.created_at,
      })),
  }));

  state.templates = {
    ...defaultTemplates,
    ...(templates ? { reminder: templates.reminder, late: templates.late } : {}),
  };

  saveState();
  render();
  notifyDueChargesOncePerDay();
  setAuthStatus("");
}

async function syncRemoteState() {
  if (!supabaseClient || !currentUserId) return;

  const clientRows = state.clients.map((client) => ({
    id: client.id,
    user_id: currentUserId,
    name: client.name,
    phone: client.phone,
    product: client.product,
    notes: client.notes || "",
    created_at: client.createdAt || new Date().toISOString(),
  }));

  const installmentRows = state.clients.flatMap((client) =>
    client.installments.map((installment) => ({
      id: installment.id,
      client_id: client.id,
      user_id: currentUserId,
      number: installment.number,
      amount: installment.amount,
      due_date: installment.dueDate,
      paid: installment.paid,
      paid_at: installment.paidAt,
    })),
  );

  const historyRows = state.clients.flatMap((client) =>
    (client.history || []).map((event) => ({
      id: event.id,
      client_id: client.id,
      user_id: currentUserId,
      title: event.title,
      description: event.description,
      created_at: event.createdAt,
    })),
  );

  await supabaseClient.from("clients").delete().eq("user_id", currentUserId);
  if (clientRows.length) await supabaseClient.from("clients").insert(clientRows);
  if (installmentRows.length) await supabaseClient.from("installments").insert(installmentRows);
  if (historyRows.length) await supabaseClient.from("client_history").insert(historyRows);
  await supabaseClient.from("message_templates").upsert({
    user_id: currentUserId,
    reminder: state.templates.reminder,
    late: state.templates.late,
    updated_at: new Date().toISOString(),
  });
}

function setAuthStatus(message) {
  const status = document.querySelector("#auth-status");
  if (status) {
    status.textContent = message;
  }
}

function translateSupabaseError(message) {
  const normalized = String(message || "").toLowerCase();

  if (normalized.includes("already") || normalized.includes("registered")) {
    return "esse e-mail ja tem cadastro.";
  }

  if (normalized.includes("password")) {
    return "verifique a senha. Ela precisa ter pelo menos 6 caracteres.";
  }

  if (normalized.includes("email")) {
    return "verifique se o e-mail esta correto e se login por e-mail esta ativo no Supabase.";
  }

  if (normalized.includes("signup") || normalized.includes("signups")) {
    return "cadastro por e-mail pode estar desativado no Supabase.";
  }

  return message || "erro desconhecido.";
}

async function signOut() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }

  currentUserId = null;
  currentProfile = null;
  localStorage.removeItem(sessionKey);
  showSalesPage();
  setAuthStatus("Voce saiu do sistema.");
}

async function startSubscription(event) {
  event.preventDefault();

  const button = document.querySelector("#subscribe-button");
  const status = document.querySelector("#billing-status");
  const cpfCnpj = normalizeCpfCnpj(document.querySelector("#billing-cpf-cnpj").value);
  const phoneNumber = normalizeBrazilPhone(document.querySelector("#billing-phone").value);

  if (!isValidCpfCnpj(cpfCnpj)) {
    status.textContent = "Informe um CPF ou CNPJ valido.";
    document.querySelector("#billing-cpf-cnpj").focus();
    return;
  }

  if (!phoneNumber) {
    status.textContent = "Informe um telefone valido com DDD. Exemplo: 92999998888.";
    document.querySelector("#billing-phone").focus();
    return;
  }

  try {
    button.disabled = true;
    button.textContent = "Abrindo assinatura...";
    status.textContent = "";

    const { data } = await supabaseClient.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      status.textContent = "Entre novamente para assinar.";
      return;
    }

    const response = await fetch("/api/create-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: document.querySelector("#billing-name").value.trim() || localStorage.getItem(sessionKey) || "Minha loja",
        cpfCnpj,
        phoneNumber,
        postalCode: onlyDigits(document.querySelector("#billing-postal-code").value),
        address: document.querySelector("#billing-address").value.trim(),
        addressNumber: document.querySelector("#billing-address-number").value.trim(),
        province: document.querySelector("#billing-province").value.trim(),
        city: document.querySelector("#billing-city").value.trim(),
        state: document.querySelector("#billing-state").value.trim().toUpperCase(),
      }),
    });

    const payload = await readJsonResponse(response);

    if (!response.ok || !payload.url) {
      status.textContent = payload.error || "Nao foi possivel abrir o checkout.";
      return;
    }

    window.location.href = payload.url;
  } catch {
    status.textContent = "Nao foi possivel abrir o checkout. Confira se a pasta api foi enviada ao GitHub e se a Vercel terminou o deploy.";
  } finally {
    button.disabled = false;
    button.textContent = "Assinar agora";
  }
}

function formatBillingDocument(event) {
  const digits = normalizeCpfCnpj(event.target.value);
  event.target.value = digits.length <= 11 ? formatCpf(digits) : formatCnpj(digits);
}

function formatBillingPhone(event) {
  const digits = normalizeBrazilPhone(event.target.value) || normalizeBrazilPhoneLoose(event.target.value);
  event.target.value = formatBrazilPhone(digits);
}

function normalizeCpfCnpj(value) {
  return onlyDigits(value).slice(0, 14);
}

function normalizeBrazilPhone(value) {
  const digits = normalizeBrazilPhoneLoose(value);
  return [10, 11].includes(digits.length) ? digits : "";
}

function normalizeBrazilPhoneLoose(value) {
  let digits = onlyDigits(value);

  if (digits.startsWith("0055")) {
    digits = digits.slice(4);
  }

  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }

  return digits.slice(0, 11);
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

function formatCpf(value) {
  const digits = onlyDigits(value);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatCnpj(value) {
  const digits = onlyDigits(value);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatBrazilPhone(value) {
  const digits = onlyDigits(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error: `Resposta inesperada da Vercel (${response.status}). Verifique os logs do deploy.`,
    };
  }
}

function setView(viewName) {
  hideClientTools();
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[viewName].classList.add("active");
  document.querySelector("#page-title").textContent = pageTitles[viewName];
  document.querySelector("#client-actions").classList.toggle("is-hidden", viewName !== "clients");

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function hideClientTools() {
  document.querySelector("#client-form-panel").classList.add("is-hidden");
  document.querySelector("#client-filter-panel").classList.add("is-hidden");
}

function render() {
  renderClients();
  renderCharges();
}

function toggleSidebar() {
  document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
}

function scheduleClientRender() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderClients, 180);
}

function resetClientForm() {
  const form = document.querySelector("#client-form");
  editingClientId = null;
  form.reset();
  form.elements.clientId.value = "";
  form.elements.firstDueDate.value = toInputDate(new Date());
  document.querySelector("#client-form-title").textContent = "Cadastrar cliente";
  document.querySelector("#client-form-submit").textContent = "Salvar cliente";
  setClientFeedback("");
}

function startNewClient() {
  resetClientForm();
  setView("clients");
  showClientForm();
}

function focusClientForm() {
  document.querySelector("#client-form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#client-form").elements.name.focus();
}

function showClientForm() {
  document.querySelector("#client-filter-panel").classList.add("is-hidden");
  document.querySelector("#client-form-panel").classList.remove("is-hidden");
  focusClientForm();
}

function setClientFeedback(message) {
  const feedback = document.querySelector("#client-feedback");
  if (feedback) {
    feedback.textContent = message;
  }
}

function showClientNotice(message) {
  const list = document.querySelector("#client-list");
  const notice = document.createElement("div");
  notice.className = "client-notice";
  notice.textContent = message;
  list.before(notice);

  setTimeout(() => {
    notice.remove();
  }, 4000);
}

function showClientSearch() {
  setView("clients");
  document.querySelector("#client-form-panel").classList.add("is-hidden");
  document.querySelector("#client-filter-panel").classList.remove("is-hidden");
  document.querySelector("#client-filter-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#client-search").focus();
}

async function handleClientSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = document.querySelector("#client-form-submit");

  if (submitButton.disabled) return;

  submitButton.disabled = true;
  submitButton.textContent = editingClientId ? "Salvando..." : "Cadastrando...";
  setClientFeedback("");

  const formData = new FormData(form);
  const total = Number(formData.get("total"));
  const installments = Number(formData.get("installments"));
  const firstDueDate = formData.get("firstDueDate");
  const clientId = String(formData.get("clientId") || "");
  const existing = state.clients.find((item) => item.id === clientId);

  try {
    if (existing) {
      existing.name = String(formData.get("name")).trim();
      existing.phone = onlyDigits(String(formData.get("phone")));
      existing.product = String(formData.get("product")).trim() || "compra parcelada";
      existing.notes = String(formData.get("notes")).trim();
      existing.installments = buildEditedInstallments(existing, total, installments, firstDueDate);
      addHistory(existing, "Cliente editado", `Dados e dívida atualizados para ${money(total)} em ${installments} parcela(s).`);
    } else {
      const client = {
        id: createId(),
        name: String(formData.get("name")).trim(),
        phone: onlyDigits(String(formData.get("phone"))),
        product: String(formData.get("product")).trim() || "compra parcelada",
        notes: String(formData.get("notes")).trim(),
        createdAt: new Date().toISOString(),
        installments: buildInstallments(total, installments, firstDueDate),
        history: [],
      };

      addHistory(client, "Cliente cadastrado", `Dívida criada em ${installments} parcela(s), total de ${money(total)}.`);
      state.clients.unshift(client);
    }

    saveState();
    await syncRemoteState();
    resetClientForm();
    document.querySelector("#client-form-panel").classList.add("is-hidden");
    render();
    setView("clients");
    setClientFeedback(existing ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
    showClientNotice(existing ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
  } catch (error) {
    setClientFeedback("Nao foi possivel salvar o cliente. Tente novamente.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = editingClientId ? "Salvar alterações" : "Salvar cliente";
  }
}

function buildInstallments(total, count, firstDueDate) {
  const amount = roundMoney(total / count);
  const dueDate = parseInputDate(firstDueDate);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + index, dueDate.getUTCDate()));
    const isLast = index === count - 1;
    const adjustedAmount = isLast ? roundMoney(total - amount * (count - 1)) : amount;

    return {
      id: createId(),
      number: index + 1,
      amount: adjustedAmount,
      dueDate: toInputDate(date),
      paid: false,
      paidAt: null,
    };
  });
}

function buildEditedInstallments(client, total, count, firstDueDate) {
  const rebuilt = buildInstallments(total, count, firstDueDate);

  return rebuilt.map((installment, index) => {
    const previous = client.installments[index];
    if (!previous) return installment;

    return {
      ...installment,
      id: previous.id,
      paid: previous.paid,
      paidAt: previous.paidAt,
    };
  });
}

function renderClients() {
  const query = document.querySelector("#client-search").value.trim().toLowerCase();
  const productQuery = document.querySelector("#product-filter").value.trim().toLowerCase();
  const createdStart = document.querySelector("#created-start-filter").value;
  const createdEnd = document.querySelector("#created-end-filter").value;
  const dueStart = document.querySelector("#due-start-filter").value;
  const dueEnd = document.querySelector("#due-end-filter").value;
  const filter = document.querySelector("#client-filter").value;
  const list = document.querySelector("#client-list");

  const filtered = state.clients.filter((client) => {
    const summary = getClientSummary(client);
    const haystack = `${client.name} ${client.phone}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesProduct = !productQuery || client.product.toLowerCase().includes(productQuery);
    const matchesCreated = isDateInRange(toInputDate(new Date(client.createdAt)), createdStart, createdEnd);
    const matchesDue = matchesAnyInstallmentDue(client, dueStart, dueEnd);
    const matchesFilter =
      filter === "all" ||
      (filter === "late" && summary.lateCount > 0) ||
      (filter === "open" && summary.openTotal > 0) ||
      (filter === "paid" && summary.openTotal === 0);

    return matchesQuery && matchesProduct && matchesCreated && matchesDue && matchesFilter;
  });

  list.innerHTML = filtered.length
    ? filtered.map(renderClientCard).join("")
    : `<div class="empty-state">Nenhum cliente encontrado.</div>`;

  list.querySelectorAll("[data-toggle-paid]").forEach((button) => {
    button.addEventListener("click", () => toggleInstallmentPaid(button.dataset.clientId, button.dataset.installmentId));
  });

  list.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => openWhatsApp(button.dataset.clientId, button.dataset.installmentId));
  });

  list.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => editClient(button.dataset.clientId));
  });

  list.querySelectorAll("[data-delete-client]").forEach((button) => {
    button.addEventListener("click", () => deleteClient(button.dataset.clientId));
  });

  list.querySelectorAll("[data-delete-installment]").forEach((button) => {
    button.addEventListener("click", () => deleteInstallment(button.dataset.clientId, button.dataset.installmentId));
  });

  list.querySelectorAll("[data-toggle-history]").forEach((button) => {
    button.addEventListener("click", () => toggleHistory(button.dataset.clientId));
  });

  list.querySelectorAll("[data-toggle-installments]").forEach((button) => {
    button.addEventListener("click", () => toggleInstallments(button.dataset.clientId));
  });
}

function renderCharges() {
  const charges = getChargeItems();
  const summary = document.querySelector("#charge-summary");
  const list = document.querySelector("#charge-list");
  const todayKey = toInputDate(startOfToday());
  const lateCount = charges.filter(({ status }) => status.type === "late").length;
  const todayCount = charges.filter(({ installment }) => installment.dueDate === todayKey).length;
  const upcomingCount = charges.length - lateCount - todayCount;

  summary.innerHTML = `
    <div class="charge-summary-card">
      <span>Atrasadas</span>
      <strong>${lateCount}</strong>
    </div>
    <div class="charge-summary-card">
      <span>Vencem hoje</span>
      <strong>${todayCount}</strong>
    </div>
    <div class="charge-summary-card">
      <span>Proximas</span>
      <strong>${upcomingCount}</strong>
    </div>
  `;

  list.innerHTML = charges.length
    ? charges.map(renderChargeCard).join("")
    : `<div class="empty-state">Sem cobrancas vencidas ou proximas por enquanto.</div>`;

  list.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => openWhatsApp(button.dataset.clientId, button.dataset.installmentId));
  });

  list.querySelectorAll("[data-toggle-paid]").forEach((button) => {
    button.addEventListener("click", () => toggleInstallmentPaid(button.dataset.clientId, button.dataset.installmentId));
  });

  updateNotificationButton();
}

function getChargeItems() {
  const today = startOfToday();
  const limit = addDays(today, 3);

  return getOpenInstallments()
    .filter(({ installment }) => {
      const due = parseInputDate(installment.dueDate);
      return due <= limit;
    })
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
    .map(({ client, installment }) => ({ client, installment, status: getInstallmentStatus(installment) }));
}

function renderChargeCard({ client, installment, status }) {
  const todayKey = toInputDate(startOfToday());
  const cardType = status.type === "late" ? "late" : installment.dueDate === todayKey ? "today" : "upcoming";
  const label = status.type === "late" ? "Atrasada" : installment.dueDate === todayKey ? "Vence hoje" : "Proxima";

  return `
    <article class="charge-card ${cardType}">
      <div class="charge-card-header">
        <div>
          <h3>${escapeHtml(client.name)}</h3>
          <p>${formatPhone(client.phone)} · ${escapeHtml(client.product)}</p>
        </div>
        <span class="status-pill ${status.className}">${label}</span>
      </div>

      <div class="charge-meta">
        <div><span>Parcela</span><strong>${installment.number}/${client.installments.length}</strong></div>
        <div><span>Vencimento</span><strong>${formatDate(installment.dueDate)}</strong></div>
        <div><span>Valor</span><strong>${money(installment.amount)}</strong></div>
        <div><span>Status</span><strong>${status.label}</strong></div>
      </div>

      <div class="charge-card-actions">
        <button class="small-button action-whatsapp" data-whatsapp data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Enviar WhatsApp</button>
        <button class="small-button action-payment" data-toggle-paid data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Marcar pago</button>
      </div>
    </article>
  `;
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    alert("Este navegador nao permite notificacoes.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("Permissao de notificacao nao foi liberada.");
    return;
  }

  localStorage.setItem(notificationEnabledKey, "true");
  updateNotificationButton();
  await notifyDueChargesOncePerDay(true);
}

function updateNotificationButton() {
  const button = document.querySelector("#enable-notifications");
  if (!button) return;

  const enabled = "Notification" in window && localStorage.getItem(notificationEnabledKey) === "true" && Notification.permission === "granted";
  button.textContent = enabled ? "Notificacoes ativas" : "Ativar notificacoes";
}

async function notifyDueChargesOncePerDay(force = false) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (localStorage.getItem(notificationEnabledKey) !== "true") return;

  const todayKey = toInputDate(startOfToday());
  if (!force && localStorage.getItem(notificationDateKey) === todayKey) return;

  const charges = getChargeItems().filter(({ installment, status }) => status.type === "late" || installment.dueDate === todayKey);
  if (!charges.length) {
    if (force) {
      await showAppNotification("Venda Segura", "Notificacoes ativadas. Nenhuma cobranca vence hoje.");
    }
    return;
  }

  localStorage.setItem(notificationDateKey, todayKey);
  const lateCount = charges.filter(({ status }) => status.type === "late").length;
  const todayCount = charges.length - lateCount;
  const parts = [];
  if (lateCount) parts.push(`${lateCount} atrasada${lateCount > 1 ? "s" : ""}`);
  if (todayCount) parts.push(`${todayCount} vencendo hoje`);

  await showAppNotification("Cobrancas para acompanhar", `Voce tem ${parts.join(" e ")} no Venda Segura.`);
}

async function showAppNotification(title, body) {
  const options = {
    body,
    badge: "/icons/icon-192.svg",
    icon: "/icons/icon-192.svg",
    tag: "venda-segura-cobrancas",
  };

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, options);
    return;
  }

  new Notification(title, options);
}

function renderClientCard(client) {
  const summary = getClientSummary(client);
  const history = client.history || [];
  const nextInstallment = client.installments
    .filter((installment) => !installment.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return `
    <article class="client-card">
      <div class="client-card-header">
        <div>
          <h3>${escapeHtml(client.name)}</h3>
        </div>
        <div class="row-actions">
          <span class="status-pill ${summary.lateCount > 0 ? "status-late" : summary.openTotal > 0 ? "status-open" : "status-paid"}">
            ${summary.lateCount > 0 ? "Em atraso" : summary.openTotal > 0 ? "Em aberto" : "Quitado"}
          </span>
          <button class="small-button action-client" data-edit-client data-client-id="${client.id}" type="button">Editar</button>
          <button class="small-button action-installments" data-toggle-installments data-client-id="${client.id}" type="button">Parcelas</button>
          <button class="small-button action-history" data-toggle-history data-client-id="${client.id}" type="button">Histórico</button>
          <button class="small-button action-delete" data-delete-client data-client-id="${client.id}" type="button">Excluir cliente</button>
        </div>
      </div>

      <div class="client-sections">
        <section class="client-section">
          <h4>Dados pessoais</h4>
          <div class="detail-grid">
            <div class="detail-row"><span>Telefone</span><strong>${formatPhone(client.phone)}</strong></div>
            <div class="detail-row"><span>Produto</span><strong>${escapeHtml(client.product)}</strong></div>
            <div class="detail-row"><span>Cadastro</span><strong>${formatDate(toInputDate(new Date(client.createdAt)))}</strong></div>
          </div>
        </section>

        <section class="client-section">
          <h4>Financeiro</h4>
          <div class="detail-grid">
            <div class="detail-row"><span>Total</span><strong>${money(summary.total)}</strong></div>
            <div class="detail-row"><span>Em aberto</span><strong>${money(summary.openTotal)}</strong></div>
            <div class="detail-row"><span>Recebido</span><strong>${money(summary.paidTotal)}</strong></div>
            <div class="detail-row"><span>Próximo vencimento</span><strong>${nextInstallment ? formatDate(nextInstallment.dueDate) : "Quitado"}</strong></div>
          </div>
        </section>
      </div>

      <div class="installments" id="installments-${client.id}">
        ${client.installments.map((installment) => renderInstallmentRow(client, installment)).join("")}
      </div>

      <div class="client-history" id="history-${client.id}">
        <h2>Histórico do cliente</h2>
        <div class="history-list">
          ${
            history.length
              ? history
                  .slice()
                  .reverse()
                  .map(
                    (event) => `
                      <div class="history-item">
                        <strong>${escapeHtml(event.title)}</strong>
                        <span class="history-meta">${formatDateTime(event.createdAt)} · ${escapeHtml(event.description)}</span>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-state">Nenhum histórico registrado.</div>`
          }
        </div>
      </div>
    </article>
  `;
}

function renderInstallmentRow(client, installment) {
  const status = getInstallmentStatus(installment);
  return `
    <div class="installment-row">
      <div>
        <strong>Parcela ${installment.number}/${client.installments.length}</strong>
        <div class="installment-summary">${formatDate(installment.dueDate)} · ${money(installment.amount)}</div>
      </div>
      <span class="status-pill ${status.className}">${status.label}</span>
      <div class="row-actions">
        ${
          installment.paid
            ? `<button class="small-button action-reopen" data-toggle-paid data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Reabrir</button>
               <button class="small-button action-delete" data-delete-installment data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Excluir dívida</button>`
            : `<button class="small-button action-whatsapp" data-whatsapp data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">WhatsApp</button>
               <button class="small-button action-payment" data-toggle-paid data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Marcar pago</button>
               <button class="small-button action-delete" data-delete-installment data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Excluir dívida</button>`
        }
      </div>
    </div>
  `;
}

function getClientSummary(client) {
  return client.installments.reduce(
    (summary, installment) => {
      summary.total += installment.amount;
      if (installment.paid) {
        summary.paidTotal += installment.amount;
      } else {
        summary.openTotal += installment.amount;
        if (getInstallmentStatus(installment).type === "late") {
          summary.lateCount += 1;
        }
      }
      return summary;
    },
    { total: 0, paidTotal: 0, openTotal: 0, lateCount: 0 },
  );
}

function editClient(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;

  const form = document.querySelector("#client-form");
  const summary = getClientSummary(client);
  editingClientId = client.id;
  form.elements.clientId.value = client.id;
  form.elements.name.value = client.name;
  form.elements.phone.value = client.phone;
  form.elements.product.value = client.product;
  form.elements.total.value = roundMoney(summary.total);
  form.elements.installments.value = client.installments.length;
  form.elements.firstDueDate.value = client.installments[0]?.dueDate || toInputDate(new Date());
  form.elements.notes.value = client.notes || "";
  document.querySelector("#client-form-title").textContent = "Editar cliente e dívida";
  document.querySelector("#client-form-submit").textContent = "Salvar alterações";
  setView("clients");
  showClientForm();
}

async function deleteClient(clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;

  const confirmed = confirm(`Excluir ${client.name} e todas as dividas desse cliente? Essa acao nao pode ser desfeita.`);
  if (!confirmed) return;

  state.clients = state.clients.filter((item) => item.id !== clientId);
  saveState();
  await syncRemoteState();
  render();
  showClientNotice("Cliente excluido com sucesso.");
}

async function deleteInstallment(clientId, installmentId) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) return;

  const installment = client.installments.find((item) => item.id === installmentId);
  if (!installment) return;

  const confirmed = confirm(`Excluir a parcela ${installment.number}/${client.installments.length} de ${client.name}?`);
  if (!confirmed) return;

  client.installments = client.installments
    .filter((item) => item.id !== installmentId)
    .map((item, index) => ({
      ...item,
      number: index + 1,
    }));

  addHistory(client, "Divida excluida", `Parcela de ${money(installment.amount)} com vencimento em ${formatDate(installment.dueDate)} foi excluida.`);

  if (!client.installments.length) {
    state.clients = state.clients.filter((item) => item.id !== clientId);
    saveState();
    await syncRemoteState();
    render();
    showClientNotice("Ultima divida excluida. O cliente tambem foi removido.");
    return;
  }

  saveState();
  await syncRemoteState();
  render();
  showClientNotice("Divida excluida com sucesso.");
}

function toggleHistory(clientId) {
  const panel = document.getElementById(`history-${clientId}`);
  if (panel) {
    panel.classList.toggle("open");
  }
}

function toggleInstallments(clientId) {
  const panel = document.getElementById(`installments-${clientId}`);
  if (panel) {
    panel.classList.toggle("open");
  }
}

function clearFilters() {
  ["#client-search", "#product-filter", "#created-start-filter", "#created-end-filter", "#due-start-filter", "#due-end-filter"].forEach(
    (selector) => {
      document.querySelector(selector).value = "";
    },
  );
  document.querySelector("#client-filter").value = "all";
  renderClients();
}

function getOpenInstallments() {
  return state.clients.flatMap((client) =>
    client.installments.filter((installment) => !installment.paid).map((installment) => ({ client, installment })),
  );
}

function getInstallmentStatus(installment) {
  if (installment.paid) {
    return { type: "paid", label: "Pago", className: "status-paid" };
  }

  const due = parseInputDate(installment.dueDate);
  if (due < startOfToday()) {
    return { type: "late", label: "Atrasado", className: "status-late" };
  }

  return { type: "open", label: "Aberto", className: "status-open" };
}

async function toggleInstallmentPaid(clientId, installmentId) {
  const client = state.clients.find((item) => item.id === clientId);
  const installment = client?.installments.find((item) => item.id === installmentId);
  if (!installment) return;

  installment.paid = !installment.paid;
  installment.paidAt = installment.paid ? new Date().toISOString() : null;
  addHistory(
    client,
    installment.paid ? "Parcela marcada como paga" : "Parcela reaberta",
    `Parcela ${installment.number}/${client.installments.length} no valor de ${money(installment.amount)}.`,
  );
  saveState();
  await syncRemoteState();
  render();
}

function exportData() {
  const payload = {
    app: "Venda Segura",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaceName: localStorage.getItem(sessionKey) || "Minha loja",
    data: state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `venda-segura-backup-${toInputDate(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const imported = parsed.data || parsed;
      state.clients = (imported.clients || []).map(normalizeClient);
      state.templates = { ...defaultTemplates, ...(imported.templates || {}) };
      saveState();
      await syncRemoteState();
      render();
      alert("Backup importado com sucesso.");
    } catch {
      alert("Não consegui importar esse arquivo. Verifique se é um backup JSON do Venda Segura.");
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}

async function openWhatsApp(clientId, installmentId) {
  const client = state.clients.find((item) => item.id === clientId);
  const installment = client?.installments.find((item) => item.id === installmentId);
  if (!client || !installment) return;

  const status = getInstallmentStatus(installment);
  const template = status.type === "late" ? state.templates.late : state.templates.reminder;
  const message = template
    .replaceAll("{nome}", client.name)
    .replaceAll("{valor}", money(installment.amount))
    .replaceAll("{produto}", client.product)
    .replaceAll("{vencimento}", formatDate(installment.dueDate));

  addHistory(client, "Cobrança enviada pelo WhatsApp", `Parcela ${installment.number}/${client.installments.length}, ${money(installment.amount)}.`);
  saveState();
  await syncRemoteState();
  render();
  window.open(`https://wa.me/${toWhatsAppPhone(client.phone)}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

async function seedDemoData() {
  if (state.clients.length && !confirm("Adicionar clientes de exemplo junto aos dados atuais?")) {
    return;
  }

  const today = startOfToday();
  const demo = [
    {
      name: "Fernanda Costa",
      phone: "92984858118",
      product: "Natura",
      total: 180,
      installments: 3,
      firstDueDate: toInputDate(addDays(today, -35)),
    },
    {
      name: "João Pereira",
      phone: "92977776666",
      product: "Roupas",
      total: 320,
      installments: 4,
      firstDueDate: toInputDate(addDays(today, 2)),
    },
    {
      name: "Ana Souza",
      phone: "92966665555",
      product: "Avon",
      total: 95,
      installments: 1,
      firstDueDate: toInputDate(addDays(today, -5)),
    },
  ].map((item) => ({
    id: createId(),
    name: item.name,
    phone: item.phone,
    product: item.product,
    notes: "",
    createdAt: new Date().toISOString(),
    installments: buildInstallments(item.total, item.installments, item.firstDueDate),
    history: [],
  }));

  demo[0].installments[0].paid = true;
  demo[0].installments[0].paidAt = new Date().toISOString();
  demo.forEach((client) => addHistory(client, "Cliente de exemplo criado", "Registro gerado para testar o sistema."));

  state.clients.unshift(...demo);
  saveState();
  await syncRemoteState();
  render();
}

function money(value) {
  return formatter.format(value || 0);
}

function formatDate(value) {
  return dateFormatter.format(parseInputDate(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPhone(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function onlyDigits(value) {
  return value.replace(/\D/g, "");
}

function toWhatsAppPhone(value) {
  const digits = onlyDigits(value);
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function normalizeClient(client) {
  return {
    ...client,
    product: client.product || "compra parcelada",
    notes: client.notes || "",
    createdAt: client.createdAt || new Date().toISOString(),
    installments: client.installments || [],
    history: client.history || [
      {
        id: createId(),
        title: "Histórico iniciado",
        description: "Cliente importado de uma versão anterior do app.",
        createdAt: client.createdAt || new Date().toISOString(),
      },
    ],
  };
}

function addHistory(client, title, description) {
  client.history = client.history || [];
  client.history.push({
    id: createId(),
    title,
    description,
    createdAt: new Date().toISOString(),
  });
}

function matchesAnyInstallmentDue(client, start, end) {
  if (!start && !end) return true;
  return client.installments.some((installment) => isDateInRange(installment.dueDate, start, end));
}

function isDateInRange(value, start, end) {
  if (!value) return false;
  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
}

function createId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyRow(message, columns) {
  return `<tr><td class="empty-state" colspan="${columns}">${message}</td></tr>`;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function parseInputDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const storageKey = "venda-segura";
const sessionKey = "venda-segura-session";
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
  dashboard: document.querySelector("#dashboard-view"),
  clients: document.querySelector("#clients-view"),
  charges: document.querySelector("#charges-view"),
  messages: document.querySelector("#messages-view"),
};

const pageTitles = {
  dashboard: "Painel",
  clients: "Clientes",
  charges: "Cobranças",
  messages: "Mensagens",
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
document.querySelector("#sidebar-toggle").addEventListener("click", toggleSidebar);
document.querySelector("#client-form").addEventListener("submit", handleClientSubmit);
document.querySelector("#clear-client-form").addEventListener("click", resetClientForm);
["#client-search", "#product-filter", "#created-start-filter", "#created-end-filter", "#due-start-filter", "#due-end-filter"].forEach(
  (selector) => document.querySelector(selector).addEventListener("input", scheduleClientRender),
);
document.querySelector("#client-filter").addEventListener("change", renderClients);
document.querySelector("#clear-filters").addEventListener("click", clearFilters);
document.querySelector("#export-data").addEventListener("click", exportData);
document.querySelector("#import-data").addEventListener("change", importData);
document.querySelector("#save-templates").addEventListener("click", saveTemplates);
document.querySelector("#seed-demo").addEventListener("click", seedDemoData);
document.querySelector("#sign-out").addEventListener("click", signOut);

document.querySelector("#template-reminder").value = state.templates.reminder;
document.querySelector("#template-late").value = state.templates.late;
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
  await showGateIfNeeded();
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
    showApp();
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
  showApp();
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
    showApp();
    return;
  }

  setAuthStatus("Conta criada. Se o Supabase pedir confirmacao, confira seu e-mail antes de entrar.");
}

function showApp() {
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#app-shell").classList.remove("is-hidden");
}

function showSalesPage() {
  document.querySelector("#launch-gate").classList.remove("is-hidden");
  document.querySelector("#auth-gate").classList.add("is-hidden");
  document.querySelector("#app-shell").classList.add("is-hidden");
  setAuthStatus("");
}

function showAuthPage(mode) {
  const isLogin = mode === "login";
  document.querySelector("#launch-gate").classList.add("is-hidden");
  document.querySelector("#auth-gate").classList.remove("is-hidden");
  document.querySelector("#app-shell").classList.add("is-hidden");
  document.querySelector("#auth-title").textContent = isLogin ? "Entrar na conta" : "Criar conta";
  document.querySelector("#auth-intro").textContent = isLogin
    ? "Entre para acessar seus clientes, parcelas e mensagens salvas."
    : "Teste gratis e organize seus clientes, parcelas e cobrancas em uma conta segura.";
  document.querySelector("#workspace-name").closest("label").classList.toggle("is-hidden", isLogin);
  document.querySelector("#create-account").classList.toggle("is-hidden", isLogin);
  document.querySelector("#enter-app").textContent = isLogin ? "Entrar" : "Ja tenho conta";
  document.querySelector("#enter-app").dataset.authMode = isLogin ? "login" : "switch-login";
  setAuthStatus("");
}

async function ensureUserProfile(user, storeName) {
  if (!supabaseClient || !user?.id) return;

  await supabaseClient.from("profiles").upsert({
    id: user.id,
    store_name: storeName || user.email || "Minha loja",
    subscription_status: "trial",
  });
}

async function loadRemoteState() {
  if (!supabaseClient || !currentUserId) return;

  setAuthStatus("Carregando dados...");

  const [{ data: clients }, { data: installments }, { data: history }, { data: templates }] = await Promise.all([
    supabaseClient.from("clients").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("installments").select("*").order("number", { ascending: true }),
    supabaseClient.from("client_history").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("message_templates").select("*").eq("user_id", currentUserId).maybeSingle(),
  ]);

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

  document.querySelector("#template-reminder").value = state.templates.reminder;
  document.querySelector("#template-late").value = state.templates.late;
  saveState();
  render();
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
  localStorage.removeItem(sessionKey);
  showSalesPage();
  setAuthStatus("Voce saiu do sistema.");
}

function setView(viewName) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[viewName].classList.add("active");
  document.querySelector("#page-title").textContent = pageTitles[viewName];

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

function render() {
  renderDashboard();
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
}

function startNewClient() {
  resetClientForm();
  focusClientForm();
}

function focusClientForm() {
  setView("clients");
  document.querySelector("#client-form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#client-form").elements.name.focus();
}

async function handleClientSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const total = Number(formData.get("total"));
  const installments = Number(formData.get("installments"));
  const firstDueDate = formData.get("firstDueDate");
  const clientId = String(formData.get("clientId") || "");
  const existing = state.clients.find((item) => item.id === clientId);

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
  render();
  setView("clients");
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

function renderDashboard() {
  const summaries = state.clients.map(getClientSummary);
  const activeClients = summaries.filter((summary) => summary.openTotal > 0).length;
  const lateClients = summaries.filter((summary) => summary.lateCount > 0).length;
  const openTotal = summaries.reduce((sum, summary) => sum + summary.openTotal, 0);
  const paidTotal = summaries.reduce((sum, summary) => sum + summary.paidTotal, 0);

  document.querySelector("#metric-active-clients").textContent = activeClients;
  document.querySelector("#metric-late-clients").textContent = lateClients;
  document.querySelector("#metric-open-total").textContent = money(openTotal);
  document.querySelector("#metric-paid-total").textContent = money(paidTotal);

  const upcoming = getOpenInstallments()
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
    .slice(0, 8);

  document.querySelector("#upcoming-rows").innerHTML = upcoming.length
    ? upcoming.map(renderInstallmentTableRow).join("")
    : emptyRow("Nenhuma parcela aberta.", 5);

  const late = getOpenInstallments()
    .filter(({ installment }) => getInstallmentStatus(installment).type === "late")
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate))
    .slice(0, 5);

  document.querySelector("#alert-list").innerHTML = late.length
    ? late
        .map(
          ({ client, installment }) => `
            <div class="alert-item">
              <strong>${escapeHtml(client.name)} tem parcela em atraso</strong>
              <span>${money(installment.amount)} vencida em ${formatDate(installment.dueDate)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">Nenhum atraso no momento.</div>`;
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

  list.querySelectorAll("[data-toggle-history]").forEach((button) => {
    button.addEventListener("click", () => toggleHistory(button.dataset.clientId));
  });

  list.querySelectorAll("[data-toggle-installments]").forEach((button) => {
    button.addEventListener("click", () => toggleInstallments(button.dataset.clientId));
  });
}

function renderCharges() {
  const today = startOfToday();
  const limit = addDays(today, 3);
  const charges = getOpenInstallments()
    .filter(({ installment }) => {
      const due = parseInputDate(installment.dueDate);
      return due <= limit;
    })
    .sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate));

  const body = document.querySelector("#charge-rows");
  body.innerHTML = charges.length
    ? charges
        .map(({ client, installment }) => {
          return `
            <tr>
              <td>${escapeHtml(client.name)}</td>
              <td>${formatPhone(client.phone)}</td>
              <td>${installment.number}/${client.installments.length}</td>
              <td>${formatDate(installment.dueDate)}</td>
              <td>${money(installment.amount)}</td>
              <td>
                <button class="small-button action-whatsapp" data-whatsapp="${client.id}" data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">WhatsApp</button>
              </td>
            </tr>
          `;
        })
        .join("")
    : emptyRow("Sem cobranças para hoje.", 6);

  body.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => openWhatsApp(button.dataset.clientId, button.dataset.installmentId));
  });
}

function renderInstallmentTableRow({ client, installment }) {
  const status = getInstallmentStatus(installment);

  return `
    <tr>
      <td>${escapeHtml(client.name)}</td>
      <td>${installment.number}/${client.installments.length}</td>
      <td>${formatDate(installment.dueDate)}</td>
      <td>${money(installment.amount)}</td>
      <td><span class="status-pill ${status.className}">${status.label}</span></td>
    </tr>
  `;
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
            ? `<button class="small-button action-reopen" data-toggle-paid data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Reabrir</button>`
            : `<button class="small-button action-whatsapp" data-whatsapp data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">WhatsApp</button>
               <button class="small-button action-payment" data-toggle-paid data-client-id="${client.id}" data-installment-id="${installment.id}" type="button">Marcar pago</button>`
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
  focusClientForm();
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

async function saveTemplates() {
  state.templates.reminder = document.querySelector("#template-reminder").value.trim() || defaultTemplates.reminder;
  state.templates.late = document.querySelector("#template-late").value.trim() || defaultTemplates.late;
  saveState();
  await syncRemoteState();
  alert("Mensagens salvas.");
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
      document.querySelector("#template-reminder").value = state.templates.reminder;
      document.querySelector("#template-late").value = state.templates.late;
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

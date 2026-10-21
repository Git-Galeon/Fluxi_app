const API_URL = "https://script.google.com/macros/s/AKfycby1jX08m7dgL5K-P9ItmkkLOeLUrle_fwHkiXdgsMnA3kVkW5MBMFJuYNEkGwylfPa9/exec";

// El token ya NO vive en el repo: se pide una vez y queda guardado solo en este dispositivo.
function getToken() { return localStorage.getItem('fluxi_token') || ''; }
function pedirToken(forzar = false) {
  const actual = getToken();
  if (actual && !forzar) return actual;
  const t = (prompt('Clave de acceso de Fluxi:') || '').trim();
  if (t) localStorage.setItem('fluxi_token', t);
  return t;
}

// Escapa texto antes de insertarlo en innerHTML (evita XSS desde la planilla)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Toda comunicación con el backend pasa por aquí (lecturas y escrituras, con token y timeout)
async function llamarAPI(payload, timeoutMs = 20000) {
  const token = pedirToken();
  if (!token) throw new Error('Falta la clave de acceso');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, secret_token: token }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('Error de red (' + res.status + ')');
    const data = await res.json();
    if (data && data.error) {
      if (data.error === 'No autorizado') localStorage.removeItem('fluxi_token');
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

let currentTab = 'dashboard';
let openModals = [];
let cuentasGlobales = [];
let movimientosGlobales = [];
let categoriasGlobales = [];
let dashboardGlobal = {};
let desgloseAbierto = false;
let miGrafico = null;
let miGraficoCategorias = null;

const DEFAULT_CATEGORIES = [
  "Alimentación", "Transporte", "Cuentas Fijas", "Ocio", "Salud", "Ahorro", "Otros"
];

const _fmt = {
  CLP: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }),
  USD: new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'USD' })
};
const formatMoneda = (valor, moneda = 'CLP') => (_fmt[moneda] || _fmt.CLP).format(Number(valor) || 0);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => console.log("PWA Ready")).catch(e => console.log("SW Error", e));
}

document.addEventListener("DOMContentLoaded", () => {
  history.replaceState({ tab: 'dashboard', openModals: [] }, '');

  window.onpopstate = function (e) {
    if (e.state) {
      const targetModals = e.state.openModals || [];
      openModals.forEach(id => { if (!targetModals.includes(id)) execCloseModal(id); });
      targetModals.forEach(id => { if (!openModals.includes(id)) execOpenModal(id); });
      openModals = [...targetModals];
      if (e.state.tab && e.state.tab !== currentTab) execSwitchTab(e.state.tab);
    }
  };

  initFABPosition();
  inicializarFechaHoy();
  try {
    const guardado = localStorage.getItem('fluxi_cache');
    if (guardado) aplicarTodo(JSON.parse(guardado));
  } catch (e) {}
  forzarSincronizacion();

  document.getElementById("movMonto").addEventListener("input", actualizarCalculoCuota);
  document.getElementById("movCuotas").addEventListener("input", actualizarCalculoCuota);
});

function inicializarFechaHoy() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  document.getElementById("movFecha").value = `${yyyy}-${mm}-${dd}`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `custom-toast p-3.5 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-bold border transform scale-90 opacity-0 translate-y-2 pointer-events-auto`;
  
  let bg = 'bg-slate-900 border-slate-800 text-slate-100';
  let icon = '<i class="fa-solid fa-circle-info text-blue-400"></i>';
  
  if (type === 'success') {
    bg = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    icon = '<i class="fa-solid fa-circle-check"></i>';
  } else if (type === 'error') {
    bg = 'bg-rose-500/10 border-rose-500/20 text-rose-400';
    icon = '<i class="fa-solid fa-circle-exclamation"></i>';
  } else if (type === 'warning') {
    bg = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
    icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  }

  toast.className += ` ${bg}`;
  toast.innerHTML = `${icon} <span class="flex-1">${esc(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('scale-90', 'opacity-0', 'translate-y-2');
    toast.classList.add('scale-100', 'opacity-100', 'translate-y-0');
  }, 50);

  setTimeout(() => {
    toast.classList.add('scale-90', 'opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

let pendingConfirmResolve = null;
function showConfirm(title, desc) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-desc').innerText = desc;
  const modal = document.getElementById('custom-confirm');
  modal.classList.remove('hidden');
  
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

document.getElementById('confirm-accept-btn').addEventListener('click', () => {
  document.getElementById('custom-confirm').classList.add('hidden');
  if (pendingConfirmResolve) pendingConfirmResolve(true);
});

document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
  document.getElementById('custom-confirm').classList.add('hidden');
  if (pendingConfirmResolve) pendingConfirmResolve(false);
});

function initFABPosition() {
  const savedPos = localStorage.getItem('fluxi_fab_pos') || 'center';
  setFabPosition(savedPos);
}

function setFabPosition(position) {
  const fab = document.getElementById('fab-container');
  fab.classList.remove('left-6', 'right-6', 'left-1/2', '-translate-x-1/2');
  
  if (position === 'left') {
    fab.classList.add('left-6');
  } else if (position === 'right') {
    fab.classList.add('right-6');
  } else {
    fab.classList.add('left-1/2', '-translate-x-1/2');
  }

  localStorage.setItem('fluxi_fab_pos', position);
}

function switchTab(tabId) {
  if (tabId === currentTab) return;
  history.pushState({ tab: tabId, openModals: [...openModals] }, '');
  execSwitchTab(tabId);
}

function execSwitchTab(tabId) {
  ['dashboard', 'movimientos', 'cuentas', 'ajustes'].forEach(id => {
    document.getElementById(`view-${id}`).classList.add('hidden');
    document.getElementById(`tab-${id}`).classList.replace('text-emerald-400', 'text-slate-500');
  });
  document.getElementById(`view-${tabId}`).classList.remove('hidden');
  document.getElementById(`tab-${tabId}`).classList.replace('text-slate-500', 'text-emerald-400');
  currentTab = tabId;
  if (tabId === 'movimientos') renderizarHistorialMovimientos();
}

function triggerOpenModal(modalId) {
  execOpenModal(modalId);
  openModals.push(modalId);
  history.pushState({ tab: currentTab, openModals: [...openModals] }, '');
}

function triggerCloseModal(modalId) { history.back(); }

function execOpenModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('hidden');
  setTimeout(() => { modal.classList.replace('modal-hidden', 'modal-visible'); }, 10);
}

function execCloseModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.replace('modal-visible', 'modal-hidden');
  setTimeout(() => modal.classList.add('hidden'), 250);
}

function toggleDesgloseNeto() {
  desgloseAbierto = !desgloseAbierto;
  const comp = document.getElementById("desglose-compartment");
  const icon = document.getElementById("desglose-icon");
  if (desgloseAbierto) {
    comp.style.maxHeight = "500px"; 
    comp.style.opacity = "1"; 
    comp.style.marginTop = "16px";
    icon.style.transform = "rotate(180deg)";
    calcularDesglose();
  } else {
    comp.style.maxHeight = "0"; 
    comp.style.opacity = "0"; 
    comp.style.marginTop = "0";
    icon.style.transform = "rotate(0deg)";
  }
}

function calcularDesglose() {
  let actCLP = 0, actUSD = 0, deuCLP = 0, deuUSD = 0;
  let dValor = Number(dashboardGlobal["Valor_Dolar"]) || 950; 
  cuentasGlobales.forEach(c => {
    let val = Number(c.Saldo_Actual) || 0;
    if (c.Tipo === 'Credito') { 
      c.Moneda === 'USD' ? deuUSD += Math.abs(val) : deuCLP += Math.abs(val); 
    } else { 
      c.Moneda === 'USD' ? actUSD += val : actCLP += val; 
    }
  });
  document.getElementById("desgloseActivosCLP").innerText = formatMoneda(actCLP);
  document.getElementById("desgloseActivosUSD").innerText = `${formatMoneda(actUSD, 'USD')} (${formatMoneda(actUSD * dValor)})`;
  document.getElementById("desgloseDeudasCLP").innerText = formatMoneda(deuCLP);
  document.getElementById("desgloseDeudasUSD").innerText = `${formatMoneda(deuUSD, 'USD')} (${formatMoneda(deuUSD * dValor)})`;
  document.getElementById("desgloseDolarValor").innerText = `$${dValor} CLP`;
}

async function forzarSincronizacion() {
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando`;
  document.getElementById("api-error-banner").classList.add("hidden");

  let errorCarga = false;
  let msgError = '';
  try {
    const d = await llamarAPI({ action: "getAll" });
    aplicarTodo(d);
    try { localStorage.setItem('fluxi_cache', JSON.stringify(d)); } catch (e) {}
  } catch (e) {
    errorCarga = true;
    msgError = e.message;
    console.error(e);
  }

  if (errorCarga) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-500"></i> Parcial`;
    document.getElementById("api-error-banner").classList.remove("hidden");
    showToast(msgError || "Sincronización incompleta. Revisa la red.", "warning");
  } else {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-wifi"></i> En línea`;
    document.getElementById("api-error-banner").classList.add("hidden");
    procesarAlertasInteligentes();
  }
}

function aplicarTodo(d) {
  aplicarDashboard(d.dashboard || {});
  aplicarCuentas(d.cuentas);          // antes que movimientos (el historial usa los nombres)
  aplicarCategorias(d.categorias);
  aplicarMovimientos(d.movimientos);
}

function aplicarDashboard(data) {
  dashboardGlobal = data;
  document.getElementById("dashNeto").innerText = formatMoneda(data.Saldo_Neto_Real);
  document.getElementById("dashDeudaCLP").innerText = formatMoneda(data.Deuda_TC_CLP);
  document.getElementById("dashDeudaUSD").innerText = formatMoneda(data.Deuda_TC_USD, 'USD');
}

function aplicarCuentas(cuentas) {
  cuentasGlobales = Array.isArray(cuentas) ? cuentas : [];
  
  const selMov = document.getElementById("movCuenta");
  const selDestino = document.getElementById("movCuentaDestino");
  const filCta = document.getElementById("filtroCuenta");
  
  selMov.innerHTML = ""; 
  selDestino.innerHTML = "";
  filCta.innerHTML = `<option value="">Todas las Cuentas</option>`;
  
  const list = document.getElementById("lista-cuentas");
  list.innerHTML = "";
  
  cuentasGlobales.forEach(c => {
    selMov.innerHTML += `<option value="${esc(c.ID_Cuenta)}">${esc(c.Nombre)}</option>`;
    selDestino.innerHTML += `<option value="${esc(c.ID_Cuenta)}">${esc(c.Nombre)}</option>`;
    filCta.innerHTML += `<option value="${esc(c.ID_Cuenta)}">${esc(c.Nombre)}</option>`;
    
    const isTC = c.Tipo === 'Credito';
    const colorSaldo = c.Saldo_Actual < 0 ? 'text-rose-400' : 'text-emerald-400';
    const icon = isTC ? 'fa-credit-card' : 'fa-building-columns';
    const badgeColor = isTC ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';

    list.innerHTML += `
      <div class="bg-slate-900 p-4 rounded-2xl flex justify-between border border-slate-850 shadow-lg">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-300">
            <i class="fa-solid ${icon} text-sm"></i>
          </div>
          <div>
            <h3 class="font-extrabold text-sm text-white">${esc(c.Nombre)}</h3>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${badgeColor}">${esc(c.Tipo)}</span>
          </div>
        </div>
        <div class="text-right">
          <span class="block text-sm font-black ${colorSaldo}">${formatMoneda(c.Saldo_Actual, c.Moneda)}</span>
          <span class="text-[9px] text-slate-500 uppercase font-semibold">Balance</span>
        </div>
      </div>`;
  });
}

function aplicarMovimientos(movs) {
  movimientosGlobales = Array.isArray(movs) ? movs : [];
  if (currentTab === 'movimientos') renderizarHistorialMovimientos();
  try { renderizarGrafico(movimientosGlobales); } catch (e) { console.warn("Gráfico no disponible", e); }
}

function aplicarCategorias(cat) {
  cat = Array.isArray(cat) ? cat : [];
  categoriasGlobales = cat;
  
  const sMov = document.getElementById("movCat");
  const sFil = document.getElementById("filtroCategoria");
  const lAdm = document.getElementById("lista-categorias-admin");
  
  sMov.innerHTML = ""; 
  sFil.innerHTML = `<option value="">Todas las Categorías</option>`; 
  lAdm.innerHTML = "";
  
  cat.forEach(c => {
    sMov.innerHTML += `<option value="${esc(c)}">${esc(c)}</option>`;
    sFil.innerHTML += `<option value="${esc(c)}">${esc(c)}</option>`;
    
    const isDefault = DEFAULT_CATEGORIES.includes(c);
    lAdm.innerHTML += `
      <div class="flex justify-between p-3 bg-slate-900 rounded-xl border border-slate-800 text-sm font-bold items-center">
        <span>${esc(c)}</span>
        ${isDefault ? 
          `<span class="text-[8px] bg-slate-950 text-slate-500 border border-slate-850 px-2 py-1 rounded">Sistema</span>` : 
          `<button data-nombre="${esc(c)}" onclick="eliminarCategoriaDrive(this.dataset.nombre)" class="text-rose-400 p-1 hover:bg-rose-500/10 rounded transition"><i class="fa-solid fa-trash text-xs"></i></button>`
        }
      </div>`;
  });
}

let enviando = false;
async function enviarAGoogle(payload) {
  if (enviando) throw new Error("Operación en curso");
  if (!navigator.onLine) {
    showToast("Sin conexión. Conéctate a internet para poder operar.", "error");
    throw new Error("Offline");
  }
  enviando = true;
  try {
    await llamarAPI(payload);
    showToast("Sincronizado con Drive", "success");
  } catch (err) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-400"></i> Error`;
    showToast("Error de Sincronización: " + err.message, "error");
    throw err;
  } finally {
    enviando = false;
  }
}

document.getElementById("movForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando`;
  
  const partesF = document.getElementById("movFecha").value.split("-");
  const fechaCl = `${partesF[2]}/${partesF[1]}/${partesF[0]}`;
  const idEdit = document.getElementById("editingId").value;
  const tipo = document.getElementById("movTipo").value;
  
  let desc = document.getElementById("movDesc").value;
  const cuotas = Number(document.getElementById("movCuotas").value) || 1;
  if (cuotas > 1 && !esEdicion() && tipo === 'Egreso') {
    desc += ` (En ${cuotas} cuotas)`;
  }

  const payload = {
    action: idEdit ? "editMovimiento" : "addMovimiento",
    ID_Mov: idEdit || Date.now(),
    Fecha: fechaCl,
    Descripcion: desc,
    Cuenta_Origen: document.getElementById("movCuenta").value,
    Cuenta_Destino: tipo === "Transferencia" ? document.getElementById("movCuentaDestino").value : "",
    Categoria: tipo === "Transferencia" ? "Transferencia" : document.getElementById("movCat").value,
    Tipo_Mov: tipo,
    Monto: Number(document.getElementById("movMonto").value),
    Moneda: document.getElementById("movMoneda").value,
    Frecuencia: document.getElementById("movFrecuencia").value,
    Cuotas: tipo === 'Egreso' ? cuotas : 1
  };

  try {
    await enviarAGoogle(payload);
    triggerCloseModal('modal-movimiento');
    
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-calculator fa-bounce"></i> Recalculando...`;
    forzarSincronizacion();
  } catch (e) {}
});

function esEdicion() {
  return document.getElementById("editingId").value !== "";
}

function renderizarHistorialMovimientos() {
  const lista = document.getElementById("lista-movimientos");
  const fTxt = document.getElementById("filtroTexto").value.toLowerCase();
  const fCat = document.getElementById("filtroCategoria").value;
  const fCta = document.getElementById("filtroCuenta").value;
  const fMes = document.getElementById("filtroMes").value;
  
  let filtrados = movimientosGlobales.filter(m => {
    const matchCat = !fCat || m.Categoria === fCat;
    const matchCta = !fCta || m.Cuenta_Origen === fCta || m.Cuenta_Destino === fCta;
    const matchTxt = !fTxt || 
                     String(m.Descripcion ?? '').toLowerCase().includes(fTxt) || 
                     String(m.Monto).includes(fTxt) || 
                     String(m.Categoria ?? '').toLowerCase().includes(fTxt);
                     
    let matchMes = true;
    if (fMes && m.Fecha) {
      const partesF = String(m.Fecha).split("/");
      if (partesF.length === 3) {
        const mesMov = `${partesF[2]}-${partesF[1].padStart(2, '0')}`;
        matchMes = mesMov === fMes;
      }
    }
    return matchCat && matchCta && matchTxt && matchMes;
  });
  
  document.getElementById("historial-total").innerText = `${filtrados.length} txns`;
  lista.innerHTML = "";

  if (filtrados.length === 0) {
    lista.innerHTML = `
      <div class="text-center py-12 bg-slate-900 rounded-2xl border border-slate-850">
        <i class="fa-solid fa-receipt text-slate-700 text-3xl mb-2"></i>
        <p class="text-xs text-slate-500 font-bold">No se encontraron movimientos</p>
      </div>`;
    return;
  }

  filtrados.forEach(m => {
    const esIngreso = m.Tipo_Mov === 'Ingreso';
    const esTrsf = m.Tipo_Mov === 'Transferencia';
    const color = esIngreso ? 'text-emerald-400' : (esTrsf ? 'text-blue-400' : 'text-rose-400');
    const ctaNombre = cuentasGlobales.find(c => c.ID_Cuenta === m.Cuenta_Origen)?.Nombre || m.Cuenta_Origen || "Billetera";
    
    let detalleCuenta = esc(ctaNombre);
    if (esTrsf) {
      const ctaDestNombre = cuentasGlobales.find(c => c.ID_Cuenta === m.Cuenta_Destino)?.Nombre || m.Cuenta_Destino || "Destino";
      detalleCuenta = `${esc(ctaNombre)} <i class="fa-solid fa-arrow-right text-[8px] text-slate-500 mx-1"></i> ${esc(ctaDestNombre)}`;
    }

    lista.innerHTML += `
    <div class="bg-slate-900 p-4 rounded-2xl border border-slate-850 flex justify-between items-center shadow">
       <div class="flex-1 min-w-0 pr-2">
         <span class="text-[9px] text-slate-500 font-extrabold uppercase block">${esc(m.Fecha)} • ${detalleCuenta}</span>
         <h4 class="font-extrabold text-sm truncate text-slate-100">${esc(m.Descripcion)}</h4>
         <span class="inline-block text-[9px] bg-slate-950 border border-slate-850 text-slate-400 px-2 py-0.5 rounded-md uppercase font-bold mt-1">${esc(m.Categoria)}</span>
       </div>
       <div class="text-right flex flex-col items-end gap-1.5 shrink-0">
         <span class="text-sm font-black ${color}">${esIngreso ? '+':'-'} ${formatMoneda(m.Monto, m.Moneda)}</span>
         <div class="flex gap-1">
           <button data-id="${esc(m.ID_Mov)}" onclick="editarMovimientoUI(this.dataset.id)" class="text-[10px] bg-slate-950 border border-slate-800 text-slate-400 px-2 py-1.5 rounded-lg hover:text-emerald-400 hover:bg-emerald-500/10 transition"><i class="fa-solid fa-pencil"></i></button>
           <button data-id="${esc(m.ID_Mov)}" onclick="eliminarMovimientoDrive(this.dataset.id)" class="text-[10px] bg-slate-950 border border-slate-800 text-slate-400 px-2 py-1.5 rounded-lg hover:text-rose-400 hover:bg-rose-500/10 transition"><i class="fa-solid fa-trash"></i></button>
         </div>
       </div>
    </div>`;
  });
}

function filtrarMovimientos() { renderizarHistorialMovimientos(); }

function editarMovimientoUI(idMov) {
  const mov = movimientosGlobales.find(m => String(m.ID_Mov) === String(idMov));
  if (!mov) return;

  document.getElementById("movimiento-modal-title").innerText = "Editar Movimiento";
  document.getElementById("movForm-submit-btn").innerText = "Guardar Cambios";
  document.getElementById("editingId").value = mov.ID_Mov;
  
  document.getElementById("contenedor-importador-notif").classList.add("hidden");

  setTipoMov(mov.Tipo_Mov);
  document.getElementById("movMonto").value = mov.Monto;
  
  let descLimpia = String(mov.Descripcion ?? '');
  if (descLimpia.includes(" (En ")) {
    descLimpia = descLimpia.substring(0, descLimpia.indexOf(" (En "));
  }
  document.getElementById("movDesc").value = descLimpia;

  const partes = mov.Fecha.split("/");
  if (partes.length === 3) {
    document.getElementById("movFecha").value = `${partes[2]}-${partes[1]}-${partes[0]}`;
  }

  document.getElementById("movFrecuencia").value = mov.Frecuencia || "Unica vez";
  document.getElementById("movCuenta").value = mov.Cuenta_Origen;
  if (mov.Tipo_Mov === 'Transferencia') {
    document.getElementById("movCuentaDestino").value = mov.Cuenta_Destino || "";
  }
  document.getElementById("movMoneda").value = mov.Moneda || "CLP";
  document.getElementById("movCat").value = mov.Categoria;
  document.getElementById("movCuotas").value = mov.Cuotas || 1;

  verificarTipoCuenta();
  triggerOpenModal('modal-movimiento');
}

async function eliminarMovimientoDrive(id) {
  const confirmacion = await showConfirm("¿Eliminar movimiento?", "Esta acción removerá el registro permanentemente de tu Drive.");
  if (!confirmacion) return;

  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Eliminando`;
  try {
    await enviarAGoogle({ action: "deleteMovimiento", ID_Mov: id });
    forzarSincronizacion();
  } catch (e) {}
}

document.getElementById("cuentaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registrando`;
  const tipo = document.getElementById("accType").value;
  const cupo = Number(document.getElementById("accLimit").value) || 0;
  const payload = {
    action: "addCuenta",
    ID_Cuenta: "CTA_" + Date.now(),
    Nombre: document.getElementById("accName").value,
    Tipo: tipo,
    Cupo_Total: tipo === 'Credito' ? cupo : 0,
    Moneda: document.getElementById("accCurrency").value,
    Dia_Corte: 20,
    Dia_Pago: 5,
    Saldo_Inicial: tipo === 'Credito' ? 0 : cupo
  };
  try {
    await enviarAGoogle(payload);
    triggerCloseModal('modal-cuenta');
    forzarSincronizacion();
  } catch(e) {}
});

function abrirModalNuevoMovimiento() {
  document.getElementById("movimiento-modal-title").innerText = "Nuevo Movimiento";
  document.getElementById("movForm-submit-btn").innerText = "Confirmar Transacción";
  document.getElementById("editingId").value = "";
  document.getElementById("movForm").reset();
  document.getElementById("contenedor-importador-notif").classList.remove("hidden");
  setTipoMov('Egreso');
  inicializarFechaHoy();
  verificarTipoCuenta();
  triggerOpenModal('modal-movimiento');
}

function verificarTipoCuenta() {
  const selectCta = document.getElementById("movCuenta");
  const ctaId = selectCta.value;
  const ctaElegida = cuentasGlobales.find(c => c.ID_Cuenta === ctaId);
  const seccionCuotas = document.getElementById("seccion-cuotas");
  const tipo = document.getElementById("movTipo").value;
  
  if (ctaElegida && ctaElegida.Tipo === 'Credito' && tipo === 'Egreso') {
    seccionCuotas.classList.remove("hidden");
    actualizarCalculoCuota();
  } else {
    seccionCuotas.classList.add("hidden");
    document.getElementById("movCuotas").value = "1";
  }
}

function actualizarCalculoCuota() {
  const monto = Number(document.getElementById("movMonto").value) || 0;
  const cuotas = Number(document.getElementById("movCuotas").value) || 1;
  const calculoDiv = document.getElementById("calculo-cuota");
  
  if (monto > 0 && cuotas > 1) {
    const costoMensual = Math.round(monto / cuotas);
    calculoDiv.innerText = `${formatMoneda(costoMensual)} / mes`;
  } else {
    calculoDiv.innerText = "$0 / mes";
  }
}

async function agregarNuevaCategoriaDrive() {
  const input = document.getElementById("catNuevaNombre");
  const nombre = input.value.trim();
  if (!nombre) return;

  if (categoriasGlobales.map(c => c.toLowerCase()).includes(nombre.toLowerCase())) {
    input.value = ""; 
    showToast("Esa categoría ya existe", "warning");
    return;
  }
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando`;
  try {
    await enviarAGoogle({ action: "addCategoria", Nombre: nombre });
    input.value = "";
    forzarSincronizacion();
  } catch(e) {}
}

async function eliminarCategoriaDrive(nombre) {
  const confirmacion = await showConfirm("¿Eliminar categoría?", `¿Eliminar "${nombre}" de tu Drive?`);
  if (!confirmacion) return;

  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Eliminando`;
  try {
    await enviarAGoogle({ action: "deleteCategoria", Nombre: nombre });
    forzarSincronizacion();
  } catch(e) {}
}

function renderizarGrafico(movimientos) {
  const canvasEl = document.getElementById('chartFinanzas');
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const nombresMeses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const hoy = new Date();
  let labels = [];
  let ingresosMes = [0, 0, 0, 0, 0, 0];
  let egresosMes = [0, 0, 0, 0, 0, 0];

  for (let i = 5; i >= 0; i--) {
    let d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    labels.push({
      texto: nombresMeses[d.getMonth()] + " " + String(d.getFullYear()).slice(-2),
      mes: d.getMonth(),
      anio: d.getFullYear()
    });
  }

  movimientos.forEach(m => {
    if (!m.Fecha || !m.Monto) return;
    const partes = String(m.Fecha).split("/");
    if (partes.length < 3) return;
    const mesMov = parseInt(partes[1], 10) - 1;
    const anioMov = parseInt(partes[2], 10);
    const monto = Number(m.Monto);

    labels.forEach((l, idx) => {
      if (l.mes === mesMov && l.anio === anioMov) {
        if (m.Tipo_Mov === "Ingreso") ingresosMes[idx] += monto;
        else if (m.Tipo_Mov === "Egreso") egresosMes[idx] += monto;
      }
    });
  });

  if (miGrafico) miGrafico.destroy();

  miGrafico = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map(l => l.texto),
      datasets: [
        {
          label: 'Ingresos',
          data: ingresosMes,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.04)',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 2
        },
        {
          label: 'Gastos',
          data: egresosMes,
          borderColor: '#f87171',
          backgroundColor: 'rgba(248, 113, 113, 0.02)',
          borderWidth: 1.5,
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } },
        y: { grid: { color: 'rgba(51, 65, 85, 0.15)' }, ticks: { color: '#64748b', font: { size: 8 } } }
      }
    }
  });

  // GRÁFICO DOUGHNUT CATEGORÍAS (MES ACTUAL)
  const canvasCat = document.getElementById('chartCategorias');
  if (!canvasCat) return;
  const ctxCat = canvasCat.getContext('2d');
  
  let gastosPorCat = {};
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  movimientos.forEach(m => {
    if (m.Tipo_Mov !== "Egreso" || !m.Fecha || !m.Monto) return;
    const partes = String(m.Fecha).split("/");
    if (partes.length < 3) return;
    
    if (parseInt(partes[1], 10) - 1 === mesActual && parseInt(partes[2], 10) === anioActual) {
      gastosPorCat[m.Categoria] = (gastosPorCat[m.Categoria] || 0) + Number(m.Monto);
    }
  });

  if (miGraficoCategorias) miGraficoCategorias.destroy();

  miGraficoCategorias = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: Object.keys(gastosPorCat),
      datasets: [{
        data: Object.values(gastosPorCat),
        backgroundColor: ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#94a3b8', '#ec4899', '#14b8a6'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { 
          position: 'right', 
          labels: { color: '#94a3b8', font: { size: 9 }, boxWidth: 10, padding: 15 } 
        }
      }
    }
  });
}

function procesarAlertasInteligentes() {
  const panel = document.getElementById("panel-alertas");
  panel.innerHTML = "";
  let alertasGeneradas = [];

  if (dashboardGlobal["Saldo_Neto_Real"] !== undefined) {
    const saldoNeto = Number(dashboardGlobal["Saldo_Neto_Real"]) || 0;
    if (saldoNeto < 50000) { // incluye saldo negativo
      alertasGeneradas.push({
        tipo: "error", icon: "fa-triangle-exclamation", titulo: "Liquidez Crítica",
        desc: `Tu Saldo Neto es de solo ${formatMoneda(saldoNeto)}. Posiciona prioridades de gasto.`
      });
    }
  }

  cuentasGlobales.forEach(cta => {
    if (cta.Tipo === 'Credito') {
      const cupoTotal = Number(cta.Cupo_Total) || 0;
      const deudAbsoluta = Math.abs(Number(cta.Saldo_Actual) || 0);
      
      if (cupoTotal > 0 && (deudAbsoluta / cupoTotal) > 0.65) {
        const pct = Math.round((deudAbsoluta / cupoTotal) * 100);
        alertasGeneradas.push({
          tipo: "warning", icon: "fa-shield-halved", titulo: `Cupo de ${esc(cta.Nombre)} comprometido`,
          desc: `Has utilizado un ${pct}% de tu cupo. Considera limitar deudas de cuotas.`
        });
      }
    }
  });

  if (alertasGeneradas.length === 0) {
    panel.innerHTML = `
      <div class="p-4 bg-slate-900 rounded-2xl border border-slate-850 text-center text-xs text-slate-400">
        <i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i> Salud de billetera en parámetros estables.
      </div>`;
  } else {
    alertasGeneradas.forEach(a => {
      let bg = a.tipo === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400';
      panel.innerHTML += `
        <div class="p-4 rounded-2xl border flex gap-3.5 shadow-sm ${bg}">
          <div class="text-lg"><i class="fa-solid ${a.icon}"></i></div>
          <div class="flex-1">
            <h4 class="font-extrabold text-sm text-slate-100">${a.titulo}</h4>
            <p class="text-[11px] text-slate-400 mt-0.5 leading-relaxed">${a.desc}</p>
          </div>
        </div>`;
    });
  }
}

function procesarNotificacionPegada() {
  const texto = document.getElementById("importText").value;
  if (!texto.trim()) return;

  const regexMonto = /(?:\$|CLP)?\s?(\d{1,3}(?:\.\d{3})+|\d+)/;
  const matchMonto = texto.match(regexMonto);
  
  if (matchMonto) {
    const numeroLimpio = matchMonto[1].replace(/\./g, "");
    document.getElementById("movMonto").value = numeroLimpio;
  }

  let descripcionExtraida = "Movimiento Importado";
  const textoBajo = texto.toLowerCase();

  const patronesComercio = [
    /en\s+([A-Za-z0-9\s_]+?)(?:\s+con|\s+el|\s+por|\s+monto|\.|$)/,
    /a\s+([A-Za-z0-9\s_]+?)(?:\s+con|\s+el|\s+por|\s+monto|\.|$)/,
    /de\s+([A-Za-z0-9\s_]+?)(?:\s+con|\s+el|\s+por|\s+monto|\.|$)/
  ];

  for (let regex of patronesComercio) {
    const match = texto.match(regex);
    if (match && match[1]) {
      descripcionExtraida = match[1].trim();
      break;
    }
  }

  if (descripcionExtraida === "Movimiento Importado" && texto.length < 40) {
    descripcionExtraida = texto;
  }

  document.getElementById("movDesc").value = descripcionExtraida;

  const categoriasMap = {
    "Alimentación": ["lider", "jumbo", "unimarc", "tottus", "uber eats", "pedidosya", "restaurante", "mcdonald", "starbucks", "comida", "supermercado"],
    "Transporte": ["uber", "cabify", "didi", "metro", "bip", "copec", "shell", "petrobras", "bencina", "peaje"],
    "Cuentas Fijas": ["vtr", "movistar", "entel", "enel", "aguas", "gasco", "netflix", "spotify", "gimnasio", "suscripcion", "condominio"],
    "Ocio": ["cine", "cineplanet", "cinemark", "pub", "bar", "playstation", "steam", "falabella", "ripley", "paris", "aliexpress", "shein"],
    "Salud": ["farmacia", "cruz verde", "ahumada", "salcobrand", "clinica", "medico", "dentista"]
  };

  let categoriaDetectada = "Otros";
  for (let [cat, palabras] of Object.entries(categoriasMap)) {
    if (palabras.some(p => textoBajo.includes(p))) {
      categoriaDetectada = cat;
      break;
    }
  }
  document.getElementById("movCat").value = categoriaDetectada;

  if (cuentasGlobales.length > 0) {
    const cuentaMatch = cuentasGlobales.find(cta => 
      textoBajo.includes(cta.Nombre.toLowerCase()) || 
      (cta.Tipo === 'Credito' && (textoBajo.includes("credito") || textoBajo.includes("tc") || textoBajo.includes("tarjeta")))
    );
    if (cuentaMatch) {
      document.getElementById("movCuenta").value = cuentaMatch.ID_Cuenta;
      verificarTipoCuenta();
    }
  }

  document.getElementById("importText").value = "";
  showToast("Autocompletado con éxito. Revisa el formulario.", "success");
}

function setTipoMov(tipo) {
  document.getElementById('movTipo').value = tipo;
  
  const lblOrigen = document.getElementById('lbl-mov-cuenta');
  const secDestino = document.getElementById('seccion-cuenta-destino');
  const secCategoria = document.getElementById('seccion-categoria');
  const secCuotas = document.getElementById('seccion-cuotas');

  ['btn-egreso', 'btn-ingreso', 'btn-transfer'].forEach(id => {
    document.getElementById(id).className = "flex-1 py-2 text-xs font-bold text-slate-400 rounded-md transition-all";
  });
  const activeBtn = tipo === 'Egreso' ? 'btn-egreso' : (tipo === 'Ingreso' ? 'btn-ingreso' : 'btn-transfer');
  document.getElementById(activeBtn).className = "flex-1 py-2 text-xs font-bold bg-slate-800 text-white rounded-md shadow border border-slate-700/60";

  if (tipo === "Transferencia") {
    lblOrigen.innerText = "Billetera Origen";
    secDestino.classList.remove("hidden");
    secCategoria.classList.add("hidden");
    secCuotas.classList.add("hidden");
  } else {
    lblOrigen.innerText = "Billetera / Cuenta";
    secDestino.classList.add("hidden");
    secCategoria.classList.remove("hidden");
    verificarTipoCuenta();
  }
}

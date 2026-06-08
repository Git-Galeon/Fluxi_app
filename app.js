// ============================================
// FLUXI APP v1.5.5 - Mejorado con Desacoplamiento de API
// ============================================

let API_URL = "";
let TOKEN = "";
let lastSyncTime = null;

// Iniciar PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => console.log("PWA Ready"));
}

// Variables Globales
let currentTab = 'dashboard';
let openModals = [];
let cuentasGlobales = [];
let movimientosGlobales = [];
let categoriasGlobales = [];
let dashboardGlobal = {};
let desgloseAbierto = false;
let miGrafico = null;

const DEFAULT_CATEGORIES = [
  "Alimentación", "Transporte", "Cuentas Fijas", "Ocio", "Salud", "Ahorro", "Otros"
];

const formatMoneda = (valor) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(valor || 0);

// ============================================
// INICIALIZACIÓN Y CARGA DE CONFIGURACIÓN
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  // Cargar configuración de localStorage
  cargarConfiguracionAPI();
  
  // Si no hay API configurada, mostrar modal de login
  if (!API_URL) {
    triggerOpenModal('modal-login');
  } else {
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
    forzarSincronizacion();

    document.getElementById("movMonto").addEventListener("input", actualizarCalculoCuota);
    document.getElementById("movCuotas").addEventListener("input", actualizarCalculoCuota);
  }
});

function cargarConfiguracionAPI() {
  API_URL = localStorage.getItem('fluxi_api_url') || "";
  TOKEN = localStorage.getItem('fluxi_token') || "";
}

function guardarConfiguracionAPI(url, token) {
  localStorage.setItem('fluxi_api_url', url);
  localStorage.setItem('fluxi_token', token);
  API_URL = url;
  TOKEN = token;
}

// ============================================
// SISTEMA DE NOTIFICACIONES TOAST
// ============================================

function mostrarToast(mensaje, tipo = 'info', duracion = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  
  const colorMap = {
    'success': 'bg-emerald-500',
    'error': 'bg-red-500',
    'warning': 'bg-amber-500',
    'info': 'bg-blue-500'
  };
  
  toast.className = `${colorMap[tipo]} text-white px-4 py-3 rounded-xl text-xs font-bold shadow-lg toast-slide-in`;
  toast.innerText = mensaje;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

// ============================================
// MODAL DE CONFIRMACIÓN GENÉRICA
// ============================================

let confirmCallback = null;

function mostrarConfirmacion(titulo, mensaje, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-title').innerText = titulo;
  document.getElementById('confirm-message').innerText = mensaje;
  document.getElementById('modal-confirm').classList.remove('hidden');
}

function cerrarConfirm(resultado) {
  document.getElementById('modal-confirm').classList.add('hidden');
  if (confirmCallback) confirmCallback(resultado);
  confirmCallback = null;
}

// ============================================
// POSICIÓN DEL FAB BOTÓN "+"
// ============================================

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
  
  ['left', 'center', 'right'].forEach(pos => {
    const btn = document.getElementById(`btn-fab-${pos}`);
    if (btn) {
      btn.className = "py-2.5 rounded-lg text-xs font-bold transition";
      if (pos === position) {
        btn.classList.add('bg-emerald-500', 'text-white', 'shadow-md');
      } else {
        btn.classList.add('text-slate-400', 'hover:text-white', 'bg-transparent');
      }
    }
  });
}

// ============================================
// NAVEGACIÓN SPA
// ============================================

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

// ============================================
// MODALES
// ============================================

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

// ============================================
// DESGLOSE SALDO NETO
// ============================================

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
  document.getElementById("desgloseActivosUSD").innerText = `US$ ${actUSD} (${formatMoneda(actUSD * dValor)})`;
  document.getElementById("desgloseDeudasCLP").innerText = formatMoneda(deuCLP);
  document.getElementById("desgloseDeudasUSD").innerText = `US$ ${deuUSD} (${formatMoneda(deuUSD * dValor)})`;
  document.getElementById("desgloseDolarValor").innerText = `$${dValor} CLP`;
}

// ============================================
// CARGA DE DATOS ASÍNCRONA RESILIENTE
// ============================================

async function forzarSincronizacion() {
  if (!navigator.onLine) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-wifi-slash text-red-400"></i> Sin conexión`;
    mostrarToast('Sin conexión a internet', 'warning');
    return;
  }

  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando`;
  document.getElementById("api-error-banner").classList.add("hidden");

  let errorCarga = false;

  try { await cargarDashboard(); } catch (e) { console.error("Fallo de Dashboard:", e); errorCarga = true; }
  try { await cargarCuentas(); } catch (e) { console.error("Fallo de Cuentas:", e); errorCarga = true; }
  try { await cargarCategoriasDrive(); } catch (e) { console.error("Fallo de Categorías:", e); }
  try { await cargarMovimientos(); } catch (e) { console.error("Fallo de Movimientos:", e); errorCarga = true; }

  lastSyncTime = new Date();

  if (errorCarga) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-500"></i> Parcial`;
    document.getElementById("api-error-banner").classList.remove("hidden");
    mostrarToast('Sincronización parcial - Revisa tu conexión', 'warning');
  } else {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-wifi"></i> En línea`;
    document.getElementById("api-error-banner").classList.add("hidden");
    mostrarToast('Sincronización completada', 'success', 2000);
  }
}

async function cargarDashboard() {
  const res = await fetch(`${API_URL}?action=getDashboard`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  dashboardGlobal = data;
  document.getElementById("dashNeto").innerText = formatMoneda(data.Saldo_Neto_Real);
  document.getElementById("dashDeudaCLP").innerText = formatMoneda(data.Deuda_TC_CLP);
  document.getElementById("dashDeudaUSD").innerText = "US$ " + (data.Deuda_TC_USD || 0);
}

async function cargarCuentas() {
  const res = await fetch(`${API_URL}?action=getCuentas`);
  cuentasGlobales = await res.json();
  
  const selMov = document.getElementById("movCuenta");
  const filCta = document.getElementById("filtroCuenta");
  selMov.innerHTML = ""; 
  filCta.innerHTML = `<option value="">Todas las Cuentas</option>`;
  
  const list = document.getElementById("lista-cuentas");
  list.innerHTML = "";
  
  cuentasGlobales.forEach(c => {
    selMov.innerHTML += `<option value="${c.ID_Cuenta}">${c.Nombre}</option>`;
    filCta.innerHTML += `<option value="${c.ID_Cuenta}">${c.Nombre}</option>`;
    
    const isTC = c.Tipo === 'Credito';
    const colorSaldo = c.Saldo_Actual < 0 ? 'text-red-400' : 'text-emerald-400';
    const icon = isTC ? 'fa-credit-card' : 'fa-building-columns';
    const badgeColor = isTC ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400';

    list.innerHTML += `
      <div class="bg-slate-800/60 p-4 rounded-2xl flex justify-between border border-slate-700/40">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
            <i class="fa-solid ${icon} text-sm"></i>
          </div>
          <div>
            <h3 class="font-extrabold text-sm text-white">${c.Nombre}</h3>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${badgeColor}">${c.Tipo}</span>
          </div>
        </div>
        <div class="text-right">
          <span class="block text-sm font-black ${colorSaldo}">${c.Moneda === 'USD' ? 'US$' : ''}${formatMoneda(c.Saldo_Actual).replace('$', '')}</span>
          <span class="text-[9px] text-slate-500 uppercase font-semibold">Balance</span>
        </div>
      </div>`;
  });
}

async function cargarMovimientos() {
  const res = await fetch(`${API_URL}?action=getMovimientos`);
  movimientosGlobales = await res.json();
  if (currentTab === 'movimientos') renderizarHistorialMovimientos();
  renderizarGrafico(movimientosGlobales);
}

async function cargarCategoriasDrive() {
  const res = await fetch(`${API_URL}?action=getCategorias`);
  const cat = await res.json();
  categoriasGlobales = cat;
  
  const sMov = document.getElementById("movCat");
  const sFil = document.getElementById("filtroCategoria");
  const lAdm = document.getElementById("lista-categorias-admin");
  
  sMov.innerHTML = ""; 
  sFil.innerHTML = `<option value="">Todas las Categorías</option>`; 
  lAdm.innerHTML = "";
  
  cat.forEach(c => {
    sMov.innerHTML += `<option value="${c}">${c}</option>`;
    sFil.innerHTML += `<option value="${c}">${c}</option>`;
    
    const isDefault = DEFAULT_CATEGORIES.includes(c);
    lAdm.innerHTML += `
      <div class="flex justify-between p-3 bg-slate-800 rounded-xl border border-slate-700/40 text-sm font-bold items-center">
        <span>${c}</span>
        ${isDefault ? 
          `<span class="text-[8px] bg-slate-700 text-slate-400 px-2 py-1 rounded">Sistema</span>` : 
          `<button onclick="eliminarCategoriaDrive('${c}')" class="text-red-400"><i class="fa-solid fa-trash"></i></button>`
        }
      </div>`;
  });
}

// ============================================
// ENVÍO DE DATOS CON CORRECCIÓN CORS
// ============================================

async function enviarAGoogle(payload) {
  if (!navigator.onLine) { 
    mostrarToast('Sin conexión. Conéctate a internet para enviar esta transacción.', 'error');
    throw new Error("Offline"); 
  }
  
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-check"></i> Sincronizado`;
    mostrarToast('Transacción guardada exitosamente', 'success', 2000);
  } catch (err) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red-400"></i> Error`;
    mostrarToast('Error de Sincronización: ' + err.message, 'error');
    throw err;
  }
}

// ============================================
// FORMULARIO MOVIMIENTO
// ============================================

document.getElementById("movForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando`;
  
  const partesF = document.getElementById("movFecha").value.split("-");
  const fechaCl = `${partesF[2]}/${partesF[1]}/${partesF[0]}`;
  const idEdit = document.getElementById("editingId").value;
  
  let desc = document.getElementById("movDesc").value;
  const cuotas = Number(document.getElementById("movCuotas").value) || 1;
  if (cuotas > 1 && !esEdicion()) {
    desc += ` (En ${cuotas} cuotas)`;
  }

  const payload = {
    action: idEdit ? "editMovimiento" : "addMovimiento",
    secret_token: TOKEN,
    ID_Mov: idEdit || Date.now(),
    Fecha: fechaCl,
    Descripcion: desc,
    Cuenta_Origen: document.getElementById("movCuenta").value,
    Categoria: document.getElementById("movCat").value,
    Tipo_Mov: document.getElementById("movTipo").value,
    Monto: Number(document.getElementById("movMonto").value),
    Moneda: document.getElementById("movMoneda").value,
    Frecuencia: document.getElementById("movFrecuencia").value,
    Cuotas: cuotas
  };

  try {
    await enviarAGoogle(payload);
    triggerCloseModal('modal-movimiento');
    
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-calculator fa-bounce"></i> Recalculando...`;
    setTimeout(() => {
      forzarSincronizacion();
    }, 1800);
  } catch (e) {}
});

function esEdicion() {
  return document.getElementById("editingId").value !== "";
}

// ============================================
// HISTORIAL DE MOVIMIENTOS
// ============================================

function renderizarHistorialMovimientos() {
  const lista = document.getElementById("lista-movimientos");
  const fTxt = document.getElementById("filtroTexto").value.toLowerCase();
  const fCat = document.getElementById("filtroCategoria").value;
  const fCta = document.getElementById("filtroCuenta").value;
  
  let filtrados = movimientosGlobales.filter(m => {
    const matchCat = !fCat || m.Categoria === fCat;
    const matchCta = !fCta || m.Cuenta_Origen === fCta;
    const matchTxt = !fTxt || 
                     m.Descripcion.toLowerCase().includes(fTxt) || 
                     String(m.Monto).includes(fTxt) || 
                     m.Categoria.toLowerCase().includes(fTxt);
    return matchCat && matchCta && matchTxt;
  });
  
  document.getElementById("historial-total").innerText = `${filtrados.length} txns`;
  lista.innerHTML = "";

  if (filtrados.length === 0) {
    lista.innerHTML = `
      <div class="text-center py-12 bg-slate-800/20 rounded-2xl border border-slate-800/40">
        <i class="fa-solid fa-receipt text-slate-600 text-3xl mb-2"></i>
        <p class="text-xs text-slate-500 font-bold">No se encontraron movimientos</p>
      </div>`;
    return;
  }

  filtrados.forEach(m => {
    const esIngreso = m.Tipo_Mov === 'Ingreso';
    const esTrsf = m.Tipo_Mov === 'Transferencia';
    const color = esIngreso ? 'text-emerald-400' : (esTrsf ? 'text-blue-400' : 'text-rose-400');
    const ctaNombre = cuentasGlobales.find(c => c.ID_Cuenta === m.Cuenta_Origen)?.Nombre || m.Cuenta_Origen || "Billetera";

    lista.innerHTML += `
    <div class="bg-slate-800/60 p-4 rounded-2xl border border-slate-700/35 flex justify-between items-center">
       <div class="flex-1 min-w-0 pr-2">
         <span class="text-[9px] text-slate-500 font-extrabold uppercase block">${m.Fecha} • ${ctaNombre}</span>
         <h4 class="font-extrabold text-sm truncate text-slate-100">${m.Descripcion}</h4>
         <span class="inline-block text-[9px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded-md uppercase font-bold mt-1">${m.Categoria}</span>
       </div>
       <div class="text-right flex flex-col items-end gap-1.5 shrink-0">
         <span class="text-sm font-black ${color}">${esIngreso ? '+':'-'} ${m.Moneda==='USD'?'US$':''}${formatMoneda(m.Monto).replace('$','')}</span>
         <div class="flex gap-1">
           <button onclick="editarMovimientoUI('${m.ID_Mov}')" class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-md"><i class="fa-solid fa-pencil"></i></button>
           <button onclick="eliminarMovimientoDrive('${m.ID_Mov}')" class="text-[10px] bg-rose-500/10 text-rose-400 px-2 py-1 rounded-md"><i class="fa-solid fa-trash"></i></button>
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
  
  let descLimpia = mov.Descripcion;
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
  document.getElementById("movMoneda").value = mov.Moneda || "CLP";
  document.getElementById("movCat").value = mov.Categoria;
  document.getElementById("movCuotas").value = mov.Cuotas || 1;

  verificarTipoCuenta();
  triggerOpenModal('modal-movimiento');
}

async function eliminarMovimientoDrive(id) {
  mostrarConfirmacion(
    "Eliminar Movimiento",
    "¿Deseas eliminar permanentemente este movimiento de tu Google Sheets?",
    async (resultado) => {
      if (!resultado) return;
      
      document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Eliminando`;
      try {
        await enviarAGoogle({ action: "deleteMovimiento", secret_token: TOKEN, ID_Mov: id });
        setTimeout(() => { forzarSincronizacion(); }, 1500);
      } catch (e) {}
    }
  );
}

// ============================================
// NUEVA CUENTA
// ============================================

document.getElementById("cuentaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registrando`;
  const tipo = document.getElementById("accType").value;
  const cupo = Number(document.getElementById("accLimit").value) || 0;
  const payload = {
    action: "addCuenta",
    secret_token: TOKEN,
    ID_Cuenta: "CTA_" + Date.now(),
    Nombre: document.getElementById("accName").value,
    Tipo: tipo,
    Cupo_Total: tipo === 'Credito' ? cupo : 0,
    Moneda: "CLP",
    Dia_Corte: 20,
    Dia_Pago: 5,
    Saldo_Inicial: tipo === 'Credito' ? 0 : cupo
  };
  try {
    await enviarAGoogle(payload);
    triggerCloseModal('modal-cuenta');
    setTimeout(() => { forzarSincronizacion(); }, 1500);
  } catch(e) {}
});

// ============================================
// NUEVO MOVIMIENTO
// ============================================

function abrirModalNuevoMovimiento() {
  document.getElementById("movimiento-modal-title").innerText = "Nuevo Movimiento";
  document.getElementById("movForm-submit-btn").innerText = "Confirmar Transacción";
  document.getElementById("editingId").value = "";
  document.getElementById("movForm").reset();
  document.getElementById("contenedor-importador-notif").classList.remove("hidden");
  inicializarFechaHoy();
  verificarTipoCuenta();
  triggerOpenModal('modal-movimiento');
}

// ============================================
// DETECTORES DE TC / CUOTAS
// ============================================

function verificarTipoCuenta() {
  const selectCta = document.getElementById("movCuenta");
  const ctaId = selectCta.value;
  const ctaElegida = cuentasGlobales.find(c => c.ID_Cuenta === ctaId);
  const seccionCuotas = document.getElementById("seccion-cuotas");
  
  if (ctaElegida && ctaElegida.Tipo === 'Credito') {
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
    const montoPorCuota = Math.round(monto / cuotas);
    calculoDiv.innerText = `${formatMoneda(montoPorCuota)} / mes`;
  } else {
    calculoDiv.innerText = '$0 / mes';
  }
}

// ============================================
// UTILIDADES
// ============================================

function inicializarFechaHoy() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  document.getElementById("movFecha").value = `${yyyy}-${mm}-${dd}`;
}

function setTipoMov(tipo) {
  document.getElementById("movTipo").value = tipo;
  const botones = {
    'Egreso': document.getElementById("btn-egreso"),
    'Ingreso': document.getElementById("btn-ingreso"),
    'Transferencia': document.getElementById("btn-transfer")
  };
  
  Object.keys(botones).forEach(t => {
    botones[t].classList.remove('bg-slate-700', 'text-white', 'shadow');
    botones[t].classList.add('text-slate-400', 'hover:text-white');
  });
  
  botones[tipo].classList.remove('text-slate-400', 'hover:text-white');
  botones[tipo].classList.add('bg-slate-700', 'text-white', 'shadow');
}

// ============================================
// PANEL DE DIAGNÓSTICO
// ============================================

function actualizarDiagnostico() {
  document.getElementById('diag-online').innerText = navigator.onLine ? 'Sí' : 'No';
  document.getElementById('diag-lastsync').innerText = lastSyncTime ? lastSyncTime.toLocaleString('es-CL') : 'Nunca';
  document.getElementById('diag-apiurl').innerText = API_URL || 'No configurada';
  document.getElementById('diag-token').innerText = TOKEN ? TOKEN.substring(0, 3) + '●●●●●' : 'No configurado';
  document.getElementById('diag-cuentas').innerText = cuentasGlobales.length;
  document.getElementById('diag-movimientos').innerText = movimientosGlobales.length;
  document.getElementById('diag-categorias').innerText = categoriasGlobales.length;
}

// ============================================
// FUNCIONES PLACEHOLDER (Completar según necesidades)
// ============================================

function procesarNotificacionPegada() {
  mostrarToast('Función en desarrollo', 'info');
}

function agregarNuevaCategoriaDrive() {
  const nombre = document.getElementById("catNuevaNombre").value.trim();
  if (!nombre) { mostrarToast('Ingresa un nombre para la categoría', 'warning'); return; }
  mostrarToast('Categoría agregada (en desarrollo)', 'success', 2000);
  document.getElementById("catNuevaNombre").value = '';
}

function eliminarCategoriaDrive(nombre) {
  mostrarConfirmacion(
    "Eliminar Categoría",
    `¿Deseas eliminar la categoría "${nombre}"?`,
    (resultado) => {
      if (resultado) {
        mostrarToast('Categoría eliminada (en desarrollo)', 'success', 2000);
      }
    }
  );
}

// Función de renderizado de gráfico (stub)
function renderizarGrafico(datos) {
  // Implementar si es necesario
  console.log("Gráfico listo para render con", datos.length, "movimientos");
}

// ============================================
// LÓGICA DE LOGIN Y CONFIGURACIÓN INICIAL
// ============================================

document.getElementById("loginForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const url = document.getElementById("loginUrl").value.trim();
  const token = document.getElementById("loginToken").value.trim();
  
  if (!url || !token) {
    mostrarToast('Debes ingresar la URL y el Token', 'error');
    return;
  }
  
  // Guardar en variables globales y localStorage
  guardarConfiguracionAPI(url, token);
  
  // Cerrar modal y preparar interfaz
  execCloseModal('modal-login');
  mostrarToast('Credenciales guardadas. Conectando...', 'info');
  
  // Inicializar la app
  history.replaceState({ tab: 'dashboard', openModals: [] }, '');
  initFABPosition();
  inicializarFechaHoy();
  
  // Iniciar sincronización de datos
  forzarSincronizacion();
});

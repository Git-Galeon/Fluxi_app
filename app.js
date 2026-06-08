// ============================================
// FLUXI APP v1.9.7 - Auto-Conexión (Cero Login)
// ============================================

// 1. PEGA TU URL DE APPS SCRIPT AQUÍ UNA SOLA VEZ
const API_URL = "https://script.google.com/macros/s/AKfycbz3X6-HM92OFY8Zio19WyVo_7afoNoZiWTKhi8qz5S0bn5WHglb4m9TcQd1vt9F43Su/exec"; 
const TOKEN = "A_gam3_n0n-7&7";

let lastSyncTime = null;
let currentTab = 'dashboard', openModals = [], cuentasGlobales = [], movimientosGlobales = [], categoriasGlobales = [], dashboardGlobal = {}, desgloseAbierto = false, miGrafico = null;
const DEFAULT_CATEGORIES = ["Alimentación", "Transporte", "Cuentas Fijas", "Ocio", "Salud", "Ahorro", "Otros"];
const formatMoneda = (v) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);

// ============================================
// ARRANQUE AUTOMÁTICO
// ============================================

document.addEventListener("DOMContentLoaded", () => {
  if (!API_URL || API_URL.includes("TU_SCRIPT_ID")) {
    mostrarToast("⚠️ Por favor, configura la API_URL en el archivo app.js", "error", 10000);
    return;
  }
  iniciarApp();
});

function iniciarApp() {
  history.replaceState({ tab: 'dashboard', openModals: [] }, '');
  window.onpopstate = (e) => {
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

function inicializarFechaHoy() {
  const hoy = new Date();
  document.getElementById("movFecha").value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

// ============================================
// SISTEMA DE NOTIFICACIONES TOAST Y CONFIRM
// ============================================

function mostrarToast(mensaje, tipo = 'info', duracion = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colorMap = { 'success': 'bg-emerald-500', 'error': 'bg-red-500', 'warning': 'bg-amber-500', 'info': 'bg-blue-500' };
  toast.className = `${colorMap[tipo]} text-white px-4 py-3 rounded-xl text-xs font-bold shadow-lg toast-slide-in`;
  toast.innerText = mensaje;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duracion);
}

let confirmCallback = null;
function mostrarConfirmacion(titulo, mensaje, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-title').innerText = titulo;
  document.getElementById('confirm-message').innerText = mensaje;
  document.getElementById('modal-confirm').classList.remove('hidden');
}
function cerrarConfirm(res) {
  document.getElementById('modal-confirm').classList.add('hidden');
  if (confirmCallback) confirmCallback(res);
  confirmCallback = null;
}

// ============================================
// POSICIÓN DEL FAB BOTÓN "+"
// ============================================

function initFABPosition() { setFabPosition(localStorage.getItem('fluxi_fab_pos') || 'center'); }
function setFabPosition(position) {
  const fab = document.getElementById('fab-container');
  fab.classList.remove('left-6', 'right-6', 'left-1/2', '-translate-x-1/2');
  if (position === 'left') fab.classList.add('left-6');
  else if (position === 'right') fab.classList.add('right-6');
  else fab.classList.add('left-1/2', '-translate-x-1/2');
  localStorage.setItem('fluxi_fab_pos', position);
  ['left', 'center', 'right'].forEach(pos => {
    const btn = document.getElementById(`btn-fab-${pos}`);
    if (btn) btn.className = `py-2.5 rounded-lg text-xs font-bold transition ${pos === position ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white bg-transparent'}`;
  });
}

// ============================================
// NAVEGACIÓN SPA Y MODALES
// ============================================

function switchTab(tabId) { if (tabId === currentTab) return; history.pushState({ tab: tabId, openModals: [...openModals] }, ''); execSwitchTab(tabId); }
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

function triggerOpenModal(modalId) { execOpenModal(modalId); openModals.push(modalId); history.pushState({ tab: currentTab, openModals: [...openModals] }, ''); }
function triggerCloseModal(modalId) { history.back(); }
function execOpenModal(modalId) { const modal = document.getElementById(modalId); modal.classList.remove('hidden'); setTimeout(() => { modal.classList.replace('modal-hidden', 'modal-visible'); }, 10); }
function execCloseModal(modalId) { const modal = document.getElementById(modalId); modal.classList.replace('modal-visible', 'modal-hidden'); setTimeout(() => modal.classList.add('hidden'), 250); }

// ============================================
// DESGLOSE SALDO NETO
// ============================================

function toggleDesgloseNeto() {
  desgloseAbierto = !desgloseAbierto;
  const comp = document.getElementById("desglose-compartment"), icon = document.getElementById("desglose-icon");
  if (desgloseAbierto) { comp.style.maxHeight = "500px"; comp.style.opacity = "1"; comp.style.marginTop = "16px"; icon.style.transform = "rotate(180deg)"; calcularDesglose(); } 
  else { comp.style.maxHeight = "0"; comp.style.opacity = "0"; comp.style.marginTop = "0"; icon.style.transform = "rotate(0deg)"; }
}

function calcularDesglose() {
  let actCLP = 0, actUSD = 0, deuCLP = 0, deuUSD = 0, dValor = Number(dashboardGlobal["Valor_Dolar"]) || 950; 
  cuentasGlobales.forEach(c => {
    let val = Number(c.Saldo_Actual) || 0;
    if (c.Tipo === 'Credito') c.Moneda === 'USD' ? deuUSD += Math.abs(val) : deuCLP += Math.abs(val); 
    else c.Moneda === 'USD' ? actUSD += val : actCLP += val; 
  });
  document.getElementById("desgloseActivosCLP").innerText = formatMoneda(actCLP);
  document.getElementById("desgloseActivosUSD").innerText = `US$ ${actUSD} (${formatMoneda(actUSD * dValor)})`;
  document.getElementById("desgloseDeudasCLP").innerText = formatMoneda(deuCLP);
  document.getElementById("desgloseDeudasUSD").innerText = `US$ ${deuUSD} (${formatMoneda(deuUSD * dValor)})`;
  document.getElementById("desgloseDolarValor").innerText = `$${dValor} CLP`;
}

// ==========================================
// CAPA INTELIGENTE DE PETICIONES
// ==========================================
async function fetchAPI(action) {
  const res = await fetch(`${API_URL}?action=${action}`);
  const text = await res.text();
  
  if (text.trim().startsWith('<')) {
    throw new Error("⚠️ ERROR DE PERMISOS: Google está bloqueando la app. Re-publica tu Apps Script como 'Cualquier persona'.");
  }
  
  const data = JSON.parse(text);
  if (data.error) throw new Error(data.error);
  return data;
}

async function forzarSincronizacion() {
  if (!navigator.onLine) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-wifi-slash text-red-400"></i> Sin conexión`;
    mostrarToast('Sin conexión a internet', 'warning'); return;
  }

  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Cargando`;
  document.getElementById("api-error-banner").classList.add("hidden");
  let errorCarga = false;

  try {
    dashboardGlobal = await fetchAPI('getDashboard');
    document.getElementById("dashNeto").innerText = formatMoneda(dashboardGlobal.Saldo_Neto_Real);
    document.getElementById("dashDeudaCLP").innerText = formatMoneda(dashboardGlobal.Deuda_TC_CLP);
    document.getElementById("dashDeudaUSD").innerText = "US$ " + (dashboardGlobal.Deuda_TC_USD || 0);
  } catch (e) { document.getElementById("api-error-msg").innerText = e.message; errorCarga = true; }

  try {
    cuentasGlobales = await fetchAPI('getCuentas');
    const selMov = document.getElementById("movCuenta"), filCta = document.getElementById("filtroCuenta"), list = document.getElementById("lista-cuentas");
    selMov.innerHTML = ""; filCta.innerHTML = `<option value="">Todas las Cuentas</option>`; list.innerHTML = "";
    
    cuentasGlobales.forEach(c => {
      selMov.innerHTML += `<option value="${c.ID_Cuenta}">${c.Nombre}</option>`;
      filCta.innerHTML += `<option value="${c.ID_Cuenta}">${c.Nombre}</option>`;
      const isTC = c.Tipo === 'Credito';
      list.innerHTML += `
        <div class="bg-slate-800/60 p-4 rounded-2xl flex justify-between border border-slate-700/40">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300"><i class="fa-solid ${isTC ? 'fa-credit-card' : 'fa-building-columns'} text-sm"></i></div>
            <div><h3 class="font-extrabold text-sm text-white">${c.Nombre}</h3><span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${isTC ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}">${c.Tipo}</span></div>
          </div>
          <div class="text-right"><span class="block text-sm font-black ${c.Saldo_Actual < 0 ? 'text-red-400' : 'text-emerald-400'}">${c.Moneda === 'USD' ? 'US$' : ''}${formatMoneda(c.Saldo_Actual).replace('$', '')}</span><span class="text-[9px] text-slate-500 uppercase font-semibold">Balance</span></div>
        </div>`;
    });
  } catch (e) { errorCarga = true; }

  try {
    categoriasGlobales = await fetchAPI('getCategorias');
    const sMov = document.getElementById("movCat"), sFil = document.getElementById("filtroCategoria"), lAdm = document.getElementById("lista-categorias-admin");
    sMov.innerHTML = ""; sFil.innerHTML = `<option value="">Todas</option>`; lAdm.innerHTML = "";
    categoriasGlobales.forEach(c => {
      sMov.innerHTML += `<option value="${c}">${c}</option>`; sFil.innerHTML += `<option value="${c}">${c}</option>`;
      lAdm.innerHTML += `<div class="flex justify-between p-3 bg-slate-800 rounded-xl border border-slate-700/40 text-sm font-bold items-center"><span>${c}</span>${DEFAULT_CATEGORIES.includes(c) ? `<span class="text-[8px] bg-slate-700 text-slate-400 px-2 py-1 rounded">Sistema</span>` : `<button onclick="eliminarCategoriaDrive('${c}')" class="text-red-400"><i class="fa-solid fa-trash"></i></button>`}</div>`;
    });
  } catch (e) {}

  try {
    movimientosGlobales = await fetchAPI('getMovimientos');
    if (currentTab === 'movimientos') renderizarHistorialMovimientos();
    renderizarGrafico(movimientosGlobales);
  } catch (e) { errorCarga = true; }

  procesarAlertasInteligentes();
  lastSyncTime = new Date();

  if (errorCarga) {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-500"></i> Parcial`;
    document.getElementById("api-error-banner").classList.remove("hidden");
    mostrarToast('Error de conexión o permisos. Revisa tu App Script.', 'error', 5000);
  } else {
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-wifi"></i> En línea`;
    document.getElementById("api-error-banner").classList.add("hidden");
  }
}

async function enviarAGoogle(payload) {
  if (!navigator.onLine) throw new Error("Offline"); 
  const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
  const text = await res.text();
  
  if (text.trim().startsWith('<')) throw new Error("Google rechazó la conexión. El script debe publicarse como 'Cualquier persona'.");
  
  const data = JSON.parse(text);
  if (data.error) throw new Error(data.error);
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-check"></i> Sincronizado`;
}

// ============================================
// FORMULARIO MOVIMIENTO Y EDICIÓN
// ============================================

document.getElementById("movForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando`;
  
  const pF = document.getElementById("movFecha").value.split("-"), idEdit = document.getElementById("editingId").value;
  const cuotas = Number(document.getElementById("movCuotas").value) || 1;
  let desc = document.getElementById("movDesc").value;
  if (cuotas > 1 && !idEdit) desc += ` (En ${cuotas} cuotas)`;

  try {
    await enviarAGoogle({
      action: idEdit ? "editMovimiento" : "addMovimiento", secret_token: TOKEN, ID_Mov: idEdit || Date.now(),
      Fecha: `${pF[2]}/${pF[1]}/${pF[0]}`, Descripcion: desc, Cuenta_Origen: document.getElementById("movCuenta").value,
      Categoria: document.getElementById("movCat").value, Tipo_Mov: document.getElementById("movTipo").value,
      Monto: Number(document.getElementById("movMonto").value), Moneda: document.getElementById("movMoneda").value,
      Frecuencia: document.getElementById("movFrecuencia").value, Cuotas: cuotas
    });
    triggerCloseModal('modal-movimiento');
    mostrarToast('Transacción exitosa', 'success');
    document.getElementById("status").innerHTML = `<i class="fa-solid fa-calculator fa-bounce"></i> Recalculando...`;
    setTimeout(() => forzarSincronizacion(), 1500);
  } catch (err) { mostrarToast(err.message, 'error', 5000); }
});

function esEdicion() { return document.getElementById("editingId").value !== ""; }

function editarMovimientoUI(idMov) {
  const mov = movimientosGlobales.find(m => String(m.ID_Mov) === String(idMov));
  if (!mov) return;
  document.getElementById("movimiento-modal-title").innerText = "Editar Movimiento";
  document.getElementById("movForm-submit-btn").innerText = "Guardar Cambios";
  document.getElementById("editingId").value = mov.ID_Mov;
  document.getElementById("contenedor-importador-notif").classList.add("hidden");
  setTipoMov(mov.Tipo_Mov);
  document.getElementById("movMonto").value = mov.Monto;
  document.getElementById("movDesc").value = mov.Descripcion.split(" (En ")[0];
  const p = mov.Fecha.split("/");
  if (p.length === 3) document.getElementById("movFecha").value = `${p[2]}-${p[1]}-${p[0]}`;
  document.getElementById("movFrecuencia").value = mov.Frecuencia || "Unica vez";
  document.getElementById("movCuenta").value = mov.Cuenta_Origen;
  document.getElementById("movMoneda").value = mov.Moneda || "CLP";
  document.getElementById("movCat").value = mov.Categoria;
  document.getElementById("movCuotas").value = mov.Cuotas || 1;
  verificarTipoCuenta();
  triggerOpenModal('modal-movimiento');
}

async function eliminarMovimientoDrive(id) {
  mostrarConfirmacion("Eliminar Movimiento", "¿Deseas eliminar permanentemente este movimiento de Google Sheets?", async (res) => {
    if (res) { document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`; try { await enviarAGoogle({ action: "deleteMovimiento", secret_token: TOKEN, ID_Mov: id }); mostrarToast('Eliminado', 'success'); setTimeout(() => forzarSincronizacion(), 1500); } catch (e) { mostrarToast(e.message, 'error'); } }
  });
}

function abrirModalNuevoMovimiento() {
  document.getElementById("movimiento-modal-title").innerText = "Nuevo Movimiento";
  document.getElementById("movForm-submit-btn").innerText = "Confirmar Transacción";
  document.getElementById("editingId").value = "";
  document.getElementById("movForm").reset();
  document.getElementById("contenedor-importador-notif").classList.remove("hidden");
  inicializarFechaHoy(); verificarTipoCuenta(); triggerOpenModal('modal-movimiento');
}

// ============================================
// LECTOR DE NOTIFICACIONES INTELIGENTE
// ============================================

function procesarNotificacionPegada() {
  const txt = document.getElementById("importText").value.trim().toLowerCase();
  if (!txt) return mostrarToast('Pega un texto primero', 'warning');
  const mMonto = txt.match(/(?:\$|clp)?\s?(\d{1,3}(?:\.\d{3})+|\d+)/);
  if (mMonto) document.getElementById("movMonto").value = mMonto[1].replace(/\./g, "");
  
  let desc = "Movimiento Importado";
  const pt = [/en\s+([A-Za-z0-9\s_]+?)(?:\s+con|\s+el|\s+por|\.|$)/, /a\s+([A-Za-z0-9\s_]+?)(?:\s+con|\s+el|\.|$)/];
  for (let r of pt) { const m = txt.match(r); if (m && m[1]) { desc = m[1].trim(); break; } }
  document.getElementById("movDesc").value = desc;

  const catMap = { "Alimentación": ["lider", "jumbo", "unimarc", "tottus", "uber eats", "pedidosya", "mcdonald", "supermercado"], "Transporte": ["uber", "didi", "metro", "copec", "shell", "peaje"], "Cuentas Fijas": ["vtr", "entel", "enel", "netflix", "spotify"], "Ocio": ["cine", "steam", "falabella", "aliexpress"] };
  for (let [cat, p] of Object.entries(catMap)) { if (p.some(pal => txt.includes(pal))) { document.getElementById("movCat").value = cat; break; } }
  
  if (cuentasGlobales.length > 0) { const cta = cuentasGlobales.find(c => txt.includes(c.Nombre.toLowerCase()) || (c.Tipo === 'Credito' && txt.includes("tarjeta"))); if (cta) { document.getElementById("movCuenta").value = cta.ID_Cuenta; verificarTipoCuenta(); } }
  document.getElementById("importText").value = ""; mostrarToast("Autocompletado", "success");
}

function setTipoMov(t) { document.getElementById('movTipo').value = t; ['btn-egreso', 'btn-ingreso', 'btn-transfer'].forEach(id => document.getElementById(id).className = "flex-1 py-2 text-xs font-bold text-slate-400 rounded-md"); const map = { 'Egreso':'btn-egreso', 'Ingreso':'btn-ingreso', 'Transferencia':'btn-transfer'}; document.getElementById(map[t]).className = "flex-1 py-2 text-xs font-bold bg-slate-700 text-white rounded-md shadow border border-slate-600/30"; }

function verificarTipoCuenta() { const cta = cuentasGlobales.find(c => c.ID_Cuenta === document.getElementById("movCuenta").value); const sec = document.getElementById("seccion-cuotas"); if (cta && cta.Tipo === 'Credito') { sec.classList.remove("hidden"); actualizarCalculoCuota(); } else { sec.classList.add("hidden"); document.getElementById("movCuotas").value = "1"; } }
function actualizarCalculoCuota() { const m = Number(document.getElementById("movMonto").value)||0, c = Number(document.getElementById("movCuotas").value)||1; document.getElementById("calculo-cuota").innerText = (m>0&&c>1) ? `${formatMoneda(Math.round(m/c))} / mes` : "$0 / mes"; }

// ============================================
// CUENTAS Y CATEGORÍAS EN DRIVE
// ============================================

document.getElementById("cuentaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registrando`;
  const tipo = document.getElementById("accType").value, cupo = Number(document.getElementById("accLimit").value) || 0;
  try {
    await enviarAGoogle({ action: "addCuenta", secret_token: TOKEN, ID_Cuenta: "CTA_" + Date.now(), Nombre: document.getElementById("accName").value, Tipo: tipo, Cupo_Total: tipo === 'Credito' ? cupo : 0, Moneda: document.getElementById("accCurrency").value, Dia_Corte: document.getElementById("accCorte").value || 20, Dia_Pago: document.getElementById("accPago").value || 5, Saldo_Inicial: tipo === 'Credito' ? 0 : cupo });
    triggerCloseModal('modal-cuenta');
    mostrarToast('Billetera guardada', 'success');
    setTimeout(() => forzarSincronizacion(), 1500);
  } catch(err) { mostrarToast(err.message, 'error', 5000); }
});

async function agregarNuevaCategoriaDrive() { const n = document.getElementById("catNuevaNombre").value.trim(); if(!n) return; if(categoriasGlobales.some(c=>c.toLowerCase()===n.toLowerCase())) return mostrarToast('Ya existe','warning'); document.getElementById("status").innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i>`; try { await enviarAGoogle({action:"addCategoria",secret_token:TOKEN,Nombre:n}); document.getElementById("catNuevaNombre").value=""; mostrarToast('Guardada','success'); setTimeout(()=>fetchAPI('getCategorias').then(c=>{categoriasGlobales=c;forzarSincronizacion()}), 1200); } catch(e){mostrarToast(e.message,'error')} }
async function eliminarCategoriaDrive(n) { mostrarConfirmacion("Eliminar",`¿Borrar categoría "${n}"?`,async(r)=>{if(r){try{await enviarAGoogle({action:"deleteCategoria",secret_token:TOKEN,Nombre:n});mostrarToast('Eliminada','success');setTimeout(()=>forzarSincronizacion(),1200);}catch(e){mostrarToast(e.message,'error')}}}); }

// ============================================
// GRÁFICOS Y DIAGNÓSTICO
// ============================================

function renderizarGrafico(m) {
  if(miGrafico) miGrafico.destroy();
  const l = [], ig = [0,0,0,0,0,0], eg = [0,0,0,0,0,0], hoy = new Date();
  for(let i=5;i>=0;i--){ let d = new Date(hoy.getFullYear(),hoy.getMonth()-i,1); l.push({t:["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][d.getMonth()]+" "+String(d.getFullYear()).slice(-2),m:d.getMonth(),y:d.getFullYear()}); }
  m.forEach(x => { if(!x.Fecha||!x.Monto)return; const p=String(x.Fecha).split("/"); if(p.length<3)return; const mm=parseInt(p[1])-1, yy=parseInt(p[2]); l.forEach((lbl,idx)=>{ if(lbl.m===mm&&lbl.y===yy){ if(x.Tipo_Mov==="Ingreso")ig[idx]+=Number(x.Monto); else if(x.Tipo_Mov==="Egreso")eg[idx]+=Number(x.Monto); }}); });
  miGrafico = new Chart(document.getElementById('chartFinanzas').getContext('2d'), { type:'line', data:{ labels:l.map(x=>x.t), datasets:[{label:'Ingresos',data:ig,borderColor:'#34d399',backgroundColor:'rgba(52, 211, 153, 0.08)',borderWidth:2,fill:true},{label:'Gastos',data:eg,borderColor:'#f87171',backgroundColor:'rgba(248, 113, 113, 0.03)',borderWidth:2,fill:true}] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false},ticks:{color:'#64748b',font:{size:9}}},y:{grid:{color:'rgba(51, 65, 85, 0.2)'},ticks:{color:'#64748b',font:{size:8}}}} }});
}

function procesarAlertasInteligentes() {
  const p = document.getElementById("panel-alertas"); p.innerHTML = ""; let a = [];
  const sn = Number(dashboardGlobal["Saldo_Neto_Real"])||0; if(sn<50000 && sn>0) a.push({t:'error',i:'fa-triangle-exclamation',tt:'Liquidez baja',d:`Saldo neto de ${formatMoneda(sn)}.`});
  cuentasGlobales.forEach(c=>{ if(c.Tipo==='Credito'){ let r=Math.abs(Number(c.Saldo_Actual)||0)/(Number(c.Cupo_Total)||0); if(r>0.7) a.push({t:'warning',i:'fa-shield-halved',tt:`Uso elevado ${c.Nombre}`,d:`${Math.round(r*100)}% de cupo ocupado.`}); }});
  if(!a.length) p.innerHTML=`<div class="p-4 bg-slate-800/30 rounded-2xl border border-slate-800 text-center text-xs text-slate-500"><i class="fa-solid fa-circle-check text-emerald-500"></i> Todo en orden</div>`;
  else a.forEach(x=> p.innerHTML+=`<div class="p-4 rounded-2xl border flex gap-3 ${x.t==='error'?'bg-rose-500/10 border-rose-500/20 text-rose-400':'bg-amber-500/10 border-amber-500/20 text-amber-400'}"><div class="text-lg"><i class="fa-solid ${x.i}"></i></div><div><h4 class="font-extrabold text-sm text-slate-100">${x.tt}</h4><p class="text-xs text-slate-400 mt-1">${x.d}</p></div></div>`);
}

function actualizarDiagnostico() {
  document.getElementById('diag-online').innerText = navigator.onLine ? 'Sí' : 'No';
  document.getElementById('diag-lastsync').innerText = lastSyncTime ? lastSyncTime.toLocaleString('es-CL') : 'Nunca';
  document.getElementById('diag-apiurl').innerText = API_URL ? API_URL.substring(0,25)+'...' : 'No conf.';
  document.getElementById('diag-token').innerText = TOKEN ? TOKEN.substring(0,3)+'●●●' : 'No conf.';
  document.getElementById('diag-cuentas').innerText = cuentasGlobales.length; document.getElementById('diag-movimientos').innerText = movimientosGlobales.length; document.getElementById('diag-categorias').innerText = categoriasGlobales.length;
}

function renderizarHistorialMovimientos() {
  const l = document.getElementById("lista-movimientos"), ft = document.getElementById("filtroTexto").value.toLowerCase(), fc = document.getElementById("filtroCategoria").value, fcta = document.getElementById("filtroCuenta").value;
  let r = movimientosGlobales.filter(m => (!fc||m.Categoria===fc) && (!fcta||m.Cuenta_Origen===fcta) && (!ft||m.Descripcion.toLowerCase().includes(ft)||String(m.Monto).includes(ft)||m.Categoria.toLowerCase().includes(ft)));
  document.getElementById("historial-total").innerText = `${r.length} txns`; l.innerHTML = "";
  if(!r.length) { l.innerHTML = `<div class="text-center py-12 bg-slate-800/20 rounded-2xl border border-slate-800/40"><i class="fa-solid fa-receipt text-slate-600 text-3xl mb-2"></i><p class="text-xs text-slate-500 font-bold">Sin movimientos</p></div>`; return; }
  r.forEach(m => {
    let cn = cuentasGlobales.find(c=>c.ID_Cuenta===m.Cuenta_Origen)?.Nombre||m.Cuenta_Origen||"Billetera", c = m.Tipo_Mov==='Ingreso'?'text-emerald-400':(m.Tipo_Mov==='Transferencia'?'text-blue-400':'text-rose-400');
    l.innerHTML += `<div class="bg-slate-800/60 p-4 rounded-2xl border border-slate-700/35 flex justify-between items-center"><div class="flex-1 min-w-0 pr-2"><span class="text-[9px] text-slate-500 font-extrabold uppercase block">${m.Fecha} • ${cn}</span><h4 class="font-extrabold text-sm truncate text-slate-100">${m.Descripcion}</h4><span class="inline-block text-[9px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded-md uppercase font-bold mt-1">${m.Categoria}</span></div><div class="text-right flex flex-col items-end gap-1.5 shrink-0"><span class="text-sm font-black ${c}">${m.Tipo_Mov==='Ingreso'?'+':'-'} ${m.Moneda==='USD'?'US$':''}${formatMoneda(m.Monto).replace('$','')}</span><div class="flex gap-1"><button onclick="editarMovimientoUI('${m.ID_Mov}')" class="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-md"><i class="fa-solid fa-pencil"></i></button><button onclick="eliminarMovimientoDrive('${m.ID_Mov}')" class="text-[10px] bg-rose-500/10 text-rose-400 px-2 py-1 rounded-md"><i class="fa-solid fa-trash"></i></button></div></div></div>`;
  });
}
function filtrarMovimientos() { renderizarHistorialMovimientos(); }

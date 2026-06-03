const API_URL = "https://script.google.com/macros/s/TU_DEPL_ID_AQUÍ/exec"; // Reemplaza con tu URL de GAS
const TOKEN = "A_gam3_n0n-7&7";

// Iniciar PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => console.log("PWA Ready"));
}

// Cargar Datos al abrir la App
document.addEventListener("DOMContentLoaded", () => {
  cargarDashboard();
  cargarSelectoresCuenta();
});

async function cargarDashboard() {
  try {
    const res = await fetch(`${API_URL}?action=getDashboard`);
    const data = await res.json();
    // Ajusta "Saldo_Neto_Real" al nombre exacto de la celda de tu Dashboard
    if(data["Saldo_Neto_Real"]) {
      document.getElementById("dashNeto").innerText = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(data["Saldo_Neto_Real"]);
    }
  } catch (err) { console.log("Error cargando Dashboard:", err); }
}

async function cargarSelectoresCuenta() {
  try {
    const res = await fetch(`${API_URL}?action=getCuentas`);
    const cuentas = await res.json();
    const select = document.getElementById("movCuenta");
    select.innerHTML = "";
    cuentas.forEach(c => {
      let opt = document.createElement("option");
      opt.value = c.ID_Cuenta;
      opt.innerText = c.Nombre;
      select.appendChild(opt);
    });
  } catch (err) { console.log("Error cargando cuentas:", err); }
}

// Guardar Movimiento
document.getElementById("movForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("status").innerText = "Guardando...";
  
  const payload = {
    action: "addMovimiento",
    secret_token: TOKEN,
    ID_Mov: Date.now(), // ID único temporal basado en tiempo
    Fecha: new Date().toLocaleDateString('es-CL'),
    Descripcion: document.getElementById("movDesc").value,
    Cuenta_Origen: document.getElementById("movCuenta").value,
    Categoria: document.getElementById("movCat").value,
    Tipo_Mov: "Egreso",
    Monto: Number(document.getElementById("movMonto").value),
    Moneda: document.getElementById("movMoneda").value
  };

  await enviarAGoogle(payload);
  document.getElementById("movForm").reset();
  cargarDashboard();
});

// Guardar Nueva Cuenta
document.getElementById("cuentaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const payload = {
    action: "addCuenta",
    secret_token: TOKEN,
    ID_Cuenta: document.getElementById("accId").value,
    Nombre: document.getElementById("accName").value,
    Tipo: document.getElementById("accType").value,
    Cupo_Total: Number(document.getElementById("accLimit").value) || 0,
    Moneda: document.getElementById("accCurrency").value,
    Dia_Corte: 20, // Valores base por defecto modificables
    Dia_Pago: 5,
    Saldo_Inicial: 0
  };

  await enviarAGoogle(payload);
  document.getElementById("cuentaForm").reset();
  cargarSelectoresCuenta();
});

async function enviarAGoogle(payload) {
  try {
    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    document.getElementById("status").innerText = "Sincronizado";
  } catch (err) {
    document.getElementById("status").innerText = "Error Offline";
    console.error(err);
  }
}

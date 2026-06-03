// IMPORTANTE: Cambia esto por la URL de tu Web App desplegado en GAS
const API_URL = "https://script.google.com/macros/s/TU_DEPL_ID/exec";

// Registro del Service Worker para la PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log("Service Worker Activo"));
}

// Evento para guardar cuenta en CONFIG_CUENTAS
document.getElementById('cuentaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    action: "addCuenta",
    ID_Cuenta: document.getElementById('accId').value,
    Nombre: document.getElementById('accName').value,
    Tipo: document.getElementById('accType').value,
    Cupo_Total: Number(document.getElementById('accLimit').value) || 0,
    Moneda: document.getElementById('accCurrency').value,
    Dia_Corte: "", // Opcional rellenar en el form
    Dia_Pago: "",
    Saldo_Inicial: 0
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      mode: "no-cors", // Crucial para evitar bloqueos CORS con Google Apps Script
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    alert("Petición enviada. Revisa tu Google Sheets.");
    document.getElementById('cuentaForm').reset();
  } catch (error) {
    console.error("Error:", error);
  }
});

// CONFIGURACIÓN GLOBAL: Reemplaza con el ID real de tu Google Sheet de absorción
const ID_DRIVE_ABSORCION = "1HM__Y-1UUHdFOFkJeTaeUU2q_rQz2YJMcAVPmuJr6Bk";
const NOMBRE_HOJA_ABSORCION = "TABLA ABSORCION";

/**
 * Levanta la interfaz gráfica de la Web App
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Panel de Control - Gestión de Bienios')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Rescata la matriz de absorción directamente desde el archivo centralizado en Google Drive
 */
function obtenerMatrizAbsorcion() {
  try {
    const ss = SpreadsheetApp.openById(ID_DRIVE_ABSORCION);
    const sheet = ss.getSheetByName(NOMBRE_HOJA_ABSORCION);
    return sheet.getDataRange().getValues();
  } catch (e) {
    throw new Error("Error al conectar con Drive para obtener la Tabla de Absorción: " + e.message);
  }
}

/**
 * Recibe los datos planos del Excel desde el Frontend, agrupa por funcionario y calcula los bienios
 */
function procesarDatosDashboard(datosExcel) {
  const matrizAbsorcion = obtenerMatrizAbsorcion();
  const hoy = new Date();
  
  // Agrupar filas por funcionario utilizando el ID/RUT (Columna Índice 1)
  let mapeoFuncionarios = {};
  
  // Saltamos la primera fila si viene con cabeceras desde el frontend
  for (let i = 0; i < datosExcel.length; i++) {
    let fila = datosExcel[i];
    if (!fila[0] || !fila[1] || !fila[7] || !fila[8]) continue; // Validación básica de campos requeridos
    
    let codigoEstablecimiento = fila[0].toString().trim();
    if (codigoEstablecimiento !== "963") continue; // Filtro de establecimiento constante

    let idFuncionario = fila[1].toString().trim();
    if (!mapeoFuncionarios[idFuncionario]) {
      mapeoFuncionarios[idFuncionario] = [];
    }
    mapeoFuncionarios[idFuncionario].push(fila);
  }

  let resultadosFinales = [];

  // Procesar la línea de tiempo individual de cada funcionario agrupado
  for (let idFuncionario in mapeoFuncionarios) {
    let filasContratos = mapeoFuncionarios[idFuncionario];
    let contratos = [];

    for (let j = 0; j < filasContratos.length; j++) {
      let f = filasContratos[j];
      let gradoRaw = f[7].toString().split('/')[0].trim();
      let grado = parseInt(gradoRaw, 10);
      let inicio = new Date(f[8]);
      let fin = (f[9] && f[9] !== "Vigente" && f[9] !== "") ? new Date(f[9]) : null;

      if (!isNaN(grado) && !isNaN(inicio.getTime())) {
        contratos.push({ inicio: inicio, fin: fin, grado: grado });
      }
    }

    if (contratos.length === 0) continue;

    // Ejecución del algoritmo optimizado de línea de tiempo
    contratos.sort((a, b) => a.inicio - b.inicio);

    let diasAcumulados = 0;
    let ultimoFin = null;
    let ultimoGrado = null;
    let tieneContratoVigente = false;
    let fechaInicioContinuidad = contratos[0].inicio; 
    let fechaCambioGrado = contratos[0].inicio;
    let bitacora = [];

    for (let k = 0; k < contratos.length; k++) {
      let c = contratos[k];
      let inicio = c.inicio;
      let fin = c.fin;
      let finCalculo = fin;

      if (fin === null || fin >= hoy) {
        tieneContratoVigente = true;
        if (fin === null || fin > hoy) finCalculo = hoy;
      }

      // Cambio de Grado Prioritario
      if (ultimoGrado !== null && c.grado !== ultimoGrado) {
        fechaCambioGrado = inicio; 
        let bieniosAntes = Math.floor(diasAcumulados / 730);
        
        if (bieniosAntes === 0) {
          diasAcumulados = 0; 
          fechaInicioContinuidad = inicio; 
          bitacora.push("• RESETEO: Cambió al G°" + c.grado + " antes del 1er bienio el " + formatFecha(inicio));
        } else {
          let remanentePasado = diasAcumulados % 730;
          let bieniosNuevos = consultarMatrizAbsorcionInterna(ultimoGrado, c.grado, bieniosAntes, matrizAbsorcion);
          if (bieniosNuevos !== null) {
            diasAcumulados = (bieniosNuevos * 730) + remanentePasado; 
            bitacora.push("• ABSORCIÓN G°" + ultimoGrado + "➔G°" + c.grado + " el " + formatFecha(inicio) + " (Ajustado a " + bieniosNuevos + " bienios)");
          }
        }
      }

      // Lagunas y Solapamientos
      let inicioEfectivo = inicio;
      if (ultimoFin !== null) {
        let diferenciaDias = Math.floor((inicio.getTime() - ultimoFin.getTime()) / (1000 * 60 * 60 * 24));
        if (diferenciaDias > 1) {
          bitacora.push("• LAGUNA: " + (diferenciaDias - 1) + " días sin cubrir al " + formatFecha(inicio));
          diasAcumulados = 0; 
          fechaInicioContinuidad = inicio; 
        } else if (inicio <= ultimoFin) {
          inicioEfectivo = new Date(ultimoFin.getTime() + (1000 * 60 * 60 * 24));
        }
      }

      if (inicioEfectivo > finCalculo) {
        if (ultimoFin === null || finCalculo > ultimoFin) ultimoFin = finCalculo;
        ultimoGrado = c.grado;
        continue;
      }

      let diasContrato = Math.round((finCalculo.getTime() - inicioEfectivo.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      diasAcumulados += diasContrato;

      if (ultimoFin === null || finCalculo > ultimoFin) ultimoFin = finCalculo;
      ultimoGrado = c.grado;
    }

    let bieniosFinales = Math.floor(diasAcumulados / 730);
    let diasRemanentes = diasAcumulados % 730;
    let fechaReconocimientoTXT = "N/A";
    let tiempoFaltanteTXT = "N/A";
    
    if (tieneContratoVigente) {
      let diasFaltantesTotal = 730 - diasRemanentes;
      let fechaCumplimiento = new Date(hoy.getTime());
      fechaCumplimiento.setDate(fechaCumplimiento.getDate() + diasFaltantesTotal);
      
      let copiaHoy = new Date(hoy.getTime());
      let mesesFaltantes = 0;
      while (true) {
        let proximoMes = new Date(copiaHoy.getTime());
        proximoMes.setMonth(proximoMes.getMonth() + 1);
        if (proximoMes <= fechaCumplimiento) {
          mesesFaltantes++;
          copiaHoy = proximoMes;
        } else {
          break;
        }
      }
      let diasFaltantesRestantes = Math.round((fechaCumplimiento.getTime() - copiaHoy.getTime()) / (1000 * 60 * 60 * 24));
      tiempoFaltanteTXT = ("0" + diasFaltantesRestantes).slice(-2) + "d y " + ("0" + mesesFaltantes).slice(-2) + "m";
      
      let fechaReconocimiento = new Date(fechaCumplimiento.getTime());
      if (fechaReconocimiento.getDate() > 1) fechaReconocimiento.setMonth(fechaReconocimiento.getMonth() + 1);
      fechaReconocimiento.setDate(1);
      fechaReconocimientoTXT = formatFecha(fechaReconocimiento);
    }

    resultadosFinales.push({
      id: idFuncionario,
      bienios: bieniosFinales,
      vigente: tieneContratoVigente ? "SÍ" : "NO",
      continuidad: formatFecha(fechaInicioContinuidad),
      cambioGrado: formatFecha(fechaCambioGrado),
      reconocimiento: fechaReconocimientoTXT,
      faltante: tiempoFaltanteTXT,
      bitacora: bitacora.length > 0 ? bitacora.join(" | ") : "Sin novedades"
    });
  }

  return resultadosFinales;
}

function formatFecha(fecha) {
  return ("0" + fecha.getDate()).slice(-2) + "/" + ("0" + (fecha.getMonth() + 1)).slice(-2) + "/" + fecha.getFullYear();
}

function consultarMatrizAbsorcionInterna(gradoAnt, gradoNue, bieniosAntes, matriz) {
  if (!matriz || matriz.length < 2) return null;
  let filaCabecera = matriz[0]; 
  for (let i = 1; i < matriz.length; i++) {
    let fila = matriz[i];
    if (fila[0] == gradoAnt && fila[1] == gradoNue) {
      for (let j = 2; j < fila.length; j++) {
        if (filaCabecera[j] === bieniosAntes) {
          return fila[j] !== "" ? parseInt(fila[j], 10) : null;
        }
      }
    }
  }
  return null; 
}

// Ruta de la carpeta del modelo (la que descargas de Teachable Machine).
// Si tu carpeta se llama distinto (por ejemplo "Modelo"), cámbialo aquí.
const MODEL_URL = "./my_model/";

const MAX_HISTORIAL = 30;
const CLAVE_HISTORIAL = "historial-clasificador";

let model, webcam, maxPredictions;
let filas = [];               // referencias a las filas de barras
let animacion = null;         // id del requestAnimationFrame
let camaraActiva = false;
let ultimaCoincidencia = null; // para no repetir en el histórico cada fotograma
let historial = [];

// ---------- Elementos del DOM ----------
const visor = document.getElementById("webcam-container");
const labelContainer = document.getElementById("label-container");
const mensaje = document.getElementById("mensaje");
const estado = document.getElementById("estado");
const btnIniciar = document.getElementById("btn-iniciar");
const btnParar = document.getElementById("btn-parar");
const btnSubir = document.getElementById("btn-subir");
const btnBorrar = document.getElementById("btn-borrar");
const archivo = document.getElementById("archivo");
const umbral = document.getElementById("umbral");
const umbralValor = document.getElementById("umbral-valor");
const plantilla = document.getElementById("plantilla");
const listaHistorial = document.getElementById("historial");

// ---------- Utilidades de interfaz ----------
function mostrarMensaje(texto, tipo) {
    mensaje.textContent = texto;
    mensaje.dataset.tipo = tipo;
}

function setEstado(texto, activo) {
    estado.textContent = texto;
    estado.dataset.activo = activo ? "true" : "false";
}

function actualizarBotones() {
    btnIniciar.disabled = camaraActiva;
    btnParar.disabled = !camaraActiva;
}

function limpiarVisor() {
    visor.innerHTML = "";
}

function actualizarUmbral() {
    umbralValor.textContent = umbral.value + "%";
    labelContainer.style.setProperty("--umbral", umbral.value + "%");
}

// ---------- Modelo ----------
async function cargarModelo() {
    if (model) return;
    setEstado("Cargando modelo...", false);
    model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
    maxPredictions = model.getTotalClasses();
    crearFilas(model.getClassLabels());
}

function crearFilas(nombres) {
    labelContainer.innerHTML = "";
    filas = nombres.map((nombre) => {
        const el = document.createElement("div");
        el.className = "fila";
        el.innerHTML =
            '<span class="nombre"></span><span class="valor">0%</span>' +
            '<div class="barra"><div class="relleno"></div></div>';
        el.querySelector(".nombre").textContent = nombre;
        labelContainer.appendChild(el);
        return {
            el,
            valor: el.querySelector(".valor"),
            relleno: el.querySelector(".relleno"),
        };
    });
    actualizarUmbral();
}

function reiniciarBarras() {
    filas.forEach((f) => {
        f.relleno.style.width = "0%";
        f.valor.textContent = "0%";
        f.el.classList.remove("ganador");
    });
}

// ---------- Cámara ----------
async function iniciar() {
    if (camaraActiva) return;
    btnIniciar.disabled = true;
    try {
        await cargarModelo();
        limpiarVisor();

        const flip = true;
        webcam = new tmImage.Webcam(400, 400, flip);
        await webcam.setup();
        await webcam.play();
        visor.appendChild(webcam.canvas);

        camaraActiva = true;
        ultimaCoincidencia = null;
        setEstado("Cámara activa", true);
        mostrarMensaje("Analizando...", "neutro");
        actualizarBotones();
        animacion = window.requestAnimationFrame(loop);
    } catch (error) {
        console.error(error);
        camaraActiva = false;
        setEstado("Cámara apagada", false);
        mostrarMensaje(
            "No se pudo iniciar. Revisa la ruta del modelo y el permiso de la cámara.",
            "error"
        );
        actualizarBotones();
    }
}

function parar() {
    if (!camaraActiva) return;
    camaraActiva = false;
    window.cancelAnimationFrame(animacion);
    webcam.stop();
    limpiarVisor();
    reiniciarBarras();
    ultimaCoincidencia = null;
    setEstado("Cámara apagada", false);
    mostrarMensaje("Cámara parada. Pulsa Iniciar o sube una imagen.", "neutro");
    actualizarBotones();
}

async function loop() {
    if (!camaraActiva) return;
    webcam.update();
    await predecir(webcam.canvas, "Cámara");
    if (camaraActiva) {
        animacion = window.requestAnimationFrame(loop);
    }
}

// ---------- Predicción ----------
async function predecir(fuente, origen) {
    const prediccion = await model.predict(fuente);

    let mejor = prediccion[0];
    prediccion.forEach((p) => {
        if (p.probability > mejor.probability) mejor = p;
    });

    const minimo = Number(umbral.value) / 100;
    const hayCoincidencia = mejor.probability >= minimo;

    prediccion.forEach((p, i) => {
        const porcentaje = Math.round(p.probability * 100);
        filas[i].relleno.style.width = porcentaje + "%";
        filas[i].valor.textContent = porcentaje + "%";
        filas[i].el.classList.toggle("ganador", hayCoincidencia && p === mejor);
    });

    if (hayCoincidencia) {
        const porcentaje = Math.round(mejor.probability * 100);
        const texto = plantilla.value
            .replaceAll("{clase}", mejor.className)
            .replaceAll("{porcentaje}", porcentaje);
        mostrarMensaje(texto, "ok");

        if (mejor.className !== ultimaCoincidencia) {
            registrar(mejor.className, porcentaje, origen);
            ultimaCoincidencia = mejor.className;
        }
    } else {
        mostrarMensaje(
            "Sin coincidencia clara (mínimo " + umbral.value + "%).",
            "aviso"
        );
        ultimaCoincidencia = null;
    }
}

// ---------- Subir imagen ----------
async function subirImagen() {
    const fichero = archivo.files[0];
    archivo.value = "";
    if (!fichero) return;

    if (!fichero.type.startsWith("image/")) {
        mostrarMensaje("El archivo no es una imagen.", "error");
        return;
    }

    if (camaraActiva) parar();

    const url = URL.createObjectURL(fichero);
    try {
        await cargarModelo();
        const img = new Image();
        img.src = url;
        await img.decode();

        limpiarVisor();
        visor.appendChild(img);
        setEstado("Imagen cargada", false);

        ultimaCoincidencia = null;
        await predecir(img, "Imagen");
    } catch (error) {
        console.error(error);
        mostrarMensaje("No se pudo analizar la imagen.", "error");
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ---------- Histórico ----------
function cargarHistorial() {
    try {
        const guardado = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL));
        if (Array.isArray(guardado)) historial = guardado;
    } catch (error) {
        historial = [];
    }
}

function guardarHistorial() {
    try {
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(historial));
    } catch (error) {
        console.warn("No se pudo guardar el histórico", error);
    }
}

function registrar(clase, porcentaje, origen) {
    historial.unshift({
        clase,
        porcentaje,
        origen,
        hora: new Date().toLocaleTimeString("es-ES"),
    });
    historial = historial.slice(0, MAX_HISTORIAL);
    guardarHistorial();
    pintarHistorial();
}

function pintarHistorial() {
    listaHistorial.innerHTML = "";

    if (historial.length === 0) {
        const vacio = document.createElement("li");
        vacio.className = "vacio";
        vacio.textContent = "Todavía no hay resultados. Inicia la cámara o sube una imagen.";
        listaHistorial.appendChild(vacio);
        return;
    }

    historial.forEach((h) => {
        const li = document.createElement("li");
        const datos = [
            ["h-clase", h.clase],
            ["h-pct", h.porcentaje + "%"],
            ["h-origen", h.origen],
            ["h-hora", h.hora],
        ];
        datos.forEach(([clase, texto]) => {
            const span = document.createElement("span");
            span.className = clase;
            span.textContent = texto;
            li.appendChild(span);
        });
        listaHistorial.appendChild(li);
    });
}

// ---------- Eventos ----------
btnIniciar.addEventListener("click", iniciar);
btnParar.addEventListener("click", parar);
btnSubir.addEventListener("click", () => archivo.click());
archivo.addEventListener("change", subirImagen);
umbral.addEventListener("input", actualizarUmbral);
btnBorrar.addEventListener("click", () => {
    historial = [];
    guardarHistorial();
    pintarHistorial();
});

// ---------- Arranque ----------
actualizarUmbral();
cargarHistorial();
pintarHistorial();

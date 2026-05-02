const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 100e6
});

const PORT = process.env.PORT || 3000;

// codigo -> [socket.id del agente Python, socket.id del renderer, ...]
// Todos los sockets registrados con el mismo codigo reciben los mismos eventos
const grupos = {};  // codigo -> Set de socket.ids

// socket.id -> codigo (para limpiar al desconectar)
const socketCodigo = {};

// codigo -> socket.id del controlador activo
const controladores = {};

app.get("/", (req, res) => res.send("Xinoku Connect — Signaling Server activo."));

function enviarAGrupo(codigo, evento, data) {
  const grupo = grupos[codigo];
  if (!grupo) return;
  for (const sid of grupo) {
    io.to(sid).emit(evento, data);
  }
}

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id}`);

  // Agente Python se registra con su codigo
  socket.on("registrar", (codigo) => {
    if (!grupos[codigo]) grupos[codigo] = new Set();
    grupos[codigo].add(socket.id);
    socketCodigo[socket.id] = codigo;
    socket.data.codigo = codigo;
    socket.data.tipo   = "agente";
    console.log(`[AGENTE] ${codigo} -> ${socket.id} | grupo size: ${grupos[codigo].size}`);
    socket.emit("registrado", { codigo });
  });

  // Renderer Electron se registra con el MISMO codigo del agente
  // Asi queda en el mismo "grupo" y recibe todos los eventos
  socket.on("registrar-renderer-por-codigo", ({ codigo }) => {
    if (!grupos[codigo]) {
      console.log(`[RENDERER] FAIL: codigo ${codigo} no existe. Grupos:`, Object.keys(grupos));
      socket.emit("renderer-registrado", { ok: false });
      return;
    }
    grupos[codigo].add(socket.id);
    socketCodigo[socket.id] = codigo;
    socket.data.codigo = codigo;
    socket.data.tipo   = "renderer";
    console.log(`[RENDERER] OK: ${codigo} rendererId=${socket.id} | grupo size: ${grupos[codigo].size}`);
    socket.emit("renderer-registrado", { ok: true });
  });

  // Controlador quiere unirse
  socket.on("unirse", (codigo) => {
    if (!grupos[codigo] || grupos[codigo].size === 0) {
      socket.emit("error-sesion", { mensaje: "Codigo no encontrado." });
      return;
    }
    // Encontrar el agente Python (primer socket del grupo)
    const agenteId = [...grupos[codigo]][0];
    controladores[codigo] = socket.id;
    socket.data.codigo  = codigo;
    socket.data.tipo    = "controlador";
    socket.data.agenteId = agenteId;
    console.log(`[JOIN] ctrl=${socket.id} -> grupo=${codigo} agenteId=${agenteId}`);
    io.to(agenteId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: agenteId });
  });

  // Permiso
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    console.log(`[PERMISO] hacia=${hacia} aceptado=${aceptado}`);
    if (aceptado) {
      io.to(hacia).emit("permiso-respuesta", { aceptado, agenteId: socket.id });
    } else {
      io.to(hacia).emit("permiso-respuesta", { aceptado });
    }
  });

  // Frames
  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  // Mouse / teclado
  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ── CHAT controlador -> PC controlada ──
  socket.on("chat", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT] de=${de} hacia=${hacia} msg="${mensaje}"`);
    // Enviar a TODOS los sockets del grupo (agente + renderer)
    const codigo = socketCodigo[hacia] || socket.data.codigo;
    // Buscar el codigo del destino
    let codigoDestino = null;
    for (const [cod, grupo] of Object.entries(grupos)) {
      if (grupo.has(hacia)) { codigoDestino = cod; break; }
    }
    if (codigoDestino) {
      enviarAGrupo(codigoDestino, "chat", { mensaje, de });
      console.log(`[CHAT] Enviado a grupo ${codigoDestino} (${grupos[codigoDestino]?.size} sockets)`);
    } else {
      // Fallback: enviar directo
      io.to(hacia).emit("chat", { mensaje, de });
    }
  });

  // PC controlada -> controlador
  socket.on("chat-agente", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT-AGENTE] hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ── ARCHIVOS controlador -> PC controlada ──
  // Enviar a TODOS los sockets del grupo
  socket.on("archivo-meta", ({ hacia, meta }) => {
    console.log(`[ARCH-META] hacia=${hacia} nombre=${meta?.nombre}`);
    let codigoDestino = null;
    for (const [cod, grupo] of Object.entries(grupos)) {
      if (grupo.has(hacia)) { codigoDestino = cod; break; }
    }
    if (codigoDestino) {
      enviarAGrupo(codigoDestino, "archivo-meta", { meta });
      console.log(`[ARCH-META] Enviado a grupo ${codigoDestino} (${grupos[codigoDestino]?.size} sockets)`);
    } else {
      io.to(hacia).emit("archivo-meta", { meta });
    }
  });

  socket.on("archivo-chunk", ({ hacia, chunk }) => {
    let codigoDestino = null;
    for (const [cod, grupo] of Object.entries(grupos)) {
      if (grupo.has(hacia)) { codigoDestino = cod; break; }
    }
    if (codigoDestino) {
      enviarAGrupo(codigoDestino, "archivo-chunk", { chunk });
    } else {
      io.to(hacia).emit("archivo-chunk", { chunk });
    }
  });

  socket.on("archivo-fin", ({ hacia }) => {
    console.log(`[ARCH-FIN] hacia=${hacia}`);
    let codigoDestino = null;
    for (const [cod, grupo] of Object.entries(grupos)) {
      if (grupo.has(hacia)) { codigoDestino = cod; break; }
    }
    if (codigoDestino) {
      enviarAGrupo(codigoDestino, "archivo-fin", {});
      console.log(`[ARCH-FIN] Enviado a grupo ${codigoDestino} (${grupos[codigoDestino]?.size} sockets)`);
    } else {
      io.to(hacia).emit("archivo-fin", {});
    }
  });

  socket.on("archivo-recibido", ({ hacia, nombre }) => {
    io.to(hacia).emit("archivo-recibido", { nombre });
  });

  // ── ARCHIVOS PC controlada -> controlador ──
  socket.on("archivo-meta-agente",   ({ hacia, meta })  => io.to(hacia).emit("archivo-meta-agente",  { meta }));
  socket.on("archivo-chunk-agente",  ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk-agente", { chunk }));
  socket.on("archivo-fin-agente",    ({ hacia })        => io.to(hacia).emit("archivo-fin-agente",   {}));
  socket.on("archivo-recibido-ctrl", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido",    { nombre }));

  // ── SESION ──
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });
  socket.on("sesion-finalizada-por-controlador", ({ hacia }) => {
    // Enviar a todo el grupo de la PC controlada
    let codigoDestino = null;
    for (const [cod, grupo] of Object.entries(grupos)) {
      if (grupo.has(hacia)) { codigoDestino = cod; break; }
    }
    if (codigoDestino) {
      enviarAGrupo(codigoDestino, "sesion-finalizada-por-controlador", {});
    } else {
      io.to(hacia).emit("sesion-finalizada-por-controlador");
    }
  });

  // ── Desconexion ──
  socket.on("disconnect", () => {
    const codigo = socketCodigo[socket.id];
    if (codigo && grupos[codigo]) {
      grupos[codigo].delete(socket.id);
      if (grupos[codigo].size === 0) {
        delete grupos[codigo];
        console.log(`[-] Grupo ${codigo} eliminado`);
      } else {
        console.log(`[-] Socket ${socket.id} removido de grupo ${codigo}. Quedan: ${grupos[codigo].size}`);
      }
    }
    delete socketCodigo[socket.id];
    console.log(`[-] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Signaling Server en puerto ${PORT}`);
});

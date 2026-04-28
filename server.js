const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 50e6
});

const PORT     = process.env.PORT || 3000;
const sesiones = {};  // codigo -> socket.id del agente

app.get("/", (req, res) => res.send("Xinoku Connect — Signaling Server activo."));

io.on("connection", (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── Agente se registra con su codigo ──
  socket.on("registrar", (codigo) => {
    sesiones[codigo] = socket.id;
    socket.data.codigo = codigo;
    console.log(`[REG] Codigo ${codigo} -> ${socket.id}`);
    socket.emit("registrado", { codigo });
  });

  // ── Controlador quiere unirse ──
  socket.on("unirse", (codigo) => {
    const agenteId = sesiones[codigo];
    if (!agenteId) {
      socket.emit("error-sesion", { mensaje: "Codigo no encontrado." });
      return;
    }
    console.log(`[JOIN] ctrl=${socket.id} -> agente=${agenteId}`);
    io.to(agenteId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: agenteId });
  });

  // ── Permiso aceptado/rechazado ──
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    console.log(`[PERMISO] hacia=${hacia} aceptado=${aceptado}`);
    io.to(hacia).emit("permiso-respuesta", { aceptado });
  });

  // ── Frames de pantalla ──
  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  // ── Mouse y teclado ──
  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ══════════════════════════════════════════════
  // CHAT — todos los casos cubiertos
  // ══════════════════════════════════════════════

  // Controlador → PC controlada (socketCtrl emite "chat")
  socket.on("chat", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT] de=${de} hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // PC controlada → controlador (socketAgente emite "chat-agente")
  socket.on("chat-agente", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT-AGENTE] de=${de} hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ══════════════════════════════════════════════
  // ARCHIVOS — controlador → PC controlada
  // ══════════════════════════════════════════════
  socket.on("archivo-meta",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta",  { meta }));
  socket.on("archivo-chunk", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk", { chunk }));
  socket.on("archivo-fin",   ({ hacia })        => io.to(hacia).emit("archivo-fin",   {}));
  socket.on("archivo-recibido", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido", { nombre }));

  // ══════════════════════════════════════════════
  // ARCHIVOS — PC controlada → controlador
  // ══════════════════════════════════════════════
  socket.on("archivo-meta-agente",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta-agente",  { meta }));
  socket.on("archivo-chunk-agente", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk-agente", { chunk }));
  socket.on("archivo-fin-agente",   ({ hacia })        => io.to(hacia).emit("archivo-fin-agente",   {}));
  socket.on("archivo-recibido-ctrl", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido", { nombre }));

  // ══════════════════════════════════════════════
  // ARCHIVOS — controlador → PC controlada (via socketAgente)
  // ══════════════════════════════════════════════
  socket.on("archivo-meta-ctrl",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta-ctrl",  { meta }));
  socket.on("archivo-chunk-ctrl", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk-ctrl", { chunk }));
  socket.on("archivo-fin-ctrl",   ({ hacia })        => io.to(hacia).emit("archivo-fin-ctrl",   {}));

  // ══════════════════════════════════════════════
  // SESION — finalizar
  // ══════════════════════════════════════════════

  // PC controlada finaliza la sesion
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    console.log(`[FIN-AGENTE] hacia=${hacia}`);
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });

  // Controlador finaliza la sesion
  socket.on("sesion-finalizada-por-controlador", ({ hacia }) => {
    console.log(`[FIN-CTRL] hacia=${hacia}`);
    io.to(hacia).emit("sesion-finalizada-por-controlador");
  });

  // ── Señalizacion WebRTC (por si acaso) ──
  socket.on("oferta",        ({ hacia, oferta })    => io.to(hacia).emit("oferta",        { desde: socket.id, oferta }));
  socket.on("respuesta",     ({ hacia, respuesta }) => io.to(hacia).emit("respuesta",     { desde: socket.id, respuesta }));
  socket.on("ice-candidato", ({ hacia, candidato }) => io.to(hacia).emit("ice-candidato", { desde: socket.id, candidato }));

  // ── Desconexion ──
  socket.on("disconnect", () => {
    for (const [codigo, id] of Object.entries(sesiones)) {
      if (id === socket.id) {
        delete sesiones[codigo];
        console.log(`[-] Sesion ${codigo} eliminada`);
      }
    }
    console.log(`[-] Desconectado: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Connect — Signaling Server en puerto ${PORT}`);
});
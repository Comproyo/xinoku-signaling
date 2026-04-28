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
const sesiones = {};        // codigo -> socket.id del agente Python
const renderers = {};       // socket.id del agente Python -> socket.id del renderer de PC controlada

app.get("/", (req, res) => res.send("Xinoku Connect — Signaling Server activo."));

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Agente Python se registra ──
  socket.on("registrar", (codigo) => {
    sesiones[codigo] = socket.id;
    socket.data.codigo = codigo;
    console.log(`[REG] ${codigo} -> ${socket.id}`);
    socket.emit("registrado", { codigo });
  });

  // ── Renderer de PC controlada se registra con el ID del agente Python ──
  // Esto permite que el servidor sepa a qué socket enviarle los mensajes del controlador
  socket.on("registrar-renderer", ({ agenteId }) => {
    renderers[agenteId] = socket.id;
    socket.data.agenteId = agenteId;
    console.log(`[RENDERER] agenteId=${agenteId} -> rendererId=${socket.id}`);
    socket.emit("renderer-registrado", { ok: true });
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

  // ── Permiso ──
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    console.log(`[PERMISO] hacia=${hacia} aceptado=${aceptado}`);
    io.to(hacia).emit("permiso-respuesta", { aceptado });
  });

  // ── Frames ──
  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  // ── Mouse / teclado ──
  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ══════════════════════════════════════════════════════
  // CHAT
  // ══════════════════════════════════════════════════════

  // Controlador → PC controlada
  // El controlador emite hacia el agenteId (socket del agente Python)
  // El servidor reenvía TANTO al agente Python COMO al renderer de esa PC
  socket.on("chat", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT] de=${de} hacia=${hacia} msg="${mensaje}"`);
    // Enviar al agente Python (para que lo registre si necesita)
    io.to(hacia).emit("chat", { mensaje, de });
    // Enviar también al renderer de la PC controlada si está registrado
    const rendererId = renderers[hacia];
    if (rendererId) {
      console.log(`[CHAT] Reenviando al renderer ${rendererId}`);
      io.to(rendererId).emit("chat", { mensaje, de });
    }
  });

  // PC controlada → controlador (socketAgente emite chat-agente)
  socket.on("chat-agente", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT-AGENTE] de=${de} hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ══════════════════════════════════════════════════════
  // ARCHIVOS controlador → PC controlada
  // ══════════════════════════════════════════════════════
  socket.on("archivo-meta", ({ hacia, meta }) => {
    io.to(hacia).emit("archivo-meta", { meta });
    const rendererId = renderers[hacia];
    if (rendererId) io.to(rendererId).emit("archivo-meta-ctrl", { meta });
  });
  socket.on("archivo-chunk", ({ hacia, chunk }) => {
    io.to(hacia).emit("archivo-chunk", { chunk });
    const rendererId = renderers[hacia];
    if (rendererId) io.to(rendererId).emit("archivo-chunk-ctrl", { chunk });
  });
  socket.on("archivo-fin", ({ hacia }) => {
    io.to(hacia).emit("archivo-fin", {});
    const rendererId = renderers[hacia];
    if (rendererId) io.to(rendererId).emit("archivo-fin-ctrl", {});
  });
  socket.on("archivo-recibido", ({ hacia, nombre }) => {
    io.to(hacia).emit("archivo-recibido", { nombre });
  });

  // ══════════════════════════════════════════════════════
  // ARCHIVOS PC controlada → controlador
  // ══════════════════════════════════════════════════════
  socket.on("archivo-meta-agente",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta-agente",  { meta }));
  socket.on("archivo-chunk-agente", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk-agente", { chunk }));
  socket.on("archivo-fin-agente",   ({ hacia })        => io.to(hacia).emit("archivo-fin-agente",   {}));
  socket.on("archivo-recibido-ctrl",({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido",    { nombre }));

  // ══════════════════════════════════════════════════════
  // SESION — finalizar
  // ══════════════════════════════════════════════════════
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    console.log(`[FIN-AGENTE] hacia=${hacia}`);
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });

  socket.on("sesion-finalizada-por-controlador", ({ hacia }) => {
    console.log(`[FIN-CTRL] hacia=${hacia}`);
    io.to(hacia).emit("sesion-finalizada-por-controlador");
    const rendererId = renderers[hacia];
    if (rendererId) io.to(rendererId).emit("sesion-finalizada-por-controlador");
  });

  // ── Señalizacion WebRTC ──
  socket.on("oferta",        ({ hacia, oferta })    => io.to(hacia).emit("oferta",        { desde: socket.id, oferta }));
  socket.on("respuesta",     ({ hacia, respuesta }) => io.to(hacia).emit("respuesta",     { desde: socket.id, respuesta }));
  socket.on("ice-candidato", ({ hacia, candidato }) => io.to(hacia).emit("ice-candidato", { desde: socket.id, candidato }));

  // ── Desconexion ──
  socket.on("disconnect", () => {
    // Limpiar sesiones del agente
    for (const [codigo, id] of Object.entries(sesiones)) {
      if (id === socket.id) {
        delete sesiones[codigo];
        // Limpiar renderer asociado
        delete renderers[socket.id];
        console.log(`[-] Sesion ${codigo} eliminada`);
      }
    }
    // Limpiar renderer si era un renderer
    for (const [agenteId, rendererId] of Object.entries(renderers)) {
      if (rendererId === socket.id) {
        delete renderers[agenteId];
        console.log(`[-] Renderer de ${agenteId} desconectado`);
      }
    }
    console.log(`[-] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Connect — Signaling Server en puerto ${PORT}`);
});
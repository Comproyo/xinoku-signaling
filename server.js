const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 50e6
});

const PORT    = process.env.PORT || 3000;
const agentes  = {};   // codigo -> socket.id del agente Python
const renderers = {};  // socket.id del agente Python -> socket.id del renderer

app.get("/", (req, res) => res.send("Xinoku Connect — Signaling Server activo."));

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id}`);

  // Agente Python se registra
  socket.on("registrar", (codigo) => {
    agentes[codigo] = socket.id;
    socket.data.codigo = codigo;
    console.log(`[AGENTE] ${codigo} -> ${socket.id}`);
    socket.emit("registrado", { codigo });
  });

  // Renderer de PC controlada se registra con su codigo
  socket.on("registrar-renderer-por-codigo", ({ codigo }) => {
    const agenteId = agentes[codigo];
    if (!agenteId) {
      console.log(`[RENDERER] FAIL: ${codigo} no encontrado. Agentes:`, Object.keys(agentes));
      socket.emit("renderer-registrado", { ok: false });
      return;
    }
    renderers[agenteId] = socket.id;
    socket.data.agenteId = agenteId;
    console.log(`[RENDERER] OK: ${codigo} agenteId=${agenteId} rendererId=${socket.id}`);
    socket.emit("renderer-registrado", { ok: true, agenteId });
  });

  // Controlador quiere unirse
  socket.on("unirse", (codigo) => {
    const agenteId = agentes[codigo];
    if (!agenteId) {
      socket.emit("error-sesion", { mensaje: "Codigo no encontrado." });
      return;
    }
    console.log(`[JOIN] ctrl=${socket.id} -> agente=${agenteId}`);
    io.to(agenteId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: agenteId });
  });

  // Permiso aceptado/rechazado
  // Cuando el agente acepta, también envía su propio ID al controlador
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    console.log(`[PERMISO] hacia=${hacia} aceptado=${aceptado}`);
    if (aceptado) {
      // Le decimos al controlador el ID del agente que lo aceptó
      io.to(hacia).emit("permiso-respuesta", { aceptado, agenteId: socket.id });
    } else {
      io.to(hacia).emit("permiso-respuesta", { aceptado });
    }
  });

  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ── CHAT ──
  // Controlador -> PC controlada (agente + renderer)
  socket.on("chat", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT] de=${de} hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
    const rendererId = renderers[hacia];
    if (rendererId) {
      io.to(rendererId).emit("chat", { mensaje, de });
    } else {
      console.log(`[CHAT] Sin renderer para ${hacia}`);
    }
  });

  // PC controlada -> controlador
  socket.on("chat-agente", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT-AGENTE] hacia=${hacia} msg="${mensaje}"`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ── ARCHIVOS controlador -> PC controlada ──
  socket.on("archivo-meta", ({ hacia, meta }) => {
    io.to(hacia).emit("archivo-meta", { meta });
    const r = renderers[hacia];
    if (r) io.to(r).emit("archivo-meta-ctrl", { meta });
  });
  socket.on("archivo-chunk", ({ hacia, chunk }) => {
    io.to(hacia).emit("archivo-chunk", { chunk });
    const r = renderers[hacia];
    if (r) io.to(r).emit("archivo-chunk-ctrl", { chunk });
  });
  socket.on("archivo-fin", ({ hacia }) => {
    io.to(hacia).emit("archivo-fin", {});
    const r = renderers[hacia];
    if (r) io.to(r).emit("archivo-fin-ctrl", {});
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
    io.to(hacia).emit("sesion-finalizada-por-controlador");
    const r = renderers[hacia];
    if (r) io.to(r).emit("sesion-finalizada-por-controlador");
  });

  // ── Desconexion ──
  socket.on("disconnect", () => {
    for (const [codigo, id] of Object.entries(agentes)) {
      if (id === socket.id) {
        delete agentes[codigo];
        delete renderers[socket.id];
        console.log(`[-] Agente ${codigo} desconectado`);
      }
    }
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
  console.log(`Xinoku Signaling Server en puerto ${PORT}`);
});
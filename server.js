const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 100e6
});

const PORT         = process.env.PORT || 3000;
const grupos       = {};
const socketCodigo = {};
const controladores = {};

app.get("/", (req, res) => res.send("Xinoku Connect — Signaling Server activo."));

function enviarAGrupo(codigo, evento, data) {
  const grupo = grupos[codigo];
  if (!grupo) return;
  for (const sid of grupo) {
    io.to(sid).emit(evento, data);
  }
}

function codigoDeSocketId(socketId) {
  for (const [cod, grupo] of Object.entries(grupos)) {
    if (grupo.has(socketId)) return cod;
  }
  return socketCodigo[socketId] || null;
}

io.on("connection", (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on("registrar", (codigo) => {
    if (!grupos[codigo]) grupos[codigo] = new Set();
    grupos[codigo].add(socket.id);
    socketCodigo[socket.id] = codigo;
    socket.data.codigo = codigo;
    socket.data.tipo   = "agente";
    console.log(`[AGENTE] ${codigo} -> ${socket.id} | grupo: ${grupos[codigo].size}`);
    socket.emit("registrado", { codigo });
  });

  socket.on("registrar-renderer-por-codigo", ({ codigo }) => {
    if (!grupos[codigo]) {
      grupos[codigo] = new Set();
      console.log(`[RENDERER] Grupo ${codigo} creado por renderer`);
    }
    grupos[codigo].add(socket.id);
    socketCodigo[socket.id] = codigo;
    socket.data.codigo = codigo;
    socket.data.tipo   = "renderer";
    console.log(`[RENDERER] OK: ${codigo} id=${socket.id} | grupo: ${grupos[codigo].size}`);
    socket.emit("renderer-registrado", { ok: true });
  });

  socket.on("unirse", (codigo) => {
    if (!grupos[codigo] || grupos[codigo].size === 0) {
      socket.emit("error-sesion", { mensaje: "Codigo no encontrado." });
      return;
    }
    let agenteId = null;
    for (const sid of grupos[codigo]) {
      const s = io.sockets.sockets.get(sid);
      if (s?.data?.tipo === "agente") { agenteId = sid; break; }
    }
    if (!agenteId) agenteId = [...grupos[codigo]][0];
    controladores[codigo] = socket.id;
    socket.data.codigo    = codigo;
    socket.data.tipo      = "controlador";
    socket.data.agenteId  = agenteId;
    console.log(`[JOIN] ctrl=${socket.id} -> grupo=${codigo} agente=${agenteId}`);
    io.to(agenteId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: agenteId });
  });

  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    if (aceptado) {
      io.to(hacia).emit("permiso-respuesta", { aceptado, agenteId: socket.id });
    } else {
      io.to(hacia).emit("permiso-respuesta", { aceptado });
    }
  });

  socket.on("frame", ({ hacia, frame, pantalla_w, pantalla_h, frame_w, frame_h }) => {
    io.to(hacia).emit("frame", { frame, pantalla_w, pantalla_h, frame_w, frame_h });
  });

  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // Chat
  socket.on("chat", ({ hacia, mensaje, de }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "chat", { mensaje, de });
    else io.to(hacia).emit("chat", { mensaje, de });
  });
  socket.on("chat-agente", ({ hacia, mensaje, de }) => {
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // Archivos ctrl -> PC
  socket.on("archivo-meta", ({ hacia, meta }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "archivo-meta", { meta });
    else io.to(hacia).emit("archivo-meta", { meta });
  });
  socket.on("archivo-chunk", ({ hacia, chunk }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "archivo-chunk", { chunk });
    else io.to(hacia).emit("archivo-chunk", { chunk });
  });
  socket.on("archivo-fin", ({ hacia }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "archivo-fin", {});
    else io.to(hacia).emit("archivo-fin", {});
  });
  socket.on("archivo-recibido", ({ hacia, nombre }) => {
    io.to(hacia).emit("archivo-recibido", { nombre });
  });

  // Archivos PC -> ctrl
  socket.on("archivo-meta-agente",   ({ hacia, meta })   => io.to(hacia).emit("archivo-meta-agente",  { meta }));
  socket.on("archivo-chunk-agente",  ({ hacia, chunk })  => io.to(hacia).emit("archivo-chunk-agente", { chunk }));
  socket.on("archivo-fin-agente",    ({ hacia })         => io.to(hacia).emit("archivo-fin-agente",   {}));
  socket.on("archivo-recibido-ctrl", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido",     { nombre }));

  // ── LLAMADA DE VOZ — señalización WebRTC ──
  // El controlador inicia la llamada hacia el grupo
  socket.on("llamada-oferta", ({ hacia, oferta }) => {
    console.log(`[LLAMADA] oferta de ${socket.id} hacia ${hacia}`);
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "llamada-oferta", { de: socket.id, oferta });
    else io.to(hacia).emit("llamada-oferta", { de: socket.id, oferta });
  });

  socket.on("llamada-respuesta", ({ hacia, respuesta }) => {
    console.log(`[LLAMADA] respuesta de ${socket.id} hacia ${hacia}`);
    io.to(hacia).emit("llamada-respuesta", { de: socket.id, respuesta });
  });

  socket.on("llamada-ice", ({ hacia, candidato }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "llamada-ice", { de: socket.id, candidato });
    else io.to(hacia).emit("llamada-ice", { de: socket.id, candidato });
  });

  socket.on("llamada-colgar", ({ hacia }) => {
    console.log(`[LLAMADA] colgar de ${socket.id} hacia ${hacia}`);
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "llamada-colgar", { de: socket.id });
    else io.to(hacia).emit("llamada-colgar", { de: socket.id });
  });

  socket.on("llamada-rechazar", ({ hacia }) => {
    io.to(hacia).emit("llamada-rechazar", { de: socket.id });
  });

  // Sesion
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });
  socket.on("sesion-finalizada-por-controlador", ({ hacia }) => {
    const cod = codigoDeSocketId(hacia);
    if (cod) enviarAGrupo(cod, "sesion-finalizada-por-controlador", {});
    else io.to(hacia).emit("sesion-finalizada-por-controlador");
  });

  socket.on("disconnect", () => {
    const codigo = socketCodigo[socket.id];
    if (codigo && grupos[codigo]) {
      grupos[codigo].delete(socket.id);
      if (grupos[codigo].size === 0) {
        delete grupos[codigo];
        console.log(`[-] Grupo ${codigo} eliminado`);
      } else {
        console.log(`[-] ${socket.id} removido de grupo ${codigo}. Quedan: ${grupos[codigo].size}`);
      }
    }
    delete socketCodigo[socket.id];
    console.log(`[-] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Signaling Server en puerto ${PORT}`);
});

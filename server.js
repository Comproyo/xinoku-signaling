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
  console.log(`[+] ${socket.id}`);

  // Agente registra su codigo
  socket.on("registrar", (codigo) => {
    sesiones[codigo] = socket.id;
    socket.data.codigo = codigo;
    console.log(`[REG] ${codigo} -> ${socket.id}`);
    socket.emit("registrado", { codigo });
  });

  // Controlador quiere conectarse
  socket.on("unirse", (codigo) => {
    const agenteId = sesiones[codigo];
    if (!agenteId) {
      socket.emit("error-sesion", { mensaje: "Codigo no encontrado." });
      return;
    }
    console.log(`[JOIN] ${socket.id} -> agente ${agenteId}`);
    io.to(agenteId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: agenteId });
  });

  // Permiso aceptado/rechazado
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    io.to(hacia).emit("permiso-respuesta", { aceptado });
  });

  // Frames
  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  // Mouse / teclado
  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ── CHAT — preservar campo "de" ──
  socket.on("chat", ({ hacia, mensaje, de }) => {
    console.log(`[CHAT] de=${de} hacia=${hacia} msg=${mensaje}`);
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ── Archivos: controlador → agente ──
  socket.on("archivo-meta",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta",  { meta }));
  socket.on("archivo-chunk", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk", { chunk }));
  socket.on("archivo-fin",   ({ hacia })        => io.to(hacia).emit("archivo-fin",   {}));
  socket.on("archivo-recibido", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido", { nombre }));

  // ── Archivos: agente → controlador ──
  socket.on("archivo_meta_agente",  ({ hacia, meta })  => io.to(hacia).emit("archivo_meta_agente",  { meta }));
  socket.on("archivo_chunk_agente", ({ hacia, chunk }) => io.to(hacia).emit("archivo_chunk_agente", { chunk }));
  socket.on("archivo_fin_agente",   ({ hacia })        => io.to(hacia).emit("archivo_fin_agente",   {}));

  // ── Agente finaliza sesion ──
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });

  // Señalizacion WebRTC (por si acaso)
  socket.on("oferta",        ({ hacia, oferta })    => io.to(hacia).emit("oferta",        { desde: socket.id, oferta }));
  socket.on("respuesta",     ({ hacia, respuesta }) => io.to(hacia).emit("respuesta",     { desde: socket.id, respuesta }));
  socket.on("ice-candidato", ({ hacia, candidato }) => io.to(hacia).emit("ice-candidato", { desde: socket.id, candidato }));

  socket.on("disconnect", () => {
    for (const [codigo, id] of Object.entries(sesiones)) {
      if (id === socket.id) {
        delete sesiones[codigo];
        console.log(`[-] Sesion ${codigo} eliminada`);
      }
    }
    console.log(`[-] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Signaling Server en puerto ${PORT}`);
});
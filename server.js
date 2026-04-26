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
const sesiones = {};

app.get("/", (req, res) => {
  res.send("Xinoku Connect — Signaling Server activo.");
});

io.on("connection", (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── Registro del agente ──
  socket.on("registrar", (codigo) => {
    sesiones[codigo] = socket.id;
    console.log(`[REGISTRO] Codigo ${codigo} -> ${socket.id}`);
    socket.emit("registrado", { codigo });
  });

  // ── Controlador quiere unirse ──
  socket.on("unirse", (codigo) => {
    const destinoId = sesiones[codigo];
    if (!destinoId) {
      socket.emit("error-sesion", { mensaje: "Codigo de sesion no encontrado." });
      return;
    }
    console.log(`[UNION] ${socket.id} -> ${destinoId}`);
    io.to(destinoId).emit("solicitud-conexion", { desde: socket.id });
    socket.emit("sesion-encontrada", { hacia: destinoId });
  });

  // ── Señalizacion WebRTC ──
  socket.on("oferta",        ({ hacia, oferta })    => io.to(hacia).emit("oferta",        { desde: socket.id, oferta }));
  socket.on("respuesta",     ({ hacia, respuesta }) => io.to(hacia).emit("respuesta",     { desde: socket.id, respuesta }));
  socket.on("ice-candidato", ({ hacia, candidato }) => io.to(hacia).emit("ice-candidato", { desde: socket.id, candidato }));

  // ── Permiso ──
  socket.on("permiso-respuesta", ({ hacia, aceptado }) => {
    io.to(hacia).emit("permiso-respuesta", { aceptado });
  });

  // ── Frames de pantalla ──
  socket.on("frame", ({ hacia, frame }) => {
    io.to(hacia).emit("frame", { frame });
  });

  // ── Control mouse / teclado ──
  socket.on("accion_mouse",   (data) => io.to(data.hacia).emit("accion_mouse",   data));
  socket.on("accion_teclado", (data) => io.to(data.hacia).emit("accion_teclado", data));

  // ── Chat — CORREGIDO: pasar el campo "de" original ──
  socket.on("chat", ({ hacia, mensaje, de }) => {
    io.to(hacia).emit("chat", { mensaje, de });
  });

  // ── Transferencia de archivos: controlador → PC controlada ──
  socket.on("archivo-meta",  ({ hacia, meta })  => io.to(hacia).emit("archivo-meta",  { meta }));
  socket.on("archivo-chunk", ({ hacia, chunk }) => io.to(hacia).emit("archivo-chunk", { chunk }));
  socket.on("archivo-fin",   ({ hacia })        => io.to(hacia).emit("archivo-fin",   {}));
  socket.on("archivo-recibido", ({ hacia, nombre }) => io.to(hacia).emit("archivo-recibido", { nombre }));

  // ── Transferencia de archivos: PC controlada → controlador ──
  socket.on("archivo_meta_agente",  ({ hacia, meta })  => io.to(hacia).emit("archivo_meta_agente",  { meta }));
  socket.on("archivo_chunk_agente", ({ hacia, chunk }) => io.to(hacia).emit("archivo_chunk_agente", { chunk }));
  socket.on("archivo_fin_agente",   ({ hacia })        => io.to(hacia).emit("archivo_fin_agente",   {}));

  // ── PC controlada finaliza la sesion ──
  socket.on("sesion-finalizada-por-agente", ({ hacia }) => {
    io.to(hacia).emit("sesion-finalizada-por-agente");
  });

  // ── Desconexion ──
  socket.on("disconnect", () => {
    for (const [codigo, id] of Object.entries(sesiones)) {
      if (id === socket.id) {
        delete sesiones[codigo];
        console.log(`[-] Sesion ${codigo} eliminada.`);
      }
    }
    console.log(`[-] Desconectado: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Xinoku Connect — Signaling Server corriendo en http://localhost:${PORT}`);
});
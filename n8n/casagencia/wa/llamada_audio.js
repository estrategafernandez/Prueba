// [TEL] Llamada al panel · ComoAudio
// Retell sirve la grabacion como "fichero" (application/octet-stream), y asi
// Chatwoot la pone para descargar. Marcandola como audio, el panel la muestra
// con su reproductor dentro de la conversacion.
const item = $input.first();
const b = item.binary?.data;
if (b) {
  const ext = String(b.fileExtension || String(b.fileName || '').split('.').pop() || 'wav').toLowerCase();
  const TIPOS = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' };
  const l = $('LeerLlamada').first().json;
  b.mimeType = TIPOS[ext] || 'audio/wav';
  b.fileExtension = TIPOS[ext] ? ext : 'wav';
  b.fileName = `llamada-${String(l.inicio_nombre || 'grabacion')}.${b.fileExtension}`;
}
return [item];

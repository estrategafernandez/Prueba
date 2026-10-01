// [TEL] Llamada al panel · LeerLlamada
// Llega la llamada del asistente telefonico tal y como la manda Retell al
// terminar (call_analyzed). Aqui se prepara la nota que se pone en la
// conversacion del cliente en el panel, igual que en las otras agencias:
//
//   LLAMADA DE LA IA — Colgó el cliente
//   Nos llamó · +34600000000 · 1/10 a las 16:51 · 2 min 39 s
//
//   <resumen de la llamada>
//
//   Tono del cliente: positivo
const raw = $('Start').first().json.llamada;
let c = {};
try { c = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (e) { c = {}; }
const a = c.call_analysis || {};

const entrante = String(c.direction || 'inbound') !== 'outbound';
const tel = normalizarTelefono(entrante ? c.from_number : c.to_number);

const COLGO = {
  agent_hangup: 'Colgó la IA',
  user_hangup: 'Colgó el cliente',
  call_transfer: 'Pasada a una persona',
  voicemail_reached: 'Saltó el buzón de voz',
  inactivity: 'Sin respuesta del cliente',
  max_duration_reached: 'Duración máxima',
  dial_no_answer: 'No contestó',
  dial_busy: 'Comunicando',
};
const TONO = { Positive: 'positivo', Negative: 'negativo', Neutral: 'neutro', Unknown: 'no se sabe' };

const inicio = c.start_timestamp ? DateTime.fromMillis(Number(c.start_timestamp), { zone: ZONA }) : null;
const seg = Math.round(Number(c.duration_ms || 0) / 1000);
const duracion = seg >= 60 ? `${Math.floor(seg / 60)} min ${seg % 60} s` : `${seg} s`;
const asesoraLlamada = String(a.custom_analysis_data?.asesora ?? '').trim();
const asesora = EQUIPO[asesoraLlamada] ? asesoraLlamada : '';
const resumen = String(a.call_summary ?? '').trim();
const tono = TONO[a.user_sentiment] || '';

const nota = [
  `LLAMADA DE LA IA — ${COLGO[c.disconnection_reason] || 'Terminada'}`,
  [entrante ? 'Nos llamó' : 'Le llamamos', tel.e164 || 'número oculto',
   inicio ? `${inicio.day}/${inicio.month} a las ${inicio.toFormat('HH:mm')}` : '', duracion]
    .filter(Boolean).join(' · '),
  '',
  resumen || 'Sin resumen de la llamada.',
  '',
  tono ? `Tono del cliente: ${tono}` : '',
  asesora ? `Asesora: ${asesora}` : '',
].join('\n').replace(/\n{3,}/g, '\n\n').trim();

// La transcripcion, para sacar el nombre del cliente (con un tope)
const transcripcion = String(c.transcript ?? '').slice(0, 12000);

return [{ json: {
  call_id: String(c.call_id || ''),
  telefono_e164: tel.e164,
  telefono_wa: tel.wa_id,
  telefono_valido: tel.valido,
  asesora,
  agente_id: esPrueba(tel.e164) ? 0 : agenteDe(asesora),
  segundos: seg,
  resumen,
  nota,
  grabacion: String(c.recording_url || ''),
  transcripcion,
  hay_transcripcion: transcripcion.trim().length > 40,
  // El aviso por WhatsApp a la comercial, solo si ha habido conversacion
  avisar: !!asesora && seg >= LLAMADA_AVISO_MIN_SEGUNDOS,
} }];

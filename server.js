// server.js
// Backend proxy: recibe el PDF en base64 desde la extensión,
// llama a la API de Claude usando la API KEY guardada en el servidor
// (nunca se expone al navegador del usuario) y devuelve el texto del análisis.

const express = require('express');
const cors = require('cors');

const app = express();

// Aumentamos el límite porque los PDFs en base64 pueden pesar varios MB
app.use(express.json({ limit: '15mb' }));

// CORS: permite que la extensión (y opcionalmente cualquier origen) llame a este backend.
// Si quieres restringirlo más adelante, cambia origin: '*' por la lista de orígenes permitidos.
app.use(cors({ origin: '*' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

if (!ANTHROPIC_API_KEY) {
  console.error('⚠️  Falta la variable de entorno ANTHROPIC_API_KEY. Configúrala en Render → Environment.');
}

// Salud del servicio (útil para confirmar que Render lo desplegó bien)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SOA PAS Validator Backend' });
});

// Endpoint principal: recibe { base64, fechaHoy } y devuelve { texto }
app.post('/validar-pas', async (req, res) => {
  try {
    const { base64, fechaHoy } = req.body;

    if (!base64) {
      return res.status(400).json({ error: 'Falta el campo base64 (PDF en base64).' });
    }
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada ANTHROPIC_API_KEY.' });
    }

    const fecha = fechaHoy || new Date().toLocaleDateString('es-DO');

    const promptText = `Eres un validador de formularios. Analiza este formulario PAS de SeNaSa y genera un reporte EXACTAMENTE en este formato, sin agregar texto extra:

La fecha de hoy es: ${fecha}

---
## DATOS GENERALES
Muestra solo los campos vacíos con ❌. Si todos están completos escribe: ✅ DATOS GENERALES COMPLETOS
Campos a validar: Fecha, Tipo de plan, Plan, Forma de pago, Frecuencia de pago, Tipo Novedad.

---
## DATOS DEL TITULAR
Muestra solo los campos vacíos con ❌. Si todos están completos escribe: ✅ DATOS DEL TITULAR COMPLETOS
Campos a validar con su valor:
✅/❌ Nombres:
✅/❌ Apellidos:
✅/❌ Peso:
✅/❌ Estatura:
✅/❌ Tipo Doc. Identidad:
✅/❌ No. Documento:
✅/❌ Edad:
✅/❌ Estado Civil:
✅/❌ Ocupación:
✅/❌ Correo:
✅/❌ Dirección:
✅/❌ Teléfono 1:
✅/❌ Teléfono 2: (este campo es opcional, no lo marques como error)

---
## DECLARACIÓN DE SALUD
Para cada pregunta indica si tiene marcado SÍ o NO. Si alguna pregunta tiene SÍ marcado, indica el detalle entre paréntesis. Si todas están marcadas escribe al final: ✅ CASILLAS DECLARACIÓN COMPLETADAS
✅/❌ Pregunta 1: (SÍ/NO)
✅/❌ Pregunta 2: (SÍ/NO)
✅/❌ Pregunta 3: (SÍ/NO)
✅/❌ Pregunta 4: (SÍ/NO)
✅/❌ Pregunta 5: (SÍ/NO)
✅/❌ Pregunta 6: (SÍ/NO)
✅/❌ Pregunta 7: (SÍ/NO)
✅/❌ Pregunta 8: (SÍ/NO)
✅/❌ Pregunta 9: (SÍ/NO)
✅/❌ Pregunta 10: (SÍ/NO)
✅/❌ Pregunta 11: (SÍ/NO)
✅/❌ Pregunta 12: (SÍ/NO)
✅/❌ Pregunta 13: (SÍ/NO)
✅/❌ Pregunta 14: (SÍ/NO)
✅/❌ Pregunta 15: (SÍ/NO)
✅/❌ Pregunta 16: (SÍ/NO)
✅/❌ Pregunta 17: (SÍ/NO)
✅/❌ Pregunta 18: (SÍ/NO)
✅/❌ Pregunta 19: (SÍ/NO)

---
## DEPENDIENTES
Si NO hay ningún nombre en la sección IV, escribe: ⏭️ SIN DEPENDIENTES REGISTRADOS (no validar)
Si HAY al menos un nombre, valida que cada fila con nombre tenga también: Apellido, Edad, Peso, Estatura, Sexo, Fecha de Nacimiento y Parentesco.
Si todos los campos están completos escribe: ✅ CAMPOS DEPENDIENTES COMPLETADOS CORRECTAMENTE
Si algún campo falta escribe: ❌ CAMPO DEPENDIENTE PENDIENTE DE REGISTRO e indica cuál fila y qué campo falta.

---
## FIRMAS
Si existe firma del titular escribe: ✅ FIRMA DEL TITULAR PRESENTE
Si no existe escribe: ❌ FIRMA DEL TITULAR AUSENTE
Si existe firma del representante escribe: ✅ FIRMA DEL REPRESENTANTE PRESENTE
Si no existe escribe: ❌ FIRMA DEL REPRESENTANTE AUSENTE

---
## VALIDACIÓN DE FECHA
1. Busca la fecha de firma del formulario (generalmente al final del documento).
2. Busca la fecha de la página 1 (Datos Generales).
3. Verifica que la fecha de firma NO sea anterior a la fecha de datos generales. Si es anterior escribe: ❌ FECHA DE FIRMA ANTERIOR A FECHA DEL FORMULARIO
4. Verifica que la fecha de firma NO tenga más de 1 mes de diferencia con la fecha de hoy (${fecha}). Si tiene más de un mes escribe: ❌ FORMULARIO VENCIDO - Firmado hace más de un mes
5. Si todo está correcto escribe: ✅ FECHA DE FIRMA VÁLIDA

---
## RESULTADO FINAL
Escribe: FORMULARIO COMPLETO o FORMULARIO INCOMPLETO según corresponda.`;

    const claudeResponse = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 }
            },
            { type: 'text', text: promptText }
          ]
        }]
      })
    });

    const data = await claudeResponse.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message });
    }

    const texto = data.content?.[0]?.text || 'Sin respuesta de Claude.';
    res.json({ texto });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

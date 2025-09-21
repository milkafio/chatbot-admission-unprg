const OpenAI = require("openai");
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configuración
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ 1. Verificación del webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ 2. Recibir mensajes entrantes (POST)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from; // número del usuario
    const text = message?.text?.body; // mensaje entrante

    if (text) {
      console.log(`📩 Mensaje recibido de ${from}: ${text}`);

      // Consultar a GPT
      const answer = await consultarAsistente(text);

      // Responder por WhatsApp
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: answer },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ✅ 3. Función para consultar al Asistente (tu GPT entrenado)
async function consultarAsistente(userMessage) {
    console.log("👉 Creando thread...");
    const thread = await client.beta.threads.create();

    console.log("👉 Enviando mensaje al thread...");
    await client.beta.threads.messages.create(thread.id, {
    role: "user",
    content: userMessage
    });

    console.log("👉 Ejecutando asistente...");
    const run = await client.beta.threads.runs.create(thread.id, {
    assistant_id: ASSISTANT_ID
    });

    // Esperar a que termine
    let runStatus;
    do {
    runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
    console.log("⏳ Estado:", runStatus.status);
    if (runStatus.status !== "completed") {
        await new Promise(r => setTimeout(r, 1000));
    }
    } while (runStatus.status !== "completed");

    console.log("✅ Run completado");

    // Obtener respuesta
    const messages = await client.beta.threads.messages.list(thread.id);
    const answer = messages.data[0].content[0].text.value;

    console.log(answer)
    
    return answer;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

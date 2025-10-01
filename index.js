const OpenAI = require("openai");
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const processedMessages = new Set();

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_TOKEN) {
    console.log("Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // 👉 responder rápido para que Meta no reintente

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return; // filtrar solo texto

    if (processedMessages.has(message.id)) {
      return;
    }
    processedMessages.add(message.id);

    const from = message.from;
    const text = message.text.body;

    console.log(`Mensaje recibido de ${from}: ${text}`);

    const answer = await consultarAsistente(text);
    console.log("Respuesta a wssp: ", answer);
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

  } catch (err) {
    console.error("Error procesando mensaje:", err.response?.data || err.message);
  }
});

async function consultarAsistente(userMessage) {
    console.log("Creando thread...");
    const thread = await client.beta.threads.create();

    await client.beta.threads.messages.create(thread.id, {
    role: "user",
    content: userMessage
    });

    console.log("Ejecutando asistente...");
    const run = await client.beta.threads.runs.create(thread.id, {
    assistant_id: ASSISTANT_ID
    });

    let runStatus;
    do {
    runStatus = await client.beta.threads.runs.retrieve(thread.id, run.id);
    console.log("Estado:", runStatus.status);

    if (runStatus.status !== "completed") {
        await new Promise(r => setTimeout(r, 1000));
    }
    } while (runStatus.status !== "completed");

    console.log("Run completado");

    const messages = await client.beta.threads.messages.list(thread.id);
    const answer = messages.data[0].content[0].text.value;

    console.log("Respuesta asistente: ", answer);

    return sanitizeMessage(answer);
}

function sanitizeMessage(message) {
  return message.replace(/【.*?source】/g, "").trim()
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mongoose from "mongoose";
import Chat from "./models/ChatModel.js";
import dotenv from "dotenv";
dotenv.config();
const port = 1235;
const app = express();

mongoose.connect(process.env.MONGO_URI);
mongoose.connection.on("connected", () => {
  console.log("connected to mongodb atlas");
});
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const generateChatTitle = async (userMessage, botResponse) => {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPEN_API_KEY });

    const titleCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate a short, 2 or 3 word title for this conversation without any quotes.",
        },
        {
          role: "user",
          content: `User: ${userMessage}\nBot: ${botResponse}`,
        },
      ],
      max_tokens: 7,
    });
    console.log(titleCompletion.choices[0].message.content.trim());

    return titleCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating chat title:", error.message);
    return "New Chat";
  }
};

const callChatGPT = async (messages, selectedBot) => {
  if (selectedBot !== "ChatGPT") {
    return callGemini(messages);
  }

  const openai = new OpenAI({
    apiKey: process.env.OPEN_API_KEY,
  });
  const formattedMessages = messages.map((msg) => ({
    role: msg.sender === "bot" ? "assistant" : "user",
    content: msg.text,
  }));
  // console.log(formattedMessages[0]);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "developer", content: "You are a helpful assistant." },
        ...formattedMessages,
      ],
      store: true,
    });
    const result = completion.choices[0].message.content;

    return { success: true, data: result };
  } catch (e) {
    return callGemini(messages);
  }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const callGemini = async (messages) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const chatHistory = messages.map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text || "" }],
    }));

    // console.log(chatHistory);

    const result = await model.generateContent({
      contents: chatHistory,
    });
    // console.log(result);

    const responseText =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    return { success: true, data: responseText };
  } catch (error) {
    // console.log("Gemini API Error:", error.message);
    return { success: false, error: error.message };
  }
};

app.get("/", async (req, res) => {
  //give chat history
  const chats = await Chat.find({}, "id title");

  // Send response as an array of objects
  res.status(200).json(chats);
});

app.post("/chat", async (req, res) => {
  const { id, title, message } = req.body.chat;

  //Save the new chat in DB with ID
  const chat = new Chat({
    id,
    title,
    messages: [message],
  });
  await chat.save();

  return res.status(200).json({ message: "saved chat successfully" });
});

app.get("/chat/:id", async (req, res) => {
  const chatId = req.params.id;
  const chat = await Chat.findOne({ id: chatId });
  const messages = chat.messages;
  res.status(200).json(messages);
});

app.put("/chat/:id", async (req, res) => {
  const chatId = req.params.id;
  const { selectedBot, message } = req.body.chat;
  console.log(selectedBot);

  const chat = await Chat.findOne({ id: chatId });
  //   console.log(chat);

  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }
  chat.messages.push(message);
  await chat.save();

  //now call with this user msg
  //   console.log(chat.messages);

  //   const userMessage = message.text;
  //   const response = await callGemini(chat.messages);
  const response = await callChatGPT(chat.messages, selectedBot);
  if (chat.messages.length === 2) {
    //   console.log("mamamamamam");

    const chatTitle = await generateChatTitle(
      chat.messages[1].text,
      response.data
    );
    chat.title = chatTitle;
  }

  if (response.success) {
    //send to user and save it to db
    // console.log(response.success);

    res.status(200).json({ data: { text: response.data, sender: "bot" } });
    chat.messages.push({ text: response.data, sender: "bot" });
    // console.log(response.data.content);

    await chat.save();
  } else {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  //   res.status(200).json({ message: "Welcome" });
  console.log(`listening on port ${port}`);
});

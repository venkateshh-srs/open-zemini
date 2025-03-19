import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

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

// Weather api
async function getWeather(latitude, longitude) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`
  );
  const data = await response.json();
  console.log("weather" + data);

  return data.current.temperature_2m;
}

const tools = [
  {
    type: "function",
    function: {
      name: "getWeather",
      description:
        "Get current temperature for provided coordinates in celsius.",
      parameters: {
        type: "object",
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
        required: ["latitude", "longitude"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

const weatherDeclaration = {
  name: "getWeather",
  description:
    "Get current temperature for provided coordinates in Celsius.Figure out latitude and longitude based on city name if they are not provided",
  parameters: {
    type: "object",
    properties: {
      latitude: { type: "number", description: "Latitude of the location" },
      longitude: { type: "number", description: "Longitude of the location" },
    },
    required: ["latitude", "longitude"],
  },
};

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
    // console.log(titleCompletion.choices[0].message.content.trim());

    return titleCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating chat title:", error.message);
    return "New Chat";
  }
};

const weatherDataFunctionCall = async (completion, formattedMessages) => {
  console.log("call for weather");

  const toolCall = completion.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);

  const openai = new OpenAI({ apiKey: process.env.OPEN_API_KEY });

  const result = await getWeather(args.latitude, args.longitude);

  formattedMessages.push(completion.choices[0].message);
  formattedMessages.push({
    // append result message
    role: "tool",
    tool_call_id: toolCall.id,
    content: result.toString(),
  });

  const completion2 = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "developer", content: "You are a helpful assistant." },
      ...formattedMessages,
    ],
    tools,
    store: true,
  });
  const result2 = completion2.choices[0].message.content;

  return { success: true, data: result2 };
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
      tools,
      store: true,
    });
    // console.log(completion.choices[0].message.tool_calls);
    if (completion.choices[0].message.content === null) {
      return weatherDataFunctionCall(completion, formattedMessages);
    }
    const result = completion.choices[0].message.content;

    return { success: true, data: result };
  } catch (e) {
    return callGemini(messages);
  }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const callGemini = async (messages) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const chatHistory = messages.map((msg) => ({
      role: msg.sender === "user" ? "user" : "model",
      parts: [{ text: msg.text || "" }],
    }));
    chatHistory.shift();
    const chat = model.startChat({
      tools: [{ function_declarations: [weatherDeclaration] }],
      history: chatHistory,
    });
    const userMessage = messages[messages.length - 1].text;
    const result = await chat.sendMessage(userMessage);

    const func = result.response.functionCalls();
    console.log(func);
    let call;
    if (func) call = func[0];
    console.log(call);

    if (call) {
      console.log("heyyya");

      let apiResponse;
      console.log("Function Name: ", call.args);
      if (call.name == "getWeather") {
        apiResponse = await getWeather(call.args.latitude, call.args.longitude);
        apiResponse = {
          temperature: apiResponse,
        };
        // console.log(apiResponse);
      }

      console.log(apiResponse);
      const result2 = await chat.sendMessage([
        {
          functionResponse: {
            name: "getWeather",
            response: apiResponse,
          },
        },
      ]);
      console.log(result2);

      return {
        success: true,
        data: result2.response?.candidates?.[0]?.content?.parts?.[0]?.text,
      };
    }

    const responseText =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    // console.log(result.response.candidates[0].content.parts[0].text);

    return { success: true, data: responseText };
  } catch (error) {
    console.log("Gemini API Error:", error.message);
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
  //   console.log(selectedBot);

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
const openai = new OpenAI({
  apiKey: process.env.OPEN_API_KEY,
});
const GanttTaskSchema = z.object({
  isValid: z.boolean(),
  message: z.string(),
  tasks: z.array(
    z.object({
      id: z.number(),
      text: z.string(),
      start_date: z.string(),
      duration: z.number(),
      progress: z.number(),
      user_ids: z.array(z.number()),
    })
  ),
  users: z.array(
    z.object({
      key: z.number(),
      label: z.string(),
    })
  ),
  links: z.array(
    z.object({
      id: z.number(),
      source: z.number(),
      target: z.number(),
      type: z.enum(["0", "1", "2", "3"]),
    })
  ),
});

async function generateGanttJson(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content:
            "Generate a Gantt chart JSON strictly following the given schema.Using dhtmlx library. If the user input is vague, gibberish, or unrelated to a project timeline, set `isValid: false`, provide an appropriate error message in `message`, and leave `tasks`,`users` and `links` as an empty array. Otherwise, set `isValid: true` and generate a valid Gantt chart with given details or Generate an example gantt chart if user asks for it",
        },
        { role: "user", content: `Create a Gantt chart for: ${prompt}` },
      ],
      response_format: zodResponseFormat(GanttTaskSchema, "gantt_chart"),
    });

    const ganttChart = completion.choices[0].message.content;
    const ganttData = JSON.parse(ganttChart);
    console.log(ganttData);

    return ganttData;
  } catch (error) {
    console.error("Error generating Gantt chart JSON:", error);

    return { error: "Failed to generate JSON. Please provide more details." };
  }
}

app.post("/generate-gantt", async (req, res) => {
  const userInput = req.body.input;
  console.log(userInput);
  const ganttJson = await generateGanttJson(userInput);

  res.json(ganttJson);

  // res.status(200).json({ message: "Hello got it" });
});

app.listen(port, () => {
  //   res.status(200).json({ message: "Welcome" });

  console.log(`listening on port ${port}`);
});

import React, { useState, useEffect, useRef } from "react";
import { FiSidebar } from "react-icons/fi";
import { IoIosAddCircle } from "react-icons/io";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
// import ReactMarkdown from "react-markdown";
import Markdown from "markdown-to-jsx";

function App() {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState([
    { text: "Hello! How can I assist you today?", sender: "bot" },
  ]);
  const [selectedChatID, setSelectedChatID] = useState(-1);
  const [input, setInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [selectedBot, setSelectedBot] = useState("ChatGPT");
  const [showMessageLoader, setShowMessageLoader] = useState(false);
  const [showChatHistoryLoader, setShowChatHistoryLoader] = useState(false);

  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    getChatHistory();
    inputRef.current.focus();
  }, []);

  const getChatHistory = async () => {
    setShowChatHistoryLoader(true);
    try {
      const chats = await axios.get(process.env.BACKEND_URL);
      // console.log(chats.data);
      setShowChatHistoryLoader(false);

      setChatHistory(chats.data);
    } catch (e) {}
  };
  const getSelectedChat = async (id) => {
    const chat = await axios.get(process.env.BACKEND_URL + "/chat/" + id);
    // console.log(chat.data);
    const selectedChatMessages = chat.data;
    setMessages(selectedChatMessages);
  };
  const chatEndRef = useRef(null);

  const selectChat = (id) => {
    setSelectedChatID(id);
    getSelectedChat(id);
    inputRef.current.focus();
  };

  const createNewChat = async (newID) => {
    try {
      await axios.post(process.env.BACKEND_URL + "/chat", {
        chat: {
          id: newID,
          title: `Chat ${chatHistory.length + 1}`,
          message: {
            text: "Hello! How can I assist you today?",
            sender: "bot",
          },
        },
      });
    } catch {
      // console.log("server erorr");
    }
  };

  const askBot = async (chatID, input) => {
    try {
      const result = await axios.put(
        process.env.BACKEND_URL + "/chat/" + chatID,
        {
          chat: {
            selectedBot,
            message: {
              text: input,
              sender: "user",
            },
          },
        }
      );
      const message = result.data.data.text;

      return { message, chatID };
    } catch {
      // console.log(error.messsage);
      return "server error";
    }
  };
  const sendMessage = async () => {
    if (input.trim() !== "") {
      setInput("");
      inputRef.current.focus();
      let newID = selectedChatID;
      if (selectedChatID === -1) {
        //append new chat to db
        const randomID = uuidv4();
        newID = randomID;
        setChatHistory((prev) => [
          ...prev,
          {
            id: newID,
            title: `Chat ${chatHistory.length + 1}`,
          },
        ]);

        setSelectedChatID(() => newID);
        await createNewChat(newID);
      }
      // render usr msg on screen
      setMessages((prev) => [...prev, { text: input, sender: "user" }]);

      setShowMessageLoader(true);

      const response = await askBot(newID, input);

      const queryResponse = response.message;
      setShowMessageLoader(false);
      if (messages.length === 1) getChatHistory();
      if (response.chatID === newID)
        setMessages((prev) => [
          ...prev,
          { text: queryResponse, sender: "bot" },
        ]);

      // console.log(updated);
    }
  };
  const addNewChat = () => {
    setMessages([
      { text: "Hello! How can I assist you today?", sender: "bot" },
    ]);
    setSelectedChatID(-1);
    inputRef.current.focus();
  };
  return (
    <div className="container">
      <div className={`sidebar ${isOpen ? "open" : "closed"}`}>
        {isOpen ? (
          <>
            <div className="new-chat" onClick={addNewChat}>
              <div>
                <button className="new-chat-btn">New chat</button>
              </div>
              <div>
                <IoIosAddCircle className="icon" />
              </div>
            </div>

            {chatHistory.map((chat) => {
              return (
                <div
                  key={chat.id}
                  className={`chat-title ${
                    selectedChatID === chat.id ? "active" : ""
                  }`}
                  onClick={() => selectChat(chat.id)}
                >
                  {chat.title}
                </div>
              );
            })}
          </>
        ) : null}
      </div>

      <div className="main-content">
        <FiSidebar className="open-btn" onClick={() => setIsOpen(!isOpen)} />
        <div className="model-switch">
          <button
            className={`chatgpt-btn ${
              selectedBot === "ChatGPT" ? "active" : "inactive"
            }`}
            onClick={() => {
              setSelectedBot("ChatGPT");
            }}
          >
            ChatGPT
          </button>
          <button
            className={`gemini-btn ${
              selectedBot === "Gemini" ? "active" : "inactive"
            }`}
            onClick={() => {
              setSelectedBot("Gemini");
            }}
          >
            Gemini
          </button>
        </div>
        <div className="chat-container">
          <div className="message-container">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.sender}`}>
                <Markdown className="markdown">{msg.text}</Markdown>
                {/* {msg.text} */}
              </div>
            ))}
            <div ref={chatEndRef} />
            {showMessageLoader && <div className="message-loader bot"></div>}
          </div>

          <div className="input-container">
            <textarea
              ref={inputRef}
              className="input"
              type="text"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && sendMessage()
              }
            />
            <button className="send-btn" onClick={sendMessage}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

import mongoose from "mongoose";
const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  sender: { type: String, required: true },
});
const chatSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  messages: [messageSchema],
});
const Chat = mongoose.model("Chat", chatSchema);
export default Chat;

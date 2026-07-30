import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(() => {
    const savedMessages = localStorage.getItem("loan-chat");
    return savedMessages ? JSON.parse(savedMessages) : [];
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem("loan-chat", JSON.stringify(messages));
  }, [messages]);

  const sendMessage = async () => {
    if (!message.trim() || loading) {
      return;
    }

    const userMessage = {
      role: "user",
      content: message,
    };

    // Create updated conversation
    const updatedMessages = [...messages, userMessage];

    // Update UI immediately
    setMessages(updatedMessages);

    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("http://localhost:5000/api/chat", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          messages: updatedMessages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: data.reply,
        },
      ]);
    } catch (error) {
      console.error(error);

      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: "Sorry, something went wrong.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };
  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem("loan-chat");
  };

  return (
    <div className="app">
      <div className="chat-container">
        <header className="header">
          <div className="header-top">
            <h1>AI Loan Assistant</h1>

            <button
              className="clear-btn"
              onClick={clearChat}
              title="Clear Chat"
            >
              🧹
            </button>
          </div>

          <p>Ask questions about loans, eligibility and documentation.</p>
        </header>

        <main className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <h2>How can I help you?</h2>

              <p>Try asking:</p>

              <div className="suggestions">
                <button
                  onClick={() =>
                    setMessage("What documents are required for a home loan?")
                  }
                >
                  Home loan documents
                </button>

                <button
                  onClick={() =>
                    setMessage("What is EMI and how does it work?")
                  }
                >
                  Explain EMI
                </button>

                <button
                  onClick={() =>
                    setMessage(
                      "What is the difference between secured and unsecured loans?",
                    )
                  }
                >
                  Loan types
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, index) => (
            <div className={`message ${msg.role}`} key={index}>
              <div className="message-label">
                {msg.role === "user" ? "You" : "AI Loan Assistant"}
              </div>

              <div className="message-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}

          {loading && (
            <div className="message assistant">
              <div className="message-label">AI Loan Assistant</div>

              <div className="message-content typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
        </main>

        <div className="input-area">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something about loans..."
            rows="2"
          />

          <button onClick={sendMessage} disabled={loading || !message.trim()}>
            {loading ? "Thinking..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

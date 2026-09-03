import { useState, useEffect } from "react";
import Login from "./Login";
import Register from "./Register";
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
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [showRegister, setShowRegister] = useState(false);
  const handleLogin = (newToken) => {
    setToken(newToken);
  };
  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken(null);
  };

  const [sessionId] = useState(() => {
  let id = localStorage.getItem("loan-session-id");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("loan-session-id", id);
  }

  return id;
});

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
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId: sessionId,
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
  const clearChat = async () => {
  try {
    const token = localStorage.getItem("token");
    await fetch(`http://localhost:5000/api/chat/session/${sessionId}`, 
      {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    setMessages([]);
    localStorage.removeItem("loan-chat");
  } catch (error) {
    console.error("Failed to clear chat:", error);
  }
};
if (!token) {
    if (showRegister) {
      return (
        <Register
          onSwitchToLogin={() => setShowRegister(false)}
        />
      );
    }

    return (
      <Login
        onLogin={handleLogin}
        onSwitchToRegister={() => setShowRegister(true)}
      />
    );
  }

  return (
    <div className="app">
      <div className="chat-container">
        <header className="header">
          <div className="header-info">
            <h1>AI Loan Assistant</h1>

            <p>Ask questions about loans, eligibility and documentation.</p>
          </div>

          <div className="header-actions">
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>

            <button
              className="clear-btn"
              onClick={clearChat}
              title="Clear Chat"
            >
              🧹
            </button>
          </div>
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

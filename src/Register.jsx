import { useState } from "react";
import "./Register.css";

function Register({ onSwitchToLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch(
        "http://localhost:5000/api/auth/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            email,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Registration failed");
        return;
      }

      alert("Registration successful. Please login.");

      onSwitchToLogin();
    } catch (error) {
      console.error("Register Error:", error);
    }
  };

  return (
    <div className="register-page">
      <div className="register-card">

        <h2>Create Account</h2>

        <p className="register-subtitle">
          Create your AI Loan Assistant account
        </p>

        <form
          className="register-form"
          onSubmit={handleSubmit}
        >
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            className="register-button"
            type="submit"
          >
            Create Account
          </button>
        </form>

        <p className="register-switch">
          Already have an account?

          <button onClick={onSwitchToLogin}>
            Login
          </button>
        </p>

      </div>
    </div>
  );
}

export default Register;
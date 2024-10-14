'use client';

import { useState, useEffect, useCallback } from 'react';
import Markdown from 'markdown-to-jsx';

export default function Chat() {
  const [messages, setMessages] = useState([]); // Store chat messages
  const [inputValue, setInputValue] = useState(''); // Handle input value
  const [loading, setLoading] = useState(false); // Loading state for API call

  // Optimized input change handler
  const onInputChange = useCallback((e) => {
    setInputValue(e.target.value);
  }, []);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent empty submissions
    if (!inputValue.trim()) return;

    // Add user's message to chat
    const userMessage = { id: Date.now(), content: inputValue, role: 'user' };
    setMessages((prevMessages) => [...prevMessages, userMessage]);

    // Reset input field and show loading state
    setInputValue('');
    setLoading(true);

    try {
      // Send message to API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage.content }), // Pass user's message
      });

      // Parse API response
      const data = await response.json();
      console.log('API Response:', data);

      // Check if response is ok and the data contains the reply
      if (response.ok && data?.reply) {
        // Add AI's response to chat
        const aiMessage = { id: Date.now() + 1, content: data.reply, role: 'ai' };
        setMessages((prevMessages) => [...prevMessages, aiMessage]);
      } else {
        // Display error message if response is not ok or data is missing
        const errorMessage = { id: Date.now() + 1, content: 'Error: Failed to get AI response.', role: 'ai' };
        setMessages((prevMessages) => [...prevMessages, errorMessage]);
      }
    } catch (error) {
      console.error('Error during API call:', error);
      const errorMessage = { id: Date.now() + 1, content: 'Error: Could not connect to server.', role: 'ai' };
      setMessages((prevMessages) => [...prevMessages, errorMessage]);
    } finally {
      // Reset loading state
      setLoading(false);
    }
  };

  // Auto scroll to the bottom when a new message is added
  useEffect(() => {
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="chat-container">
      {/* Render chat messages */}
      <div className="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === 'user' ? 'user-message' : 'ai-message'}
          >
            <strong>{m.role === 'user' ? 'User: ' : 'AI: '}</strong>
            <Markdown>{m.content}</Markdown>
          </div>
        ))}
      </div>

      {/* Form for input and submit button */}
      <form onSubmit={handleSubmit} className="chat-form">
        <input
          value={inputValue} // Use local state for better control
          placeholder={loading ? 'Please wait...' : 'Say something...'}
          onChange={onInputChange} // Use optimized handler
          className="chat-input"
          autoComplete="off" // Prevent default browser autocomplete
          aria-label="Chat input" // Accessibility label
          disabled={loading} // Disable input when loading
        />
        <button type="submit" className="submit-button" disabled={!inputValue.trim() || loading}>
          {loading ? 'Loading...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

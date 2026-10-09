import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { TextArea, Button, Loading } from '@carbon/react';
import { SendAlt } from '@carbon/icons-react';
import { ChatMessage } from '../types';

interface ChatThreadProps {
  messages: ChatMessage[];
  loading: boolean;
  onSendMessage: (prompt: string) => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  loading,
  onSendMessage,
}) => {
  const [input, setInput] = React.useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-main">
      <div className="chat-history">
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: '20%', color: 'var(--cds-text-secondary)' }}>
            <h3>How can Bob Shell help you today?</h3>
            <p>Start typing below to execute commands, ask architecture questions, or inspect context.</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className={`message-bubble ${msg.role}`}>
              <div className="message-header">
                <span>{msg.role === 'user' ? 'You' : 'Bob Assistant'}</span>
                <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="message-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="message-bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Loading small withOverlay={false} description="Bob is executing..." />
            <span>Bob is thinking and executing in container...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-container">
        <TextArea
          id="chat-input"
          labelText=""
          hideLabel
          placeholder="Ask Bob Shell or enter an instruction... (Shift+Enter for newline)"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="chat-textarea"
          disabled={loading}
        />
        <Button
          renderIcon={SendAlt}
          hasIconOnly
          iconDescription="Send Prompt"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          size="lg"
        />
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Theme, Modal } from '@carbon/react';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { ChatThread } from './components/ChatThread';
import { ContextInspector } from './components/ContextInspector';
import { ConfigDrawer } from './components/ConfigDrawer';
import { ChatMessage, SessionInfo, BobConfig } from './types';
import './styles/global.scss';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'g100' | 'g10'>('g100');
  const [sessions, setSessions] = useState<SessionInfo[]>(() => {
    const saved = localStorage.getItem('bob_sessions');
    return saved ? JSON.parse(saved) : [{ id: 'session-default', name: 'Main Session', lastUpdated: Date.now() }];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>('session-default');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [isEraseModalOpen, setIsEraseModalOpen] = useState<boolean>(false);

  const [bobConfig, setBobConfig] = useState<BobConfig>(() => {
    const saved = localStorage.getItem('bob_config');
    return saved
      ? JSON.parse(saved)
      : {
          mode: 'agent',
          approvalMode: 'default',
          systemInstruction: 'You are Bob, an enterprise AI assistant running natively on OpenShift.',
        };
  });

  useEffect(() => {
    localStorage.setItem('bob_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('bob_config', JSON.stringify(bobConfig));
  }, [bobConfig]);

  useEffect(() => {
    fetchHistory(activeSessionId);
  }, [activeSessionId]);

  const fetchHistory = async (sessionId: string) => {
    try {
      const res = await axios.get<{ history: ChatMessage[] }>(`/api/chat/history/${sessionId}`);
      setMessages(res.data.history || []);
    } catch (err) {
      console.error('Error loading history:', err);
      setMessages([]);
    }
  };

  const handleSendMessage = async (prompt: string) => {
    const userMsg: ChatMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await axios.post<{ response: string; exitCode: number }>('/api/chat', {
        sessionId: activeSessionId,
        prompt,
        systemInstruction: bobConfig.systemInstruction,
        mode: bobConfig.mode,
        approvalMode: bobConfig.approvalMode,
      });

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: res.data.response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      let errorDetail = 'Unknown error';
      if (err.response?.data?.details) {
        if (typeof err.response.data.details === 'object') {
          errorDetail = err.response.data.details.message || JSON.stringify(err.response.data.details);
        } else {
          errorDetail = String(err.response.data.details);
        }
      } else if (err.response?.data?.error) {
        errorDetail = err.response.data.error;
      } else if (err.message) {
        errorDetail = err.message;
      }

      const errMsg: ChatMessage = {
        role: 'assistant',
        content: `**Execution Error:** ${errorDetail}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleEraseMemory = async () => {
    try {
      await axios.delete(`/api/chat/memory/${activeSessionId}`);
      setMessages([]);
      setIsEraseModalOpen(false);
    } catch (err) {
      console.error('Failed to erase memory:', err);
    }
  };

  const handleNewSession = () => {
    const newId = `session-${Date.now().toString(36)}`;
    const newSession: SessionInfo = {
      id: newId,
      name: `Chat ${sessions.length + 1}`,
      lastUpdated: Date.now(),
    };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newId);
  };

  return (
    <Theme theme={theme}>
      <HeaderBar
        theme={theme}
        toggleTheme={() => setTheme(theme === 'g100' ? 'g10' : 'g100')}
        toggleConfig={() => setIsConfigOpen(true)}
        toggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
        onEraseMemory={() => setIsEraseModalOpen(true)}
        activeSessionId={activeSessionId}
      />

      <div className="chat-layout">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={(id) => setActiveSessionId(id)}
          onNewSession={handleNewSession}
        />

        <ChatThread
          messages={messages}
          loading={loading}
          onSendMessage={handleSendMessage}
        />

        <ContextInspector
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          sessionId={activeSessionId}
          messages={messages}
          onErase={() => setIsEraseModalOpen(true)}
        />
      </div>

      <ConfigDrawer
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        config={bobConfig}
        onSaveConfig={(cfg) => setBobConfig(cfg)}
      />

      <Modal
        open={isEraseModalOpen}
        danger
        modalHeading="Erase Session Memory?"
        primaryButtonText="Erase Memory"
        secondaryButtonText="Cancel"
        onRequestClose={() => setIsEraseModalOpen(false)}
        onRequestSubmit={handleEraseMemory}
      >
        <p>
          This will delete all conversation history stored in Redis for session{' '}
          <strong>{activeSessionId}</strong>. Bob Shell will have zero context from previous messages.
        </p>
      </Modal>
    </Theme>
  );
};

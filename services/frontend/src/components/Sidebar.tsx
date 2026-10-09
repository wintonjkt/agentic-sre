import React from 'react';
import { Button } from '@carbon/react';
import { Add, Chat } from '@carbon/icons-react';
import { SessionInfo } from '../types';

interface SidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}) => {
  return (
    <div className="chat-sidebar">
      <div className="sidebar-header">
        <Button
          renderIcon={Add}
          kind="primary"
          size="md"
          style={{ width: '100%' }}
          onClick={onNewSession}
        >
          New Chat
        </Button>
      </div>
      <ul className="session-list">
        {sessions.map((session) => (
          <li
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
              <Chat size={16} />
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {session.name}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

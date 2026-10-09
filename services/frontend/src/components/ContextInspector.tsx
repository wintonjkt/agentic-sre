import React from 'react';
import { Button, Tag } from '@carbon/react';
import { TrashCan, Close } from '@carbon/icons-react';
import { ChatMessage } from '../types';

interface ContextInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  messages: ChatMessage[];
  onErase: () => void;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  isOpen,
  onClose,
  sessionId,
  messages,
  onErase,
}) => {
  if (!isOpen) return null;

  const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  return (
    <div className="inspector-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h4 style={{ margin: 0 }}>Context Inspector</h4>
        <Button hasIconOnly renderIcon={Close} iconDescription="Close" kind="ghost" size="sm" onClick={onClose} />
      </div>

      <div className="inspector-section">
        <p style={{ fontSize: '0.85rem', color: 'var(--cds-text-secondary)', marginBottom: '0.5rem' }}>
          Active Redis Session:
        </p>
        <Tag type="blue">{sessionId}</Tag>
      </div>

      <div className="inspector-section">
        <p style={{ fontSize: '0.85rem', color: 'var(--cds-text-secondary)', marginBottom: '0.5rem' }}>
          Memory Statistics:
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Tag type="green">{messages.length} Turns</Tag>
          <Tag type="purple">~{estimatedTokens} Tokens</Tag>
          <Tag type="teal">{totalChars} Chars</Tag>
        </div>
      </div>

      <div className="inspector-section" style={{ flex: 1, overflowY: 'auto' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--cds-text-secondary)', marginBottom: '0.5rem' }}>
          Synthesized Context Preview:
        </p>
        <pre style={{
          backgroundColor: 'var(--cds-layer-02)',
          padding: '0.5rem',
          fontSize: '0.75rem',
          borderRadius: '4px',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {messages.map((m) => `${m.role.toUpperCase()}: ${m.content}\n\n`).join('') || '(Empty context)'}
        </pre>
      </div>

      <Button
        kind="danger--ghost"
        renderIcon={TrashCan}
        size="md"
        style={{ width: '100%', marginTop: 'auto' }}
        onClick={onErase}
      >
        Erase Context Memory
      </Button>
    </div>
  );
};

import React from 'react';
import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  Theme,
} from '@carbon/react';
import {
  Settings,
  Information,
  TrashCan,
  Asleep,
  Light,
} from '@carbon/icons-react';

interface HeaderBarProps {
  theme: 'g100' | 'g10';
  toggleTheme: () => void;
  toggleConfig: () => void;
  toggleInspector: () => void;
  onEraseMemory: () => void;
  activeSessionId: string;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  theme,
  toggleTheme,
  toggleConfig,
  toggleInspector,
  onEraseMemory,
  activeSessionId,
}) => {
  return (
    <Theme theme={theme}>
      <Header aria-label="IBM Bob Assistant">
        <HeaderName prefix="IBM">
          Bob Shell Assistant <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: '#a8a8a8' }}>({activeSessionId})</span>
        </HeaderName>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Erase Session Memory"
            tooltipAlignment="end"
            onClick={onEraseMemory}
          >
            <TrashCan size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Context Inspector"
            tooltipAlignment="end"
            onClick={toggleInspector}
          >
            <Information size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Bob Settings"
            tooltipAlignment="end"
            onClick={toggleConfig}
          >
            <Settings size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="Toggle Dark/Light Mode"
            tooltipAlignment="end"
            onClick={toggleTheme}
          >
            {theme === 'g100' ? <Light size={20} /> : <Asleep size={20} />}
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>
    </Theme>
  );
};

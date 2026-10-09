import React from 'react';
import {
  Modal,
  Select,
  SelectItem,
  Toggle,
  TextArea,
} from '@carbon/react';
import { BobConfig } from '../types';

interface ConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: BobConfig;
  onSaveConfig: (newConfig: BobConfig) => void;
}

export const ConfigDrawer: React.FC<ConfigDrawerProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [localConfig, setLocalConfig] = React.useState<BobConfig>(config);

  React.useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleSave = () => {
    onSaveConfig(localConfig);
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      modalHeading="Bob Shell Execution Settings"
      primaryButtonText="Save Changes"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={handleSave}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
        <Select
          id="bob-mode"
          labelText="Bob Execution Mode"
          value={localConfig.mode}
          onChange={(e) =>
            setLocalConfig({ ...localConfig, mode: e.target.value as any })
          }
        >
          <SelectItem value="agent" text="Agent Mode (Full autonomous problem solving & implementation)" />
          <SelectItem value="code" text="Code Mode (Code generation & editing)" />
          <SelectItem value="ask" text="Ask Mode (Read-only, architectural analysis)" />
          <SelectItem value="plan" text="Plan Mode (Stepwise planning)" />
          <SelectItem value="advanced" text="Advanced Mode (Extended tools & MCP)" />
        </Select>

        <Toggle
          id="approval-mode-toggle"
          labelText="Approval Mode"
          labelA="Default (Non-destructive)"
          labelB="YOLO (Auto-approve execution & edits)"
          toggled={localConfig.approvalMode === 'yolo'}
          onToggle={(toggled) =>
            setLocalConfig({
              ...localConfig,
              approvalMode: toggled ? 'yolo' : 'default',
            })
          }
        />

        <TextArea
          id="system-instruction"
          labelText="System Instruction / Persona Override"
          placeholder="e.g., You are Bob, an expert Site Reliability Engineer specializing in Red Hat OpenShift..."
          rows={4}
          value={localConfig.systemInstruction}
          onChange={(e) =>
            setLocalConfig({ ...localConfig, systemInstruction: e.target.value })
          }
        />
      </div>
    </Modal>
  );
};
